"""Low-frequency Databento reference bridge for the broad equity universe.

The bridge emits sanitized NDJSON records. It first attempts the licensed
Security Master and falls back to the current EQUS.MINI definition snapshot.
It never starts a live market-data subscription.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import databento as db


DEFINITION_MAX_AGE_MS = 96 * 60 * 60 * 1000
SECURITY_MASTER_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000


def write_event(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, separators=(",", ":"), default=str), flush=True)


def safe_error(error: Exception) -> str:
    key = os.environ.get("DATABENTO_API_KEY", "")
    message = str(error).replace(key, "[redacted]") if key else str(error)
    return (message[:500] or "Databento reference request failed.").replace("\n", " ")


def security_master_authorization(error_reason: str) -> tuple[str, str]:
    """Classify provider entitlement failures without exposing credentials."""
    normalized = error_reason.lower()
    if (
        "403" in normalized
        and (
            "license_reference_dataset_no_subscription" in normalized
            or "no_subscription" in normalized
            or "not subscribed" in normalized
        )
    ):
        return (
            "blocked",
            "Databento Security Master entitlement is not active for this key. "
            "Restore the licensed reference dataset entitlement; the service will retry automatically.",
        )
    return (
        "unavailable",
        "Databento Security Master could not be verified for this refresh. "
        "The discovery-only fallback remains ineligible until a verified response succeeds.",
    )


def text(value: Any) -> str | None:
    if value is None:
        return None
    value_text = str(value).strip()
    if not value_text or value_text.lower() in {"nan", "nat", "none"}:
        return None
    return value_text


def iso_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    try:
        if hasattr(value, "isoformat") and not isinstance(value, datetime):
            parsed = datetime.fromisoformat(value.isoformat().replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")
        timestamp = value
        if isinstance(timestamp, datetime):
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=UTC)
            return timestamp.astimezone(UTC).isoformat().replace("+00:00", "Z")
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        return None


def bool_value(value: Any) -> bool:
    return str(value).strip().upper() in {"1", "TRUE", "M", "MAIN", "PRIMARY"}


def row_value(row: Any, *names: str) -> Any:
    for name in names:
        try:
            value = row.get(name)
        except (AttributeError, KeyError):
            value = getattr(row, name, None)
        if value is not None and text(value) is not None:
            return value
    return None


def parse_utc_timestamp(value: Any, field: str) -> datetime:
    """Parse provider availability values and reject invalid time bounds."""
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"Databento dataset range has no valid {field} timestamp.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError(f"Databento dataset range has an invalid {field} timestamp.") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def definition_query_range(available: dict[str, Any]) -> tuple[datetime, datetime]:
    """Return one non-empty, end-exclusive definition interval.

    Databento metadata may report a definition availability end at midnight.
    Treating that endpoint as both the end and the start of its UTC day creates
    a zero-length request, which the API correctly rejects. Query the final
    available 24-hour interval instead, capped by the published availability
    start, and fail before making a provider call if no interval exists.
    """
    try:
        definition = available["schema"]["definition"]
    except (KeyError, TypeError) as error:
        raise RuntimeError("Databento dataset range has no definition availability bounds.") from error
    available_start = parse_utc_timestamp(definition.get("start"), "definition start")
    available_end = parse_utc_timestamp(definition.get("end"), "definition end")
    if available_end <= available_start:
        raise RuntimeError("Databento definition availability has no non-empty query interval.")
    query_start = max(available_start, available_end - timedelta(days=1))
    if query_start >= available_end:
        raise RuntimeError("Databento definition query interval is empty.")
    return query_start, available_end


def security_master_snapshot(key: str) -> int:
    frame = db.Reference(key=key).security_master.get_last(
        countries=["US"],
        allocate_isins=False,
    )
    if frame.empty:
        raise RuntimeError("Databento Security Master returned an empty US snapshot.")
    reset = frame.reset_index()
    timestamp_column = "ts_effective" if "ts_effective" in reset.columns else None
    source_timestamp = (
        iso_timestamp(reset[timestamp_column].max())
        if timestamp_column
        else datetime.now(UTC).isoformat().replace("+00:00", "Z")
    )
    if source_timestamp is None:
        raise RuntimeError("Databento Security Master returned no valid effective timestamp.")

    write_event(
        {
            "type": "meta",
            "dataset": "Databento Security Master",
            "source": "Databento Security Master",
            "sourceKind": "security_master",
            "sourceTimestamp": source_timestamp,
            "maxAgeMs": SECURITY_MASTER_MAX_AGE_MS,
            "authorizationState": "verified",
            "authorizationReason": "Databento Security Master responded with a licensed reference snapshot.",
            "reason": (
                "Licensed Security Master records verify listing lifecycle and security type. "
                "Sector hierarchy remains unavailable unless supplied by a classification field."
            ),
        }
    )

    count = 0
    for _, row in reset.iterrows():
        provider_symbol = row_value(row, "nasdaq_symbol", "symbol", "local_code")
        reference_updated_at = row_value(row, "ts_effective")
        if text(provider_symbol) is None or iso_timestamp(reference_updated_at) is None:
            continue
        listing_source = row_value(row, "listing_source")
        record = {
            "type": "security",
            "providerSymbol": text(provider_symbol),
            "instrumentId": text(row_value(row, "security_id")),
            "listingId": text(row_value(row, "listing_id")),
            "issuerName": text(row_value(row, "issuer_name")),
            "listingExchange": text(row_value(row, "exchange", "operating_mic")),
            "primaryExchange": text(row_value(row, "primary_exchange")),
            "providerSecurityType": text(row_value(row, "security_type")),
            "instrumentClass": "K",
            "securityUpdateAction": None,
            "listingStatus": text(row_value(row, "listing_status")),
            "tradingStatus": None,
            "cfi": text(row_value(row, "cfi")),
            "sector": text(row_value(row, "sector")),
            "industryGroup": text(row_value(row, "industry_group", "industryGroup")),
            "industry": text(row_value(row, "industry")),
            "classificationSource": text(row_value(row, "classification_source")),
            "referenceUpdatedAt": iso_timestamp(reference_updated_at),
            "primaryListing": bool_value(listing_source),
        }
        write_event(record)
        count += 1
    write_event({"type": "complete", "recordCount": count})
    return count


def definition_snapshot(key: str, fallback_reason: str) -> int:
    client = db.Historical(key=key)
    dataset = "EQUS.MINI"
    available = client.metadata.get_dataset_range(dataset)
    start, end = definition_query_range(available)
    store = client.timeseries.get_range(
        dataset=dataset,
        start=start,
        end=end,
        symbols="ALL_SYMBOLS",
        schema="definition",
        stype_in="raw_symbol",
        stype_out="instrument_id",
    )
    frame = store.to_df().reset_index()
    if frame.empty:
        raise RuntimeError("Databento EQUS.MINI returned an empty definition snapshot.")

    latest: dict[tuple[str, str], dict[str, Any]] = {}
    for _, row in frame.iterrows():
        symbol = text(row_value(row, "raw_symbol", "symbol"))
        instrument_id = text(row_value(row, "instrument_id"))
        updated_at = iso_timestamp(row_value(row, "ts_recv", "ts_event"))
        if symbol is None or instrument_id is None or updated_at is None:
            continue
        latest[(instrument_id, symbol)] = {
            "type": "security",
            "providerSymbol": symbol,
            "instrumentId": instrument_id,
            "listingId": None,
            "issuerName": None,
            "listingExchange": text(row_value(row, "exchange")),
            "primaryExchange": None,
            "providerSecurityType": text(row_value(row, "security_type", "secsubtype")),
            "instrumentClass": text(row_value(row, "instrument_class")),
            "securityUpdateAction": text(row_value(row, "security_update_action")),
            "listingStatus": None,
            "tradingStatus": text(row_value(row, "md_security_trading_status")),
            "cfi": text(row_value(row, "cfi")),
            "sector": None,
            "industryGroup": None,
            "industry": None,
            "classificationSource": None,
            "referenceUpdatedAt": updated_at,
            "primaryListing": True,
        }

    reason = (
        f"Databento Security Master unavailable ({fallback_reason}). "
        "EQUS.MINI definitions provide symbol and lifecycle discovery, but do not "
        "verify common-equity type or sector hierarchy; those records remain ineligible."
    )
    authorization_state, authorization_reason = security_master_authorization(fallback_reason)
    write_event(
        {
            "type": "meta",
            "dataset": dataset,
            "source": "Databento EQUS.MINI instrument definitions",
            "sourceKind": "definitions",
            "sourceTimestamp": iso_timestamp(end),
            "maxAgeMs": DEFINITION_MAX_AGE_MS,
            "reason": reason,
            "authorizationState": authorization_state,
            "authorizationReason": authorization_reason,
        }
    )
    for record in latest.values():
        write_event(record)
    write_event({"type": "complete", "recordCount": len(latest)})
    return len(latest)


def main() -> None:
    key = os.environ.get("DATABENTO_API_KEY")
    if not key:
        write_event({"type": "error", "message": "DATABENTO_API_KEY is not configured."})
        return
    try:
        security_master_snapshot(key)
        return
    except Exception as error:
        security_master_reason = safe_error(error)
    try:
        definition_snapshot(key, security_master_reason)
    except Exception as error:
        write_event({"type": "error", "message": safe_error(error)})


if __name__ == "__main__":
    main()
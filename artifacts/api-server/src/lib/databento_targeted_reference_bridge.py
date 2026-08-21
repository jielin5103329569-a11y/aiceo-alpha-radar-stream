"""Bounded Security Master bridge for already-prequalified AI-pool symbols."""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime

import databento as db


def emit(payload: dict) -> None:
    print(json.dumps(payload, separators=(",", ":"), default=str), flush=True)


def clean_error(error: Exception) -> str:
    key = os.environ.get("DATABENTO_API_KEY", "")
    return str(error).replace(key, "[redacted]").replace("\n", " ")[:500]


def value(row, *names):
    for name in names:
        item = getattr(row, name, None)
        if item is not None and str(item).strip().lower() not in {"", "none", "nan", "nat"}:
            return str(item).strip()
    return None


def main() -> None:
    key = os.environ.get("DATABENTO_API_KEY")
    symbols = sorted({item.strip().upper() for item in sys.argv[1:] if item.strip()})
    if not key:
        emit({"type": "error", "message": "DATABENTO_API_KEY is not configured."})
        return
    if not symbols or len(symbols) > 2000:
        emit({"type": "error", "message": "A bounded set of one to 2,000 symbols is required."})
        return
    try:
        frame = db.Reference(key=key).security_master.get_last(
            symbols=symbols,
            stype_in="raw_symbol",
            countries=["US"],
            allocate_isins=False,
        ).reset_index()
        emit({
            "type": "meta",
            "sourceTimestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "recordCount": len(frame),
        })
        for _, row in frame.iterrows():
            symbol = value(row, "nasdaq_symbol", "symbol", "local_code")
            if not symbol:
                continue
            emit({
                "type": "security",
                "symbol": symbol.upper(),
                "securityIdentifier": value(row, "security_id", "listing_id", "isin") or symbol.upper(),
                "listingStatus": value(row, "listing_status"),
                "securityType": value(row, "security_type"),
                "issuerName": value(row, "issuer_name"),
            })
        emit({"type": "complete"})
    except Exception as error:
        emit({"type": "error", "message": clean_error(error)})


if __name__ == "__main__":
    main()
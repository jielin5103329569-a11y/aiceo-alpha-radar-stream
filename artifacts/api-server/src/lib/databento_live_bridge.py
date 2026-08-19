"""Safe Databento Live bridge for Alpha Radar Stream.

This process accepts configuration only through environment variables and emits
sanitized JSON lines for the Node API server. It never writes credentials or
raw protocol payloads to stdout/stderr.
"""

from __future__ import annotations

import json
import os
import signal
import sys
from datetime import UTC, datetime
from typing import Any

import databento as db


PRICE_SCALE = 1_000_000_000
RUNNING = True


def write_event(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def safe_error(error: Exception) -> str:
    message = str(error).replace(os.environ.get("DATABENTO_API_KEY", ""), "[redacted]")
    return message[:320] or "Databento connection failed."


def timestamp_iso(value: Any) -> str:
    if value is None:
        return now_iso()
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    try:
        timestamp = int(value)
        if timestamp > 1_000_000_000_000:
            return datetime.fromtimestamp(timestamp / 1_000_000_000, UTC).isoformat().replace(
                "+00:00", "Z"
            )
        return datetime.fromtimestamp(timestamp, UTC).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError):
        return now_iso()


def field(source: Any, *names: str) -> Any:
    for name in names:
        value = getattr(source, name, None)
        if value is not None:
            return value
    return None


def safe_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def price(value: Any) -> float | None:
    number = safe_number(value)
    if number is None:
        return None
    return round(number / PRICE_SCALE if abs(number) >= 1_000_000 else number, 6)


def size(value: Any) -> float | None:
    number = safe_number(value)
    return None if number is None else max(0, round(number))


def event_time(record: Any) -> str:
    header = getattr(record, "hd", None)
    return timestamp_iso(field(record, "ts_event", "ts_recv") or field(header, "ts_event", "ts_recv"))


def handle_mbp(record: Any) -> None:
    levels = getattr(record, "levels", None)
    level = levels[0] if levels else record
    bid_price = price(field(level, "bid_px", "bid_px_00"))
    ask_price = price(field(level, "ask_px", "ask_px_00"))
    bid_size = size(field(level, "bid_sz", "bid_sz_00"))
    ask_size = size(field(level, "ask_sz", "ask_sz_00"))

    action = str(getattr(record, "action", "")).upper()
    is_trade = action == "T" or action.endswith(".T") or "TRADE" in action
    trade_price = price(field(record, "price"))
    trade_size = size(field(record, "size"))
    trade = None
    if is_trade and trade_price is not None and trade_size is not None:
        side = str(getattr(record, "side", "")).upper() or None
        trade = {
            "price": trade_price,
            "size": trade_size,
            "timestamp": event_time(record),
            "side": side,
        }

    write_event(
        {
            "type": "mbp",
            "timestamp": event_time(record),
            "bidPrice": bid_price,
            "askPrice": ask_price,
            "bidSize": bid_size,
            "askSize": ask_size,
            "trade": trade,
        }
    )


def handle_ohlcv(record: Any) -> None:
    write_event(
        {
            "type": "ohlcv",
            "timestamp": event_time(record),
            "close": price(field(record, "close")),
            "volume": size(field(record, "volume")),
        }
    )


def stop_handler(_signum: int, _frame: Any) -> None:
    global RUNNING
    RUNNING = False


def main() -> None:
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not api_key:
        write_event({"type": "error", "message": "DATABENTO_API_KEY is not configured."})
        return

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)
    symbol = os.environ.get("RADAR_SYMBOL", "NVDA")
    dataset = "EQUS.MINI"
    client: Any = None

    try:
        client = db.Live(key=api_key)
        client.subscribe(dataset=dataset, schema="mbp-1", symbols=symbol, stype_in="raw_symbol")
        client.subscribe(dataset=dataset, schema="ohlcv-1s", symbols=symbol, stype_in="raw_symbol")
        write_event({"type": "ready"})

        for record in client:
            if not RUNNING:
                break
            name = type(record).__name__.lower()
            if "ohlcv" in name:
                handle_ohlcv(record)
            elif "mbp" in name:
                handle_mbp(record)
    except Exception as error:
        write_event({"type": "error", "message": safe_error(error)})
    finally:
        if client is not None:
            try:
                client.stop()
            except Exception:
                pass


if __name__ == "__main__":
    main()
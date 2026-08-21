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
import threading
from datetime import UTC, datetime
from typing import Any

import databento as db


PRICE_SCALE = 1_000_000_000
RUNNING = True
HEARTBEAT_INTERVAL_SECONDS = 5
WRITE_LOCK = threading.Lock()
ALLOWED_SYMBOLS = frozenset({"NVDA", "MU", "VRT", "CRDO", "AMD"})


def write_event(payload: dict[str, Any]) -> None:
    with WRITE_LOCK:
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


def receive_time(record: Any) -> str | None:
    header = getattr(record, "hd", None)
    value = field(record, "ts_recv") or field(header, "ts_recv")
    return timestamp_iso(value) if value is not None else None


def trade_side(record: Any) -> str | None:
    raw_side = str(getattr(record, "side", "")).upper()
    if raw_side in {"B", "BID", "SIDE.BID"}:
        return "B"
    if raw_side in {"A", "ASK", "SIDE.ASK"}:
        return "A"
    return raw_side or None


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
        trade = {
            "price": trade_price,
            "size": trade_size,
            "timestamp": event_time(record),
            "side": trade_side(record),
        }

    write_event(
        {
            "type": "mbp",
            "source": "databento_live",
            "schema": "mbp-1",
            "timestamp": event_time(record),
            "receivedAt": receive_time(record),
            "ingestedAt": now_iso(),
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
            "source": "databento_live",
            "schema": "ohlcv-1s",
            "timestamp": event_time(record),
            "receivedAt": receive_time(record),
            "ingestedAt": now_iso(),
            "close": price(field(record, "close")),
            "volume": size(field(record, "volume")),
        }
    )


def stop_handler(_signum: int, _frame: Any) -> None:
    global RUNNING
    RUNNING = False


def heartbeat_loop(stop_event: threading.Event) -> None:
    """Publish bridge liveness without ever claiming a market event occurred."""
    write_event({"type": "heartbeat", "source": "databento_live", "emittedAt": now_iso()})
    while not stop_event.wait(HEARTBEAT_INTERVAL_SECONDS):
        write_event({"type": "heartbeat", "source": "databento_live", "emittedAt": now_iso()})


def main() -> None:
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not api_key:
        write_event({"type": "error", "message": "DATABENTO_API_KEY is not configured."})
        return

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)
    symbol = os.environ.get("RADAR_SYMBOL", "NVDA").upper()
    if symbol not in ALLOWED_SYMBOLS:
        write_event({"type": "error", "message": "Unsupported radar symbol."})
        return
    dataset = "EQUS.MINI"
    client: Any = None
    heartbeat_stop = threading.Event()
    heartbeat_thread: threading.Thread | None = None

    try:
        client = db.Live(key=api_key)
        client.subscribe(dataset=dataset, schema="mbp-1", symbols=symbol, stype_in="raw_symbol")
        client.subscribe(dataset=dataset, schema="ohlcv-1s", symbols=symbol, stype_in="raw_symbol")
        write_event({"type": "ready"})
        heartbeat_thread = threading.Thread(
            target=heartbeat_loop,
            args=(heartbeat_stop,),
            name="databento-bridge-heartbeat",
            daemon=True,
        )
        heartbeat_thread.start()

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
        heartbeat_stop.set()
        if heartbeat_thread is not None:
            heartbeat_thread.join(timeout=1)
        if client is not None:
            try:
                client.stop()
            except Exception:
                pass


if __name__ == "__main__":
    main()

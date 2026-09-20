#!/usr/bin/env python3
"""Read MEMORY_V1 wells. No live write. No 8080."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
wells = root / "MEMORY_V1" / "BOTTLENECK" / "WELLS.yaml"
cur = root / "MEMORY_V1" / "STATE" / "alpha.current.yaml"
print("productionAuthority=false")
print("live_wired=false")
print("--- current ---")
print(cur.read_text() if cur.exists() else "MISSING")
print("--- wells ---")
print(wells.read_text() if wells.exists() else "MISSING")

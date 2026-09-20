#!/usr/bin/env python3
"""Research sidecar. Read-only. No alertReady. No live scores."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
cur = (root / "MEMORY_V1/STATE/alpha.current.yaml").read_text()
wells = (root / "MEMORY_V1/BOTTLENECK/WELLS.yaml").read_text()
ids = [ln.split("id:",1)[1].strip() for ln in wells.splitlines() if ln.strip().startswith("- id:")]
packs = sorted(p.name for p in (root / "EXTERNAL_EYES/PACKS").glob("20*.md"))
snaps = sorted(p.name for p in (root / "MEMORY_V1/SNAPSHOT").glob("20*.md"))
print("slice=research-sidecar-reader")
print("live_wired=false")
print("productionAuthority=false")
print("buy_signal=false")
print("wells=" + str(len(ids)))
print("hidden_x=WELL-POWER-PATH-COMP,WELL-POWER-COST-INT")
print("status=NOT CONFIRMED")
print("packs=" + ",".join(packs))
print("snapshots=" + ",".join(snaps))
print("current_has_unknown_next=" + str("next_unpriced_well: UNKNOWN" in cur))

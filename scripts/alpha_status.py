#!/usr/bin/env python3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
wells = (root / "MEMORY_V1/BOTTLENECK/WELLS.yaml").read_text()
ids = [ln.split("id:",1)[1].strip() for ln in wells.splitlines() if ln.strip().startswith("- id:")]
packs = sorted(p.name for p in (root / "EXTERNAL_EYES/PACKS").glob("20*.md"))
print("live_wired=false")
print("wells=" + str(len(ids)))
print("well_ids=" + ",".join(ids))
print("packs=" + str(len(packs)))
print("pack_names=" + ",".join(packs))

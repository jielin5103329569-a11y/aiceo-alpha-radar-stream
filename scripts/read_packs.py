#!/usr/bin/env python3
"""List EXTERNAL_EYES/PACKS. No rewrite. No live."""
from pathlib import Path

d = Path(__file__).resolve().parents[1] / "EXTERNAL_EYES" / "PACKS"
print("packs_dir=" + str(d.exists()))
if not d.exists():
    raise SystemExit(1)
names = sorted(p.name for p in d.iterdir() if p.suffix == ".md" and not p.name.startswith("_"))
print("count=" + str(len(names)))
for n in names:
    print(n)

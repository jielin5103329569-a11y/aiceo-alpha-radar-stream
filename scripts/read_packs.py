#!/usr/bin/env python3
"""List frozen PACKs only. No rewrite. No live."""
from pathlib import Path

d = Path(__file__).resolve().parents[1] / "EXTERNAL_EYES" / "PACKS"
packs = sorted(
    p for p in d.iterdir()
    if p.suffix == ".md" and p.name.startswith("20")
)
print("count=" + str(len(packs)))
for p in packs:
    first = p.read_text(encoding="utf-8").splitlines()[0] if p.stat().st_size else ""
    print(p.name + "|" + first)

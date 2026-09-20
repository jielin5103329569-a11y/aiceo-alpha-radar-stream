#!/usr/bin/env python3
from pathlib import Path
text = (Path(__file__).resolve().parents[1] / "MEMORY_V1/OUTCOME/OPEN.yaml").read_text()
wells = [ln.split(":",1)[1].strip() for ln in text.splitlines() if ln.strip().startswith("- well:")]
print("open_outcomes=" + str(len(wells)))
print("wells=" + ",".join(wells))
print("filled=0")
print("live_wired=false")

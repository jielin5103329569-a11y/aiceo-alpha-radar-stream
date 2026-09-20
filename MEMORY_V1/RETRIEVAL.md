# Retrieval

- All sources stay on disk.
- Default load = `BOOT.md` + `INDEX.yaml` + `SCHEMA.yaml` + `STATE/aiceo.pointers.yaml` only.
- For a mapped task, load only its mapped SOURCE files.
- Unknown task: do not load all memory. Load default only. Missing map = STOP or Owner-specified ids.
- Never compress execution/governance source text.
- Missing reference = STOP. Persistent State wins conflicts.
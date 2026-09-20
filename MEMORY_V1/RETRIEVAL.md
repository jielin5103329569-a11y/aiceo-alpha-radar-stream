# Retrieval

- All sources stay on disk.
- Default load = `BOOT.md` + `INDEX.yaml` + `SCHEMA.yaml` + `STATE/aiceo.pointers.yaml` only.
- For a mapped task, load only its mapped SOURCE files.
- Unknown task: do not load all memory. Load default only. Missing map = STOP or Owner-specified ids.
- Never compress execution/governance source text.
- Missing reference = STOP. Persistent State wins conflicts.
- AICEO / owner-mode: after default load, open docs/OWNER_COLLABORATION_CONTRACT.md + AICEO_EXEC_CHAIN.md.
- Alpha / 阿尔法 / ticker-under-Alpha: default + STATE/alpha.pointers.yaml + task_maps.alpha + MEMORY_V1/CARDS/alpha/* + GOV-ALPHA-ROADMAP. Do not load full AICEO继续 map or all .agents/memory.

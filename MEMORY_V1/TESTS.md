# Checks

- BOOT, INDEX, SCHEMA, README, and state pointer paths must exist.
- Every INDEX ref and every card ref must exist.
- Card count must equal the real `.agents/memory/*.md` file count.
- Persistent State wins every conflict.
- Resume Node and productionAuthority are read-only.
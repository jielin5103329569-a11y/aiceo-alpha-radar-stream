# PERSIST_GATE
As-of: 2026-09-27 17:19 PT

## DEAD ORDER (Owner 2026-09-27 17:19 PT)
All repo read/write must pass the gate first.
Owner says 把某某存进仓库 = load BOOT + INDEX + this file + domain store rules, then write.
Then HEAD verify (push + SHA + re-read).
Next miss = worker fault. Do not ask Owner to remind.

## Gate before any repo action
1. Read MEMORY_V1/BOOT.md
2. Read MEMORY_V1/INDEX.yaml and the matching task_map (DEFAULT always)
3. Read this file
4. Read the domain store rule (Eyes ingest / LEARNING PASS / Alpha MEMORY_V1 path)
5. Write only to the mapped path
6. Reply repo + path + SHA
7. Re-read HEAD. Missing file = NOT_SAVED

## Done test
Saved only if HEAD contains the body Owner asked to store.
Forbidden archive: chat artifacts/, memory.md pointer alone, 记住了.

## Default path if Owner does not name a repo
- 轻资产 / 学习资料 / 口令集 → new-company NEW_COMPANY/MEMORY/LEARNING/
- Eyes PACK → EXTERNAL_EYES hot path
- Alpha well/radar → this repo mapped MEMORY_V1 path

## Passphrase load
学习资料 / 打开学习资料 / 口令集 / 打开口令集
→ new-company NEW_COMPANY/MEMORY/LEARNING/PASS.md then KOULING.md then LIGHT_ASSET.md
No hunt. No Owner paste homework.
STATUS=BODY_MISSING → report that line. Stop.

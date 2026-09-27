# PERSIST_GATE
As-of: 2026-09-27 16:55 PT
Owner order: prevent "said saved, next session empty".

## Rule
Owner says 进仓 / 保存 / 独立记忆 / 落盘 = one job.
Done only if all three pass in the same turn:
1. github push to the locked path
2. reply Owner: repo + path + commit SHA
3. get_file_contents on HEAD; file exists

Fail any one → say NOT_SAVED. Do not say 记住了 / 已保存 / 你说口令就能调.

## Forbidden as archive
- this-chat artifacts/
- memory.md pointer without HEAD file
- "I will remember"

## Default path if Owner does not name a repo
- 轻资产 / 学习资料 / 口令集 → new-company NEW_COMPANY/MEMORY/LEARNING/
- Eyes PACK → aiceo-alpha-radar-stream EXTERNAL_EYES hot path
- Alpha well/radar → this repo MEMORY_V1 / artifacts as already mapped

## Passphrase load
学习资料 / 打开学习资料 / 口令集 / 打开口令集
→ read new-company NEW_COMPANY/MEMORY/LEARNING/PASS.md then KOULING.md
Do not search the repo. Do not ask Owner to paste the body.
If file STATUS=BODY_MISSING: report that one line. Stop.

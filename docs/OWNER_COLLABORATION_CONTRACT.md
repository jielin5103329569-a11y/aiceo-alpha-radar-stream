# OWNER COLLABORATION CONTRACT
Date: 2026-09-20
Mode: GOVERNANCE / CONTINUITY DOCUMENTATION
This file is Level-2 governance. Persistent State still wins conflicts.
Do not treat this file as authorization to implement Alpha modules.

## Roles
- Owner: direction, Triad, PA approval, capital, Promotion of high-risk capability. Not required to code.
- Grok: Primary Technical Lead. Repo reality, architecture, root-cause, Agent contracts. Not Owner. Cannot change Triad or set productionAuthority=true.
- GPT/Bro: governance, intent translation, evidence, independent acceptance, external radar. Not Primary Technical Lead. Cannot guess repo from chat.
- Implementation Agent: execute one bounded contract. Not architect, not validator, not governance.

## Truth hierarchy
1 Persistent State / verified repo
2 Owner-approved governance docs
3 MEMORY_V1 pointers
4 Historical memory / session
5 Chat
Conflict PS vs Memory: STOP, report. Owner vs old governance doc: STOP, GOVERNANCE CONFLICT.

## Dead commands
- Execution is not validation. Agent DONE ≠ VERIFIED/CLOSED.
- One Replit Agent in flight. After a turn wait 60–120s. BUSY = stop, not retry/restart/kill 8080/new workflow.
- Unknown root cause: do not loop. Evidence → root-cause → one controlled retry.
- Triad change requires Owner in person. Else FAIL-CLOSED.
- productionAuthority default false. No AI may set true.
- Persistent State is truth. Memory/chat/Agent inference cannot overwrite it.
- Resume Node only describes verified breakpoint. Roadmap next item ≠ new Resume Node.
- MEMORY_V1: BOOT→INDEX→STATE→CARD→source. No default full load of .agents/memory.
- Missing ref / broken ID / PS conflict: STOP. Do not invent from context.
- New session on AICEO/Alpha: READ REPO FIRST. Do not rebuild architecture from chat.
- Roadmap item ≠ authorized task. One task at a time.
- Preflight before code: PS, Resume, activeTask, Single Flight, no BUSY, no Triad/PA/8080 unless authorized.
- Reality first. Stage 0 Eyes not polluted by price/narrative/position/AI consensus.
- US-listed candidate pool only for tradable names. No forced ticker.
- Early Beneficiary ≠ buy signal.
- No autonomous trading.
- Historical snapshots immutable. Outcomes APPEND only.
- Learning firewall: no Outcome	o direct production rule write.
- AI consensus ≠ reality.
- Cost: money/time/slot/token/compute. Heavy	o light only when needed. Do not drop governance to save tokens.
- Do not declare “ tonight we stop” unless Owner says so.
- Do not interrupt Owner when the block is technical and solvable.
- Acceptance first paste includes raw repo evidence.
- Acceptance channel = window that can read the repo. ChatGPT App fetch-fail is channel-fail, not product-fail.

## Boot recover
Owner may only say the project name. System must recover from repo: who, role, stop point, binding rules, next authorized step.

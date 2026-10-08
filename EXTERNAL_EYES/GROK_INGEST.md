# Grok PACK ingest hot path
Locked 2026-09-25 after Owner cost complaint: second ingest re-searched the drawer.
Owner 2026-09-28: every pack must get a 正反判断.
Owner 2026-10-06: every ingest must progress-check. Fear is lag, not wrong sentences.
Owner 2026-10-08: same-chain prior-window check. Black Hills $399M was missed because it was not on the roster.

Trigger: Owner sends 入库 / 存包 + Frozen PACK body.

Do not search the drawer. Do not list PACKS first unless stamp collision is suspected.

Reply first, then files:
1. 现实层：偏正 / 偏反 / 无新
2. 交易层：偏正 / 不偏正
3. 有没有新的未定价突破
4. 可买仍按板面，不因包改
5. 进度：跟上 / 落后。落后必须点出票和原件日期
6. 同链：上一包下一问有没有新原件没进本包

Write the same bias line and the progress line into OUTCOME <stamp>_MAPPING.md.

## Progress check (2026-10-06)
Not a fact audit. Do not re-check every number in the pack.
On each ingest, for tickers already on the roster and any ticker the pack names:
- Look up the latest issuer 8-K or company release date only.
- Compare that date to the pack and to the board status line.
- If a newer official print exists and the pack did not include it: mark LAG.
- Say the ticker, the print date, and one line of what it is.
- Do not upgrade stage. Do not add or remove tickers. Do not treat LAG as a buy.
- If nothing newer: mark 跟上.
No full-market EDGAR scan. No 8080. No live-5.

## Same-chain check (2026-10-08)
Roster 8-K does not catch a new issuer that is not on the board.
On each ingest, read only the previous pack's next-milestone line.
Look for one new official print on that same physical chain: power contract, prepay, long-lead equipment.
If the new pack does not include it: mark LAG, name the issuer and date.
Write it in the mapping. If the miss is prior-window, add one new AUDIT file. Do not rewrite the old pack.
Do not add a ticker. Do not upgrade a well. Do not treat the print as a buy.

Fixed target:
- owner: jielin5103329569-a11y
- repo: aiceo-alpha-radar-stream
- branch: main

Three new files:
1. EXTERNAL_EYES/PACKS/<YYYY-MM-DD_HHh>.md  verbatim
2. EXTERNAL_EYES/OUTCOME/<stamp>_MAPPING.md
3. EXTERNAL_EYES/OUTCOME/<stamp>_LADDER_CHECK.md

Never overwrite an old PACK.
Glance / roster_board is the existing 3H automation only.
Not buy. Not 8080. Not live-5.

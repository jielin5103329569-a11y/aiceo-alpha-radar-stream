# Ladder-fix acceptance (missing function)
Owner 2026-09-22: keep watching; judge inbound facts; detect whether the hole is really closed.
Buy-gate isolated. No auto trade.

## Missing function under test
Already-on-paper well + official catalyst that hits Visual Memory or company_pattern
→ push TICKER / WELL / STAGE / CATALYST+URL
BEFORE the first same-thesis price reaction.

VICR 9/16→9/17 is the failed reference: push should have existed at 9/16 print, not 9/22 close.

## Live detector (no Owner fetch)
On every HIT in MEMORY_V1/LADDER/DAILY/:
- t_push = notify / DAILY timestamp PT
- t_catalyst = official IR/8-K time
- t_px1 = first session or premarket move clearly tied to that catalyst (if observable)
PASS if t_push ≤ t_px1 and t_push is same calendar event as t_catalyst (not days later).
FAIL if first notice is after t_px1 or only after a second confirmation print.
LATE if well was already late-vs-reprice on the card.
FALSE if mark=HIT on price-only or Eyes B-section with no issuer original.

Write the verdict on the same DAILY file:
ACCEPT= PASS | FAIL | LATE | FALSE | WAITING

## Waiting is allowed
Until the next real HIT on a paper well, ACCEPT=WAITING.
Files and automations existing ≠ PASS.
First PASS or FAIL on a live HIT is the proof.

## Also log (not the main proof)
Next Eyes 6H pack contains LADDER_CHECK: yes/no. Missing = Eyes generation still open. Grok 30min scan is the backup path, not a substitute for Eyes including the block.

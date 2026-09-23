# Daily column: 已落纸井 × 当日发行人 Reality
version: ladder-daily/v0
opened: 2026-09-22
layer: knowledge-only
live5: no
alertReady: no
buy: no
productionAuthority: false
8080: untouched

## Cadence
One file per US session after close (AH 8-K waits next RTH per existing timely-8K rule).
Path: MEMORY_V1/LADDER/DAILY/YYYY-MM-DD.md
Empty day is still a file. NONE is a legal value. Silence without a file is a protocol miss.

## Universe
Exactly the wells in MEMORY_V1/BOTTLENECK/WELLS.yaml. No extra tickers.

## Allowed marks
- HIT: issuer IR / 8-K / official guide that hits that well's Visual Memory node or company_pattern AFTER the well lock date, and is not already classified late/priced-in on the ladder card.
- MISS: such an event existed in the public world today (or prior unlogged session) and the ladder did not already have it. Use for autopsy. Do not invent.
- NONE: no qualifying issuer event today.
- LATE: event exists but awareness clock already marked late-vs-reprice / late-two-beats / LATE_VS_8K. Not a new discovery hit.

## Forbidden
live-5, alertReady, new host, keyword patch, rewriting old PACKs, treating Eyes B-section maps as HIT, treating price-only moves as HIT unless Q3 of the three questions is attached to a same-thesis issuer event already on the card.

## Ping rule
Owner opened this column. File the stamp. Ping only HIT or MISS. LATE/NONE = file exists, no extra ping unless Owner asks.

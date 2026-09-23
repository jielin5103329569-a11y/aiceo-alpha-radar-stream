# Daily column: 已落纸井 × 当日发行人 Reality
version: ladder-daily/v0
opened: 2026-09-22
layer: knowledge-only
live5: no
alertReady: no
buy: no
productionAuthority: false
8080: untouched
owner_trigger: forbidden

## Cadence (automated)
Automation name: ladder-daily-issuer-column
Weekdays 14:30 America/Los_Angeles (after cash close + short AH window).
Grok fetches issuer IR / 8-K itself. Owner does not drop files, screenshots, or 「XX收盘」.
Path: MEMORY_V1/LADDER/DAILY/YYYY-MM-DD.md
Empty day is still a file. NONE is a legal value. Missing file on a weekday is a protocol miss by Grok, not by Owner.

## Universe
Exactly MEMORY_V1/BOTTLENECK/WELLS.yaml. No extra tickers.

## Allowed marks
- HIT: issuer IR / 8-K / official guide that hits that well Visual Memory or company_pattern AFTER lock date, not already LATE on the ladder card.
- MISS: such an event existed and was not on the ladder.
- NONE: no qualifying issuer event.
- LATE: event exists but awareness clock already late-vs-reprice / late-two-beats / LATE_VS_8K.

## Forbidden
live-5, alertReady, new host, keyword patch, rewriting old PACKs, Eyes B-section as HIT, price-only HIT, asking Owner to collect evidence.

## Ping
HIT or MISS: name well + one URL.
All NONE/LATE: four-line stamp only.

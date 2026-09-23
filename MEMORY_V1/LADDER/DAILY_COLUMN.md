# Daily column: 已落纸井 × 当日发行人 Reality
version: ladder-daily/v1
opened: 2026-09-22
layer: knowledge-only
live5: no
alertReady: no
buy: no
productionAuthority: false
8080: untouched
owner_trigger: forbidden

## Cadence (automated)
Two offset hourly jobs = 30 minutes in the US session window, weekdays America/Los_Angeles:
- ladder-30min-half 06:30–14:30 PT (:30)
- ladder-30min-hour 07:00–14:00 PT (:00)
Scheduler minimum step is 60 minutes; 30 minutes is the two-job interleave. Not a 8080 firehose.
Grok fetches issuer IR / 8-K itself. Owner does not drop files.
Path: MEMORY_V1/LADDER/DAILY/YYYY-MM-DD.md (same-day file; append HIT/MISS, do not erase earlier HIT/MISS).
Missing weekday session file is a Grok miss, not Owner's.

## Universe
Exactly MEMORY_V1/BOTTLENECK/WELLS.yaml. No extra tickers.

## Allowed marks
HIT / MISS / NONE / LATE as before. Price-only and Eyes B-section are not HIT.

## Forbidden
live-5, alertReady, new host, keyword patch, rewriting old PACKs, asking Owner for evidence.

## Ping
HIT or MISS: well + one URL.
All NONE/LATE: four-line stamp only.

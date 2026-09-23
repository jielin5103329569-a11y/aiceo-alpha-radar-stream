# Issuer Event Ladder TEMPLATE
version: ladder/v0
layer: knowledge-only
live5: no
alertReady: no
buy: no
productionAuthority: false
8080: untouched
Databento: untouched

## Purpose
Give every already-on-paper well (main shell or side branch) a retrievable event ladder so Visual Memory can fire when issuer reality arrives. This is not a ticker keyword patch.

## Applies to
Every row in MEMORY_V1/BOTTLENECK/WELLS.yaml, including class H / research-* / side-branch.

## Forbidden
- New API, adapter, bridge, host, 8080 route
- live-5 / alertReady / productionAuthority flip
- Full-market EDGAR stream
- Rewriting old PACKs after price moves
- Adding keywords as the fix

## Required fields
- well_id
- shell (US ticker or null)
- visual_memory (node list, arrows)
- company_pattern (historical analogy already observed for THIS issuer, or NONE)
- issuer_ir_home
- filings_slot (yes/no — yes only if shell exists)
- open_table (yes if stage >= catalyst-watch)
- stage: research-rent | catalyst-watch | reality-confirmed | late-vs-reprice | killed
- live5: no (default)

## Three questions on every new issuer event
1. Hits a Visual Memory node?
2. Hits this issuer's company_pattern?
3. Same session/next session Price Anomaly with the same thesis?

Any YES → stage at least catalyst-watch (still paper, still no buy). Must appear in that session's 3-cell. Empty silence is a protocol miss.

## Daily resweep add-on (one column only)
已落纸井 × 当日发行人 Reality = HIT / MISS / NONE.
Do not open a second repair task from this file.

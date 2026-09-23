# External Eyes × Issuer Event Ladder
Effective: 2026-09-22 next PACK onward. Do not rewrite old PACKs.
No buy. No live-5. No alertReady. No 8080. No productionAuthority.
Trading authority stays with Owner.

## Why
2026-09-22 internal ladder fix lived only in MEMORY_V1/LADDER.
Eyes PACKs 09-20..09-22 did not have to test already-on-paper Visual Memory.
That is a breakpoint: Eyes can print Power Hidden X and miss a VPD license that already had a well card.

## Mandatory block on every new PACK
After A-section, before B-section, include:

LADDER_CHECK:
- well_id:
  mark: HIT | MISS | NONE | LATE
  visual_node_hit: yes/no
  company_pattern_hit: yes/no
  issuer_event: none | <one official sentence>
  catalyst_public_at: UNKNOWN | YYYY-MM-DD[ HH:mm PT]
  status_if_hit: catalyst-watch | reality-confirmed | late-vs-reprice | HOLD | unchanged
  not_a_buy: yes

Universe = MEMORY_V1/BOTTLENECK/WELLS.yaml rows, including side branches.
A pack with no LADDER_CHECK is PACK_PARTIAL.
B-section maps are not a substitute for LADDER_CHECK.

## HIT rule (Eyes side)
If pack reality hits an existing well Visual Memory or that issuer company_pattern:
- mark HIT (or LATE if awareness clock already late)
- NAMED the shell only if a US ticker exists on that well
- timing vs official print, not vs later price
Do not open a new well because a sibling ticker moved.

## Handoff without Owner fetch
When a PACK lands in EXTERNAL_EYES/PACKS/, Grok writes OUTCOME mapping AND copies any HIT/MISS into MEMORY_V1/LADDER/DAILY/YYYY-MM-DD.md.
Owner is not asked to drop the pack into chat for the ladder to fire.
Eyes remains unwired to live scoring until Owner later opens that gate.

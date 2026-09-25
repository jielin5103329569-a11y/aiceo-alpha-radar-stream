# External Eyes PACK handoff
Owner-approved 2026-09-20. Cadence patch 2026-09-25: 3 hours.
Cadence: 3 hours.
GPT 3H scan → full Frozen PACK including LADDER_CHECK → store verbatim in EXTERNAL_EYES/PACKS/.
Do not edit PACK body. Do not overwrite old packs.

On every inbound pack, Grok without Owner reminder:
1. Write EXTERNAL_EYES/OUTCOME/<same-stamp>_MAPPING.md
2. Run LADDER_CHECK vs paper wells; append-only DAILY mapping
3. Push glance roster (GLANCE_MODE) for that 3H window
4. Notify Owner only on HIT/MISS: TICKER / STATUS / CATALYST / URL. Trading authority stays with Owner.

A pack missing LADDER_CHECK = PACK_PARTIAL in the mapping file.
Not buy. Not live-5. Not alertReady. Not 8080 integration.

# External Eyes PACK header + NAMED template
# Owner approved via Grok audit 2026-09-21
# Use from next 6H PACK. Do not rewrite old PACKs.
# No live-5. Not a buy. No Internal WELLS write.

pack_generated_at: YYYY-MM-DD HH:mm PT | UNKNOWN
scan_status: complete | partial | failed
source_failures: none | <short list>
pack_integrity: FULL | PACK_PARTIAL

# NAMED only if a ticker is formally named this pack.
# If named_at or catalyst_public_at lacks clock time: timing_classification cannot be EARLY or SAME_DAY.
# then_known: only excerpts already in this pack or earlier PACKs.

NAMED:
- ticker:
- layer:
- named_at: YYYY-MM-DD HH:mm PT | UNKNOWN
- then_known:
  - <excerpt already in this pack or earlier PACKs>
- first_verifiable_catalyst_already_public: yes/no/UNKNOWN
- catalyst_public_at: YYYY-MM-DD HH:mm PT | YYYY-MM-DD | UNKNOWN
- timing_classification: EARLY | SAME_DAY | LATE_VS_8K | DATE_ONLY | UNKNOWN
- discovery_path: anomaly_to_ticker | ticker_to_story | UNKNOWN
- filed_to_owner_handoff: yes
- not_a_buy: yes

CONTROLS:
- ticker:
  same_chain:
  state_at_t0: NOT_BUY | ALREADY_PRICED | WRONG_SHELL | FALSE_CATALYST | NO_CLEAN_US | NOT_SCANNED | UNKNOWN
  reason_at_t0: EVIDENCE_INSUFFICIENT | ALREADY_PRICED | WRONG_SHELL | FALSE_CATALYST | NO_CLEAN_US | NOT_SCANNED | UNKNOWN

- ticker:
  same_chain:
  state_at_t0: NOT_BUY | ALREADY_PRICED | WRONG_SHELL | FALSE_CATALYST | NO_CLEAN_US | NOT_SCANNED | UNKNOWN
  reason_at_t0: EVIDENCE_INSUFFICIENT | ALREADY_PRICED | WRONG_SHELL | FALSE_CATALYST | NO_CLEAN_US | NOT_SCANNED | UNKNOWN

- ticker:
  same_chain:
  state_at_t0: NOT_BUY | ALREADY_PRICED | WRONG_SHELL | FALSE_CATALYST | NO_CLEAN_US | NOT_SCANNED | UNKNOWN
  reason_at_t0: EVIDENCE_INSUFFICIENT | ALREADY_PRICED | WRONG_SHELL | FALSE_CATALYST | NO_CLEAN_US | NOT_SCANNED | UNKNOWN

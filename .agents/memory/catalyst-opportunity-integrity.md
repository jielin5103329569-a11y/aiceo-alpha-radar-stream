---
name: Catalyst opportunity integrity
description: Truthfulness and independence requirements for Catalyst Radar opportunity states.
---

External catalyst categories are provider-neutral availability states until a real authorized source supplies an event. Unavailable categories must expose no event record or event timestamp. A catalyst event, market microstructure, Alpha confirmation, and sector/industry peer confirmation are separate evidence categories; a confirmed opportunity requires fresh independent evidence from all four.

**Why:** A missing news or filing feed can otherwise look like quiet-but-real context, while treating a single catalyst, stale quote window, or unclassified peer group as corroboration overstates what the system knows.

**How to apply:** Keep market-only setups at WATCH or PRE-BREAKOUT. Invalidate the market contribution when the protected window is stale or incomplete. SEC EDGAR metadata may establish only a real filing event: prefer 8-K, keep 10-Q/10-K informational, preserve SEC filed time versus local receipt time, and mark delayed retrieval as lagged. A configured source or empty poll never creates evidence. Only calculate sector confirmation from fresh eligible records with trusted classification and enough fresh same-industry peers; return unavailable or insufficient with the missing requirement otherwise.
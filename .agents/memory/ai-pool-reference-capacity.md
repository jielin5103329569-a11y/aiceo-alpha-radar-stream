---
name: AI pool reference capacity
description: Guardrails for bounded, on-demand Security Master enrichment in the AI industry discovery pool.
---

Targeted Reference enrichment must reserve one canonical request identifier in the persistent ledger before dispatching a provider request. Capacity allocation must be serialized across API processes, and a crash after dispatch must retain the reservation rather than quietly making capacity available again.

**Why:** A read-only capacity check can allow concurrent instances or a restart window to exceed the declared identifier ceiling and leave provider usage unaccounted.

**How to apply:** Treat the ledger as the authority, not an in-memory count. Settle a reservation only after correlating each response to its requested symbol. A missing, unexpected, inactive, or non-common-equity record stays withheld and cannot become sector, Alert, or Buy evidence.
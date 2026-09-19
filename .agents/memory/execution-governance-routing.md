---
name: Execution governance routing
description: Durable authority and evidence rules for EG-001 capability selection and execution backtraces.
---

EG-001 capability routing must use capability-scoped, independently verified performance evidence. Model or agent identity is not a routing signal. The layer remains subordinate to the Owner Protection Triad and always has `productionAuthority=false`.

**Why:** Routing identity or extending execution authority would turn a performance aid into a second authority system. Durable contract/context/policy bindings, independent verification, First-Resolution evidence, and append-only backtraces prevent that expansion.

**How to apply:** Keep all future routing metrics outcome-based and durably attributable. Treat `REOPENED` as terminal for the original governed run; any new resolution needs a new governed execution identity rather than reuse of prior verification.
---
name: Research sidecar authority
description: Authority and provenance boundaries for value-research observations and cross-source resonance.
---

Treat Alex/Moonvest and Serenity as independent append-only research lanes. Cross-source resonance may be derived only from separate lanes that identify the same admitted US security or canonical industry chain. A delisted or non-US security can contribute industry-chain context but can never be promoted as a US ticker.

**Why:** Research observations are useful for offline review, but letting them influence Alpha scoring, ranking, candidate admission, alert readiness, market-data health, automatic trades, or model upgrades would violate the production system's verified-evidence boundary.

**How to apply:** Keep capture, persistence, retrieval, and resonance inside the research sidecar. Sidecar reads and failures must never enter production Radar call paths. Require explicit identity provenance before research-watch admission, and preserve unavailable fields instead of inferring facts.
---
name: Classification freshness
description: Freshness and provenance rules for trusted sector, industry-group, and industry records.
---

An authorized classification requires a complete sector, industry-group, and industry hierarchy, explicit provider provenance, and its own provider classification-effective timestamp. Never borrow the listing/reference timestamp to make taxonomy fresh. Definition-only records are always unauthorized, and missing or stale taxonomy must stay unavailable to every sector, catalyst, and alert-adjacent consumer.

**Why:** Listing lifecycle updates can arrive while the provider taxonomy is old or absent. Treating the broader snapshot timestamp as classification freshness can silently re-enable sector ranking or peer confirmation on unverified data.

**How to apply:** Evaluate taxonomy freshness independently against the bounded classification age policy before calculating reference classification quality or returning classification availability. Require `available` classification state, plus existing fresh-live evidence, before grouping sector constituents or accepting same-industry peers.
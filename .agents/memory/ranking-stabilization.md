---
name: Ranking stabilization
description: Safety rules for cross-symbol live ranking hysteresis and freshness invalidation.
---

Confirm a cross-symbol reorder only when the eligible candidates produce distinct, consecutive scan signatures that agree on the new order. Repeated status reads and changing timestamps from building, stale, stopped, or otherwise ineligible peers must not count as confirmation. An ineligible symbol loses its numeric rank immediately rather than being protected by reorder hysteresis.

**Why:** Status reads can recompute freshness snapshots and timestamps even when no new eligible market scan occurred. Including those values in the stabilization signature lets polling or an unrelated stale peer manufacture the second observation needed to commit a reorder.

**How to apply:** Build anti-flap signatures only from currently eligible candidates' immutable scan identity and ranking inputs. Keep freshness eligibility outside the hysteresis barrier, and test pending reorders while an ineligible peer's status timestamp changes between repeated reads.
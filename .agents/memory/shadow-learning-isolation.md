---
name: Shadow Learning isolation
description: Durable rules for evaluating experimental strategies without influencing live Alpha Radar behavior.
---

Shadow Learning remains an observational sidecar: it may accept only server-observed fresh, complete, streaming, eligible snapshots; it never writes to live scoring, routing, focused-symbol selection, freshness gates, or scan scheduling. Promotion is a read-only manual-review candidate, never an automatic strategy replacement.

**Why:** Experimental output must measure production behavior without influencing the behavior under evaluation. Relaxing this boundary would bias the cohort and risk production alerts or scans.

**How to apply:** Keep trigger/evidence and future outcomes in separate immutable archive-backed records. Withhold metrics and promotion whenever archive recovery, evidence integrity, or outcome durability is incomplete. Compare baseline and shadow only through the server's fixed matching cohort and independent holdout rules.
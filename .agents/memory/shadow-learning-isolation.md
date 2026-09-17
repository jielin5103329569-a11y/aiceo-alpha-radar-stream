---
name: Shadow Learning isolation
description: Durable rules for evaluating experimental strategies without influencing live Alpha Radar behavior.
---

Shadow Learning remains an observational sidecar: it may accept only server-observed fresh, complete, streaming, eligible snapshots; it never writes to live scoring, routing, focused-symbol selection, freshness gates, or scan scheduling. Promotion is a read-only manual-review candidate, never an automatic strategy replacement.

**Why:** Experimental output must measure production behavior without influencing the behavior under evaluation. Relaxing this boundary would bias the cohort and risk production alerts or scans.

**How to apply:** Keep trigger/evidence and future outcomes in separate immutable archive-backed records. Withhold metrics and promotion whenever archive recovery, evidence integrity, or outcome durability is incomplete. Compare baseline and shadow only through the server's fixed matching cohort and independent holdout rules.

Every immutable archive key must include all evidence that participates in its record hash. Exact retries stay idempotent, but a changed score, feature snapshot, lifecycle state, or other immutable context must receive a distinct key rather than competing with earlier evidence.

**Why:** A stable transition timestamp or price tuple can be observed repeatedly while its evidence changes. Reusing one key causes valid observations to collide even though the archive correctly refuses overwrites.

**How to apply:** Version key algorithms without rewriting existing records. Integrity validation and recovery must continue accepting legacy keys, while new records derive identity from the complete immutable evidence envelope.

Outcome identity needs the same treatment as trigger and price identity. A `trigger + horizon` tuple is not immutable evidence when price observations may arrive out of order; recovery can later compute a different complete outcome from a more complete historical window.

**Why:** Reusing one outcome key for a changed complete-window calculation correctly triggers the archive's overwrite protection and leaves recovery unavailable. Silently keeping the first calculation would discard later evidence.

**How to apply:** Preserve every existing outcome object. Before retrying recovery, define versioned immutable outcome snapshots and a deterministic read policy that selects the authoritative complete snapshot without double-counting a trigger/horizon cohort.
---
name: Validation persistence isolation
description: Integrity rules for persisting trigger evidence and outcomes without changing live Alpha Radar behavior.
---

Signal validation is a sidecar, not an input to live scoring. Any pending, failed, invalid, or unavailable trigger persistence must withhold all numeric accuracy rather than publish metrics from an incomplete cohort. Trigger writes require immutable idempotency keys and hashes; retries may replay safely. Durable file or network I/O must run asynchronously so storage latency cannot delay scans, ranking, confirmation, or focused-symbol handling.

**Why:** Dropped triggers bias outcome metrics toward periods when storage was healthy, while synchronous durability work can alter the live behavior the validation layer is supposed to measure. Simultaneously guaranteeing zero loss after database failure, all local durable paths failing, and immediate host replacement requires an independent durable queue; it cannot be achieved by blocking live radar without violating isolation.

**How to apply:** Treat any persistence backlog or integrity fault as validation unavailable and return null accuracy values. Keep price observations bounded/coalesced, but preserve trigger records through an idempotent outbox. If host-replacement durability must cover total local-storage failure, add an independent write-ahead service rather than awaiting persistence on the live scan path.

Cross-host signal evidence uses an immutable object archive as a second durability tier; the API must initialize the Replit App Storage client with the local sidecar external-account credentials rather than default Google application credentials. Archive recovery must finish before validation is marked caught up, and archive errors must withhold accuracy.

**Why:** A database plus local fsync-backed files still loses the only copy during simultaneous database failure and host replacement. The sidecar credential path is an environment-specific requirement for the persistent archive to work inside Replit.

**How to apply:** Keep archive objects keyed by the immutable event key and verify record hashes on precondition conflicts. On startup, replay archive records idempotently into PostgreSQL; never delete the archive copy after database acknowledgement.

Durable acceptance occurs only after the independent archive acknowledges the exact `(eventKey, recordHash)` pair. A capture that is merely in memory, still writing, or conflicts with an accepted/pending hash is not accepted and must never enter the local replay queue. During recovery, the archive-backed matching hash wins over any conflicting local outbox record.

**Why:** Event-key-only deduplication can make a conflicting snapshot appear accepted or allow it to mask the only durable original during host reconstruction.

**How to apply:** Keep pending and completed archive proof hash-bound, enqueue local replay only after exact archive proof, and reconcile legacy local conflicts by discarding the mismatched queue record before replaying the archive copy.

Outcome checkpoints require their fresh post-signal price observations to survive the same replacement boundary as the trigger. Archive only observations for symbols with validation signals, replay them after trigger recovery, and withhold metrics while either price archival or replay is pending.

**Why:** Restoring a trigger without the observed prices that produced its drawdown, hit, and lead-time outcome leaves an apparently complete but materially incomplete audit trail.

**How to apply:** Keep observation objects append-only under deterministic observation keys, preserve their original timestamps/source/freshness, and never synthesize a replacement price during replay.
---
name: Validation persistence isolation
description: Integrity rules for persisting trigger evidence and outcomes without changing live Alpha Radar behavior.
---

Signal validation is a sidecar, not an input to live scoring. Any pending, failed, invalid, or unavailable trigger persistence must withhold all numeric accuracy rather than publish metrics from an incomplete cohort. Trigger writes require immutable idempotency keys and hashes; retries may replay safely. Durable file or network I/O must run asynchronously so storage latency cannot delay scans, ranking, confirmation, or focused-symbol handling.

**Why:** Dropped triggers bias outcome metrics toward periods when storage was healthy, while synchronous durability work can alter the live behavior the validation layer is supposed to measure. Simultaneously guaranteeing zero loss after database failure, all local durable paths failing, and immediate host replacement requires an independent durable queue; it cannot be achieved by blocking live radar without violating isolation.

**How to apply:** Treat any persistence backlog or integrity fault as validation unavailable and return null accuracy values. Keep price observations bounded/coalesced, but preserve trigger records through an idempotent outbox. If host-replacement durability must cover total local-storage failure, add an independent write-ahead service rather than awaiting persistence on the live scan path.
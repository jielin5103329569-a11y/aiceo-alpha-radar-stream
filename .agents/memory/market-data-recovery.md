---
name: Market data recovery
description: Health and recovery policy for server-side live market-data providers.
---

Show the provider heartbeat, the last received market event, and the reconnect
state as separate pieces of health information. Retry an interrupted provider
connection with bounded exponential backoff rather than an unbounded loop.
Timestamp an authenticated local bridge heartbeat when the server receives it;
the provider event timestamp remains the authority for market-data freshness.

**Why:** A live equity feed can be quiet during sparse pre/post-market periods.
Treating a lack of quotes as a stale connection produces false outage alerts,
while unlimited retries can cause noisy flapping when a provider is unavailable.

**How to apply:** Reuse this distinction for every future market-data source.
Any later analysis layer should consider the last market-event time, not merely
the service heartbeat, when deciding whether input data is fresh enough. A
fresh heartbeat alone must never restore scores or alert readiness. A delayed
server watchdog callback must recognize event-loop delay and allow one bounded
interval for queued authenticated heartbeats to drain; if no pulse arrives,
normal timeout and fail-closed recovery resume on the next check.
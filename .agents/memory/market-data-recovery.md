---
name: Market data recovery
description: Health and recovery policy for server-side live market-data providers.
---

Show the provider heartbeat, the last received market event, and the reconnect
state as separate pieces of health information. Retry an interrupted provider
connection with bounded exponential backoff rather than an unbounded loop.

**Why:** A live equity feed can be quiet during sparse pre/post-market periods.
Treating a lack of quotes as a stale connection produces false outage alerts,
while unlimited retries can cause noisy flapping when a provider is unavailable.

**How to apply:** Reuse this distinction for every future market-data source.
Any later analysis layer should consider the last market-event time, not merely
the service heartbeat, when deciding whether input data is fresh enough.
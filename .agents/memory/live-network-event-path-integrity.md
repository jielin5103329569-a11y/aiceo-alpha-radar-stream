---
name: Live network event-path integrity
description: Fail-closed rules for live bridge heartbeat, recovery, buffering, and alert readiness.
---

The live bridge must treat connection, heartbeat, and market-event evidence as independent. Only the bridge's own emitted heartbeat timestamp is heartbeat evidence; receipt time, a successful connection, and market traffic must never refresh it.

**Why:** Buffered data or a retired bridge can otherwise make an unhealthy path look current and restore production alert eligibility on stale or incomplete evidence.

**How to apply:** Bind bridge callbacks and queued events to a recovery generation; retire the child, output buffer, and queue atomically on failure before reconnecting. Account for rejected events explicitly, require a new heartbeat plus an ordered low-latency market window, and keep alert readiness false until every independent gate is re-established.
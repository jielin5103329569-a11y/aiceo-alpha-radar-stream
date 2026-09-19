---
name: Failed workflow process ownership
description: Workflow status can diverge from ownership of a still-live listener process.
---

A workflow reported as failed can still retain ownership of a live incumbent process that successfully serves its configured port. Do not assume stopping a failed workflow is metadata-only.

**Why:** Stopping a failed API workflow terminated the healthy incumbent listener that had caused a duplicate restart attempt to fail with EADDRINUSE.

**How to apply:** Before stopping a failed workflow, inspect its process and port ownership. If the incumbent is healthy, preserve it. API boot must treat exactly one listener with a matching singleton health identity and owner PID as an idempotent success; foreign, ambiguous, or unhealthy ownership fails closed without binding or termination.
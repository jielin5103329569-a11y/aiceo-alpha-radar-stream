---
name: Operational audit isolation
description: Rules for keeping runtime incident persistence separate from supervision and live Alpha Radar authority.
---

Runtime incident and recovery audits are operational evidence, not a dependency of the live application path. Any audit-store error must be caught at the supervisor boundary so observation and bounded local recovery continue without creating, withholding, or changing market freshness, scoring, candidate eligibility, Alert authority, or service lifecycle.

**Why:** A persistence outage is useful operational evidence, but letting it reject a monitoring loop turns an audit failure into a loss of visibility and can blur the fail-closed separation from live market and Alert behavior.

**How to apply:** New supervisor audit writes must be best-effort and explicit about persistence health. Read endpoints may report storage unavailability, but market and Alert workflows must not depend on those writes or reads.
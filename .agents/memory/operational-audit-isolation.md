---
name: Operational audit isolation
description: Rules for keeping runtime incident persistence separate from supervision and live Alpha Radar authority.
---

Runtime incident and recovery audits are operational evidence, not a dependency of the live application path. Any audit-store error must be caught at the supervisor boundary so observation and bounded local recovery continue without creating, withholding, or changing market freshness, scoring, candidate eligibility, Alert authority, or service lifecycle.

**Why:** A persistence outage is useful operational evidence, but letting it reject a monitoring loop turns an audit failure into a loss of visibility and can blur the fail-closed separation from live market and Alert behavior.

**How to apply:** New supervisor audit writes must be best-effort and explicit about persistence health. Read endpoints may report storage unavailability, but market and Alert workflows must not depend on those writes or reads.

Diagnostic evidence must be recursively sanitized before both logging and persistence, then sanitized again on restoration. Free-text coverage must include headers, cookies, credential key/value forms, JWTs, credentialed URLs, query secrets, and provider-key formats; structured sensitive keys require the same coverage.

**Why:** Format-specific masking left common credential forms able to survive in summaries and facts even when direct secret fields were redacted.

**How to apply:** Use only synthetic credential fixtures, and exercise the real persistence/query/cleanup boundary against PostgreSQL. Retention cleanup must remain source-scoped so runtime and Alert records cannot be removed.
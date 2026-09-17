---
name: AICEO external-agent authority
description: Durable authority, execution, and recovery boundaries for AICEO-managed external agents.
---

External agents must operate through one PostgreSQL-authoritative AICEO control plane. At most one task may be RUNNING or VALIDATING; explicit independent validation is required before COMPLETED. FAILED, UNKNOWN, or STALE work pauses the queue until it is diagnosed into a non-runnable terminal state and recovery is acknowledged.

**Why:** Process-local state, automatic replay after unsettled execution, or external-agent access to production services can duplicate side effects and bypass Alpha Radar's verified-evidence boundaries.

Provider execution needs a durable attempt fence before any network call. The first RUNNING transition and first attempt claim must commit atomically; retries must remain bound to the original executor and may settle only the matching attempt ID. Apply one timeout across dispatch and response-body consumption. Missing usage or an abandoned attempt is UNKNOWN and never replayable.

**Why:** A second execute request, a process crash between state transitions, or a response body that stalls after headers can otherwise clear another invocation's fence, lose usage evidence, or strand the sole active slot.

**How to apply:** Keep provider identity, frozen policies, permissions, budgets, Kill Switch, circuit state, tasks, timestamps, attempt ownership/deadlines, and hash-chained audit events durable. Register schema changes as incremental migrations in the migration ledger. Never grant shell, workflow, trading, model-upgrade, production, Alpha, Radar, Databento, Alert, or arbitrary network/tool authority.

Owner is the ultimate human governance authority. Financial and physical assets, legal liability, and AICEO system integrity are protected red lines. The AICEO Brain has maximum technical sovereignty only below those lines; external agents have delegated technical authority only. Any red-line protection change requires independent, server-authenticated Owner governance approval that is bound to immutable full task intent and audit provenance. Unknown, ambiguous, unclassified, conflicting, missing-authority, or stale-role cases fail closed and are audited. Kill Switch, circuit recovery, and recovery acknowledgment remain Owner-exclusive controls above execution.

**Why:** Ordinary task approval, client-declared classification, unkeyed approval hashes, or stale session roles can otherwise impersonate Owner authority or weaken protection without independent consent.

**How to apply:** Keep legacy work explicitly unclassified and non-runnable. Treat current server-fetched identity metadata as authoritative, authenticate Owner approval evidence with a server-held key, freeze approved intent at the database boundary, and never let task execution or validation mint Owner authority.
---
name: AICEO external-agent authority
description: Durable authority, execution, and recovery boundaries for AICEO-managed external agents.
---

External agents must operate through one PostgreSQL-authoritative AICEO control plane. At most one task may be RUNNING or VALIDATING; explicit independent validation is required before COMPLETED. FAILED, UNKNOWN, or STALE work pauses the queue until it is diagnosed into a non-runnable terminal state and recovery is acknowledged.

**Why:** Process-local state, automatic replay after unsettled execution, or external-agent access to production services can duplicate side effects and bypass Alpha Radar's verified-evidence boundaries.

**How to apply:** Keep provider identity, frozen policies, permissions, budgets, Kill Switch, circuit state, tasks, timestamps, and hash-chained audit events durable. Start with synthetic self-check authority only. Never grant shell, workflow, trading, model-upgrade, production, Alpha, Radar, Databento, Alert, or arbitrary network/tool authority.
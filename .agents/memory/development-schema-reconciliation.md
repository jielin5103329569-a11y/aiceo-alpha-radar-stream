---
name: Development schema reconciliation
description: Safe database setup after task merges in the development environment.
---

Use a non-interactive Drizzle schema reconciliation command in post-merge setup instead of replaying the historical migration journal.

**Why:** The development database can contain tables created before the matching migration was entered in the Drizzle ledger. Replaying that migration then fails on duplicate DDL even though the desired schema already exists.

**How to apply:** Keep post-merge setup idempotent and restricted to the development database. Reconcile the current schema after dependency installation, then let Replit's Publish flow diff development and production schemas; never add a production migration hook or startup DDL.
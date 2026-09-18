---
name: Development schema reconciliation
description: Safe database setup after task merges in the development environment.
---

Use a non-interactive Drizzle schema reconciliation command in post-merge setup instead of replaying the historical migration journal. Keep every dependency-bearing constraint represented in the current Drizzle schema, including composite unique constraints required by composite foreign keys.

**Why:** The development database can contain tables created before the matching migration was entered in the Drizzle ledger. Replaying that migration then fails on duplicate DDL even though the desired schema already exists. If the current schema omits an existing constraint, reconciliation may try to drop it and PostgreSQL will correctly block the drop when a foreign key depends on it. Drizzle CLI can also print a database `error:` while returning exit code 0.

**How to apply:** Keep post-merge setup idempotent and restricted to the development database. Reconcile the current schema after dependency installation, represent dependent constraints with their exact database names, and treat either a nonzero exit code or error output as failure. Then let Replit's Publish flow diff development and production schemas; never add a production migration hook or startup DDL.
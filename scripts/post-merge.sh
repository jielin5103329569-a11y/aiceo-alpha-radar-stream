#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
# Development schema is reconciled after task merges. `migrate` replays the
# historical Drizzle journal and cannot recover a schema created before its
# ledger entry existed; push-force safely diffs the current development schema.
pnpm --filter @workspace/db run push-force
# Drizzle schema reconciliation does not manage PostgreSQL functions or
# triggers. Reinstall the idempotent Development-only AICEO persistence guard
# after every schema reconciliation so newly added AICEO tables are covered.
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f lib/db/drizzle/0044_aiceo_credential_persistence_firewall.sql

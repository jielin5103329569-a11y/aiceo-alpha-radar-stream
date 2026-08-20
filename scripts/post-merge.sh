#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
# Development schema is reconciled after task merges. `migrate` replays the
# historical Drizzle journal and cannot recover a schema created before its
# ledger entry existed; push-force safely diffs the current development schema.
pnpm --filter @workspace/db run push-force

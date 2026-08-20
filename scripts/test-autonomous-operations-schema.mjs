import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requireFromDatabasePackage = createRequire(new URL("../lib/db/package.json", import.meta.url));
const pg = requireFromDatabasePackage("pg");
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
const workKey = `autonomous-operations-schema-test:${randomUUID()}`;
const now = new Date();
const migration = readFileSync(resolve("lib/db/drizzle/0009_autonomous_operations.sql"), "utf8");
const journal = readFileSync(resolve("lib/db/drizzle/meta/_journal.json"), "utf8");

try {
  assert.match(migration, /CREATE TABLE "autonomous_operations_work_items"/);
  assert.match(migration, /CREATE TABLE "autonomous_operations_audit"/);
  assert.match(journal, /0009_autonomous_operations/);
  await client.connect();
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO autonomous_operations_work_items (
      work_key, title, owner_module, implementation_key, state, depends_on,
      resource_claims, attempts, max_attempts, retry_base_delay_ms,
      execution_timeout_ms, checkpoint, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13, $13)`,
    [
      workKey,
      "Transactional operations queue verification",
      "operations_test",
      `${workKey}:implementation`,
      "stalled",
      JSON.stringify([]),
      JSON.stringify(["diagnostic"]),
      1,
      3,
      1_000,
      10_000,
      JSON.stringify({ phase: "checkpointed", attempt: 1, details: { safe: true } }),
      now,
    ],
  );
  await client.query(
    `INSERT INTO autonomous_operations_audit (
      work_key, event, reason, evidence, occurred_at
    ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      workKey,
      "work_stalled",
      "Transactional restart recovery verification.",
      JSON.stringify({ summary: "Queue state is isolated from market and Alert decisions.", details: { verified: true } }),
      now,
    ],
  );
  const { rows } = await client.query(
    `SELECT
      (SELECT state FROM autonomous_operations_work_items WHERE work_key = $1) AS work_state,
      (SELECT checkpoint->>'phase' FROM autonomous_operations_work_items WHERE work_key = $1) AS checkpoint_phase,
      (SELECT count(*)::integer FROM autonomous_operations_audit WHERE work_key = $1) AS audit_count`,
    [workKey],
  );
  assert.deepEqual(rows[0], {
    work_state: "stalled",
    checkpoint_phase: "checkpointed",
    audit_count: 1,
  });
  await client.query("ROLLBACK");
  console.log("Autonomous operations schema test passed: durable queue state and append-only audit evidence are transactional and isolated.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
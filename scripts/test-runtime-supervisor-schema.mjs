import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const requireFromDatabasePackage = createRequire(new URL("../lib/db/package.json", import.meta.url));
const pg = requireFromDatabasePackage("pg");

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const incidentKey = `runtime-supervisor-schema-test:${randomUUID()}`;
const now = new Date();

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO runtime_supervisor_incidents (
      incident_key, component, reason_code, severity, state,
      first_detected_at, last_observed_at, occurrence_count, evidence
    ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8::jsonb)`,
    [
      incidentKey,
      "internal_execution",
      "expired_lease",
      "critical",
      "open",
      now,
      1,
      JSON.stringify({ summary: "Transactional schema verification.", componentState: "timed_out", details: {} }),
    ],
  );
  await client.query(
    `INSERT INTO runtime_supervisor_audit (
      incident_key, component, reason_code, event, severity, reason, evidence, occurred_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      incidentKey,
      "internal_execution",
      "expired_lease",
      "detected",
      "critical",
      "Transactional schema verification.",
      JSON.stringify({ summary: "Transactional schema verification.", componentState: "timed_out", details: {} }),
      now,
    ],
  );
  await client.query(
    `INSERT INTO runtime_supervisor_incidents (
      incident_key, component, reason_code, severity, state,
      first_detected_at, last_observed_at, occurrence_count, evidence
    ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8::jsonb)
    ON CONFLICT (incident_key) DO UPDATE SET
      component = EXCLUDED.component,
      reason_code = EXCLUDED.reason_code,
      severity = EXCLUDED.severity,
      state = EXCLUDED.state,
      last_observed_at = EXCLUDED.last_observed_at,
      evidence = EXCLUDED.evidence,
      updated_at = EXCLUDED.last_observed_at`,
    [
      incidentKey,
      "internal_execution",
      "recovery_blocked",
      "critical",
      "open",
      new Date(now.getTime() + 1_000),
      1,
      JSON.stringify({ summary: "Recovery remains blocked without a checkpoint.", componentState: "blocked", details: {} }),
    ],
  );
  await client.query(
    `INSERT INTO runtime_supervisor_audit (
      incident_key, component, reason_code, event, severity, reason, evidence, occurred_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      incidentKey,
      "internal_execution",
      "recovery_blocked",
      "recovery_failed",
      "critical",
      "Recovery remains blocked without a checkpoint.",
      JSON.stringify({ summary: "Recovery remains blocked without a checkpoint.", componentState: "blocked", details: {} }),
      new Date(now.getTime() + 1_000),
    ],
  );
  const { rows } = await client.query(
    `SELECT
      (SELECT count(*)::integer FROM runtime_supervisor_incidents WHERE incident_key = $1) AS incident_count,
      (SELECT reason_code FROM runtime_supervisor_incidents WHERE incident_key = $1) AS reason_code,
      (SELECT count(*)::integer FROM runtime_supervisor_audit WHERE incident_key = $1) AS audit_count,
      (SELECT event FROM runtime_supervisor_audit WHERE incident_key = $1 ORDER BY occurred_at DESC LIMIT 1) AS latest_audit_event`,
    [incidentKey],
  );
  assert.deepEqual(rows[0], {
    incident_count: 1,
    reason_code: "recovery_blocked",
    audit_count: 2,
    latest_audit_event: "recovery_failed",
  });
  await client.query("ROLLBACK");
  console.log("Runtime supervisor schema test passed: a stable incident key updates its recovery classification while recovery audit history remains append-only.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
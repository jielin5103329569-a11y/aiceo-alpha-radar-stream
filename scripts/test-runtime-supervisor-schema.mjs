import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const requireFromDatabasePackage = createRequire(new URL("../lib/db/package.json", import.meta.url));
const requireFromApiPackage = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const pg = requireFromDatabasePackage("pg");
const { build: esbuild } = requireFromApiPackage("esbuild");

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const incidentKey = `runtime-supervisor-schema-test:${randomUUID()}`;
const diagnosticKey = `diagnostic-schema-test:${randomUUID()}`;
const expiredDiagnosticKey = `diagnostic-expired-test:${randomUUID()}`;
const protectedRuntimeKey = `runtime-retention-isolation-test:${randomUUID()}`;
const actualDiagnosticKey = `diagnostic-store-test:${randomUUID()}`;
const actualExpiredDiagnosticKey = `diagnostic-store-expired-test:${randomUUID()}`;
const actualProtectedRuntimeKey = `runtime-store-isolation-test:${randomUUID()}`;
const now = new Date();
const outputDirectory = mkdtempSync(join(tmpdir(), "diagnostic-schema-test-"));
const sanitizationOutputPath = join(outputDirectory, "diagnosticSanitization.cjs");
const runtimeStoreEntryPath = join(outputDirectory, "runtimeStoreEntry.ts");
const runtimeStoreOutputPath = join(outputDirectory, "runtimeStoreEntry.cjs");
const loggerStubPath = join(outputDirectory, "loggerStub.ts");
let runtimeTestPool = null;
let clientConnected = false;

const sanitizationSource = readFileSync(resolve("artifacts/api-server/src/lib/diagnosticSanitization.ts"), "utf8");
writeFileSync(sanitizationOutputPath, typescript.transpileModule(sanitizationSource, {
  compilerOptions: {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText);
const {
  sanitizeDiagnosticEvidence,
  sanitizeDiagnosticPayload,
  sanitizeDiagnosticText,
} = createRequire(import.meta.url)(sanitizationOutputPath);

const synthetic = {
  bearer: "Bearer fixture-database-token-that-is-not-real",
  basic: "Authorization: Basic Zml4dHVyZS1kYjpub3QtcmVhbA==",
  cookie: "Cookie: session=fixture-database-cookie-not-real",
  multiCookie: "Cookie: theme=light; session=fixture-database-multi-cookie-not-real",
  headerKey: "x-api-key: fixture-database-header-not-real",
  clientSecret: "client_secret=fixture-database-client-secret-not-real",
  credential: "credential=fixture-database-credential-not-real",
  privateKey: "private_key=fixture-database-private-key-not-real",
  accessKey: "fixture-database-structured-access-key-not-real",
  jwt: "eyJmaXh0dXJlIjoiZGIifQ.Zml4dHVyZS1kYXRhYmFzZQ.Zml4dHVyZS1zaWduYXR1cmU",
  apiKey: "sk_fixture_database_value_not_real",
  password: "fixture-database-password-not-real",
};
const observedAt = new Date(now.getTime() - 60_000);
const expiredAt = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1_000);

function diagnosticPayload(moduleId, category, priority, disposition, validationState, secretText) {
  return {
    schemaVersion: 1,
    report: {
      id: `diagnostic:${moduleId}`,
      moduleId,
      category,
      priority,
      disposition,
      status: "active",
      symptom: secretText,
      rootCause: null,
      candidateRootCauses: [],
      impactScope: "Synthetic database isolation fixture.",
      recommendedFix: "No production action.",
      validation: {
        id: `validation:${moduleId}`,
        label: "Synthetic validation",
        state: validationState,
        reason: secretText,
        checkedAt: observedAt.toISOString(),
      },
      remainingRisk: "Synthetic fixture only.",
      evidence: [{
        source: "synthetic_test",
        summary: secretText,
        facts: {
          apiKey: synthetic.apiKey,
          url: `https://fixture-user:${synthetic.password}@example.invalid/check?secret=${synthetic.apiKey}`,
        },
        collectedAt: observedAt.toISOString(),
      }],
      firstObservedAt: observedAt.toISOString(),
      lastObservedAt: observedAt.toISOString(),
    },
    event: {
      id: randomUUID(),
      kind: "detected",
      occurredAt: observedAt.toISOString(),
      summary: secretText,
    },
  };
}

try {
  writeFileSync(loggerStubPath, "export const logger = { info() {}, warn() {} };\n");
  writeFileSync(
    runtimeStoreEntryPath,
    `export { RuntimeIncidentStore } from ${JSON.stringify(resolve("artifacts/api-server/src/lib/runtimeIncidentStore.ts"))};\n`
      + `export { pool as runtimeTestPool } from ${JSON.stringify(resolve("lib/db/src/index.ts"))};\n`,
  );
  await esbuild({
    entryPoints: [runtimeStoreEntryPath],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: runtimeStoreOutputPath,
    absWorkingDir: resolve("."),
    nodePaths: [resolve("node_modules")],
    external: ["pg-native"],
    logLevel: "silent",
    plugins: [{
      name: "runtime-store-test-logger",
      setup(build) {
        build.onResolve({ filter: /^\.\/logger$/ }, (args) => (
          args.importer.endsWith("runtimeIncidentStore.ts") ? { path: loggerStubPath } : null
        ));
      },
    }],
  });
  const runtimeStoreModule = createRequire(import.meta.url)(runtimeStoreOutputPath);
  const { RuntimeIncidentStore } = runtimeStoreModule;
  runtimeTestPool = runtimeStoreModule.runtimeTestPool;

  await client.connect();
  clientConnected = true;
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

  const sanitizedPayload = sanitizeDiagnosticPayload(
    diagnosticPayload("synthetic_module", "data", "P2", "data_unavailable", "failed", `${synthetic.bearer} ${synthetic.jwt}`),
  );
  const sanitizedEvidence = sanitizeDiagnosticEvidence({
    summary: `${synthetic.bearer} ${synthetic.jwt}`,
    componentState: "active",
    details: { authorization: synthetic.apiKey },
  });
  const sanitizedReason = sanitizeDiagnosticText(`${synthetic.bearer} ${synthetic.jwt}`, 500);
  const expiredPayload = sanitizeDiagnosticPayload(
    diagnosticPayload("expired_module", "governance", "P3", "expected_rejection", "passed", synthetic.apiKey),
  );
  const insertDiagnostic = async (key, source, timestamp, payload) => {
    await client.query(
      `INSERT INTO runtime_supervisor_incidents (
        incident_key, component, reason_code, severity, state, source,
        first_detected_at, last_observed_at, occurrence_count, evidence, diagnostic_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 1, $8::jsonb, $9::jsonb)`,
      [key, "diagnostics", payload.report.moduleId, "warning", "open", source, timestamp, JSON.stringify(sanitizedEvidence), JSON.stringify(payload)],
    );
    await client.query(
      `INSERT INTO runtime_supervisor_audit (
        incident_key, component, reason_code, event, source, severity, reason, evidence, diagnostic_payload, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
      [key, "diagnostics", payload.report.moduleId, "detected", source, "warning", sanitizedReason, JSON.stringify(sanitizedEvidence), JSON.stringify(payload), timestamp],
    );
  };
  await insertDiagnostic(diagnosticKey, "diagnostics", observedAt, sanitizedPayload);
  await insertDiagnostic(expiredDiagnosticKey, "diagnostics", expiredAt, expiredPayload);
  await insertDiagnostic(protectedRuntimeKey, "runtime", expiredAt, expiredPayload);

  const persisted = await client.query(
    `SELECT diagnostic_payload::text AS payload_text, evidence::text AS evidence_text, reason
       FROM runtime_supervisor_audit WHERE incident_key = $1`,
    [diagnosticKey],
  );
  const persistedText = JSON.stringify(persisted.rows);
  for (const value of Object.values(synthetic)) {
    assert.equal(persistedText.includes(value), false, "database must not retain synthetic sensitive value");
  }

  const filterResult = await client.query(
    `SELECT count(*)::integer AS count
       FROM runtime_supervisor_audit
      WHERE source = 'diagnostics'
        AND occurred_at >= $1
        AND diagnostic_payload #>> '{report,moduleId}' = $2
        AND diagnostic_payload #>> '{report,category}' = $3
        AND diagnostic_payload #>> '{report,priority}' = $4
        AND diagnostic_payload #>> '{report,disposition}' = $5
        AND diagnostic_payload #>> '{report,validation,state}' = $6`,
    [new Date(now.getTime() - 5 * 60_000), "synthetic_module", "data", "P2", "data_unavailable", "failed"],
  );
  assert.equal(filterResult.rows[0].count, 1, "combined diagnostic filters must select only the matching fresh row");

  await client.query(
    `DELETE FROM runtime_supervisor_incidents WHERE source = 'diagnostics' AND last_observed_at < $1`,
    [new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000)],
  );
  await client.query(
    `DELETE FROM runtime_supervisor_audit WHERE source = 'diagnostics' AND occurred_at < $1`,
    [new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000)],
  );
  const retention = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM runtime_supervisor_incidents WHERE incident_key = $1) AS expired_diagnostic_incidents,
       (SELECT count(*)::integer FROM runtime_supervisor_audit WHERE incident_key = $1) AS expired_diagnostic_events,
       (SELECT count(*)::integer FROM runtime_supervisor_incidents WHERE incident_key = $2) AS protected_runtime_incidents,
       (SELECT count(*)::integer FROM runtime_supervisor_audit WHERE incident_key = $2) AS protected_runtime_events,
       (SELECT count(*)::integer FROM runtime_supervisor_incidents WHERE incident_key = $3) AS fresh_diagnostic_incidents`,
    [expiredDiagnosticKey, protectedRuntimeKey, diagnosticKey],
  );
  assert.deepEqual(retention.rows[0], {
    expired_diagnostic_incidents: 0,
    expired_diagnostic_events: 0,
    protected_runtime_incidents: 1,
    protected_runtime_events: 1,
    fresh_diagnostic_incidents: 1,
  });

  const actualModuleId = `synthetic_${randomUUID().replaceAll("-", "")}`;
  const actualPayload = diagnosticPayload(
    actualModuleId,
    "data",
    "P1",
    "code_defect",
    "failed",
    `${synthetic.bearer} ${synthetic.basic} ${synthetic.cookie} ${synthetic.multiCookie} ${synthetic.headerKey} ${synthetic.clientSecret} ${synthetic.credential} ${synthetic.privateKey} ${synthetic.jwt}`,
  );
  const actualStore = new RuntimeIncidentStore();
  await actualStore.recordDiagnostic({
    incidentKey: actualDiagnosticKey,
    state: "open",
    event: "detected",
    severity: "critical",
    reason: `${synthetic.basic} ${synthetic.headerKey}`,
    evidence: {
      summary: `${synthetic.cookie} ${synthetic.jwt}`,
      componentState: "active",
      details: { password: synthetic.password, access_key: synthetic.accessKey, note: synthetic.bearer },
    },
    payload: actualPayload,
    occurredAt: observedAt,
  });
  assert.equal(actualStore.getHealth().state, "ready", "production diagnostic store write must succeed");

  await actualStore.recordDiagnostic({
    incidentKey: actualExpiredDiagnosticKey,
    state: "open",
    event: "detected",
    severity: "warning",
    reason: synthetic.apiKey,
    evidence: { summary: synthetic.bearer, componentState: "active", details: {} },
    payload: diagnosticPayload("actual_expired_module", "data", "P3", "data_unavailable", "waiting", synthetic.jwt),
    occurredAt: expiredAt,
  });
  assert.equal(actualStore.getHealth().state, "ready", "production expired diagnostic fixture write must succeed");

  await runtimeTestPool.query(
    `INSERT INTO runtime_supervisor_incidents (
      incident_key, component, reason_code, severity, state, source,
      first_detected_at, last_observed_at, occurrence_count, evidence
    ) VALUES ($1, 'runtime', 'isolation_fixture', 'warning', 'open', 'runtime', $2, $2, 1, $3::jsonb)`,
    [actualProtectedRuntimeKey, expiredAt, JSON.stringify({ summary: "Synthetic runtime isolation fixture.", componentState: "open", details: {} })],
  );
  await runtimeTestPool.query(
    `INSERT INTO runtime_supervisor_audit (
      incident_key, component, reason_code, event, source, severity, reason, evidence, occurred_at
    ) VALUES ($1, 'runtime', 'isolation_fixture', 'observed', 'runtime', 'warning', 'Synthetic runtime isolation fixture.', $2::jsonb, $3)`,
    [actualProtectedRuntimeKey, JSON.stringify({ summary: "Synthetic runtime isolation fixture.", componentState: "open", details: {} }), expiredAt],
  );

  const actualFiltered = await actualStore.listRecentDiagnostics({
    from: new Date(now.getTime() - 5 * 60_000),
    to: new Date(now.getTime() + 5 * 60_000),
    moduleId: actualModuleId,
    category: "data",
    priority: "P1",
    disposition: "code_defect",
    validationState: "failed",
    limit: 10,
  });
  assert.equal(actualFiltered.incidents.length, 1, "production store filters must select one incident");
  assert.equal(actualFiltered.events.length, 1, "production store filters must select one event");
  const actualFilteredText = JSON.stringify(actualFiltered);
  for (const value of Object.values(synthetic)) {
    assert.equal(actualFilteredText.includes(value), false, "production store result must not expose synthetic sensitive value");
  }

  const actualPersisted = await runtimeTestPool.query(
    `SELECT reason, evidence::text AS evidence_text, diagnostic_payload::text AS payload_text
       FROM runtime_supervisor_audit WHERE incident_key = $1`,
    [actualDiagnosticKey],
  );
  const actualPersistedText = JSON.stringify(actualPersisted.rows);
  for (const value of Object.values(synthetic)) {
    assert.equal(actualPersistedText.includes(value), false, "production store must not retain synthetic sensitive value");
  }

  const productionRetention = await runtimeTestPool.query(
    `SELECT
       (SELECT count(*)::integer FROM runtime_supervisor_incidents WHERE incident_key = $1) AS expired_diagnostic_incidents,
       (SELECT count(*)::integer FROM runtime_supervisor_audit WHERE incident_key = $1) AS expired_diagnostic_events,
       (SELECT count(*)::integer FROM runtime_supervisor_incidents WHERE incident_key = $2) AS protected_runtime_incidents,
       (SELECT count(*)::integer FROM runtime_supervisor_audit WHERE incident_key = $2) AS protected_runtime_events`,
    [actualExpiredDiagnosticKey, actualProtectedRuntimeKey],
  );
  assert.deepEqual(productionRetention.rows[0], {
    expired_diagnostic_incidents: 0,
    expired_diagnostic_events: 0,
    protected_runtime_incidents: 1,
    protected_runtime_events: 1,
  });

  await client.query("ROLLBACK");
  console.log("Runtime supervisor schema test passed: runtime history remains stable; synthetic diagnostic evidence is redacted in PostgreSQL, filters are exact, and retention cleanup is source-isolated.");
} catch (error) {
  if (clientConnected) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  if (clientConnected) await client.end();
  if (runtimeTestPool) {
    await runtimeTestPool.query(
      `DELETE FROM runtime_supervisor_audit WHERE incident_key = ANY($1::text[])`,
      [[actualDiagnosticKey, actualExpiredDiagnosticKey, actualProtectedRuntimeKey]],
    ).catch(() => undefined);
    await runtimeTestPool.query(
      `DELETE FROM runtime_supervisor_incidents WHERE incident_key = ANY($1::text[])`,
      [[actualDiagnosticKey, actualExpiredDiagnosticKey, actualProtectedRuntimeKey]],
    ).catch(() => undefined);
    await runtimeTestPool.end().catch(() => undefined);
  }
  rmSync(outputDirectory, { recursive: true, force: true });
}
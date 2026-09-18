import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  AiceoCredentialPersistenceError,
  assertCredentialPersistenceSafe,
  sanitizeProviderOutputForPersistence,
} from "../artifacts/api-server/src/lib/aiceoCredentialPersistenceFirewall";

const syntheticSecrets = [
  { password: "synthetic-password-value" },
  { nested: { client_secret: "synthetic-client-secret" } },
  "api key: sk-test-SYNTHETIC123456789",
  "Authorization: Bearer SYNTHETIC.BEARER.VALUE",
  "credential=synthetic-credential-value",
  "token: synthetic-token-value",
  "-----BEGIN PRIVATE KEY-----\nSYNTHETICONLY\n-----END PRIVATE KEY-----",
  ["safe", { nested: "Bearer SYNTHETIC.ARRAY.VALUE" }],
  "Authorization: Basic U1lOVEhFVElDOlBBWUxPQUQ=",
  "postgresql://synthetic-user:synthetic-password@db.invalid/example",
  "xoxb-SYNTHETIC-ONLY-1234567890",
  "AIzaSYNTHETICONLY123456789012345",
  { session_id: "synthetic-session-value" },
  { api_token: "synthetic-api-token" },
  { auth_token: "synthetic-auth-token" },
  { id_token: "synthetic-id-token" },
  { bearer_token: "synthetic-bearer-token" },
  { access_key: "synthetic-access-key" },
  { secret_key: "synthetic-secret-key" },
  { "X-API-Key": "synthetic-header-key" },
  { "X-Auth-Token": "synthetic-header-token" },
];
const normalValues = [
  "Token budget is capped at 512 output tokens.",
  "Secrets are never accessed or stored.",
  "The credential firewall rejected unsafe persistence.",
  { estimatedTokens: 1024, productionAuthority: false, tools: "disabled" },
  ["normal array", { evidenceHash: "a".repeat(64) }],
  "Basic authentication is disabled.",
  "postgresql connections require separate authentication.",
];

async function main() {
  for (const value of syntheticSecrets) {
    assert.throws(
      () => assertCredentialPersistenceSafe(value, "test"),
      (error) => error instanceof AiceoCredentialPersistenceError
        && !error.message.includes("synthetic-password-value")
        && !error.message.includes("synthetic-client-secret")
        && !error.message.includes("SYNTHETIC123456789")
        && !error.message.includes("synthetic-token-value"),
    );
  }
  for (const value of normalValues) assert.doesNotThrow(() => assertCredentialPersistenceSafe(value, "test"));

  const providerLeak = "Safe prefix. api_key=sk-test-SYNTHETICPROVIDER12345 Safe suffix.";
  const sanitized = sanitizeProviderOutputForPersistence(providerLeak, "provider");
  assert.equal(sanitized.redacted, true);
  assert.equal(sanitized.value.includes("SYNTHETICPROVIDER12345"), false);
  assert.match(sanitized.value, /\[REDACTED:/);
  assert.match(sanitized.originalDigest, /^[a-f0-9]{64}$/);

  const client = await pool.connect();
  const marker = `credential-firewall-test-${randomUUID()}`;
  try {
    await client.query("BEGIN");
    await assert.rejects(
      client.query(
        `INSERT INTO aiceo_audit_events
          (correlation_id,event_type,payload,append_sequence,event_hash,server_timestamp)
         VALUES ($1::uuid,'FIREWALL_TEST',$2::jsonb,2147483000,$3,now())`,
        [randomUUID(), JSON.stringify({ password: "synthetic-db-password" }), "f".repeat(64)],
      ),
      (error: any) => error?.message === "AICEO credential persistence blocked"
        && !String(error?.message).includes("synthetic-db-password")
        && !String(error?.detail).includes("synthetic-db-password"),
    );
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO aiceo_audit_events
        (correlation_id,event_type,payload,append_sequence,event_hash,server_timestamp)
       VALUES ($1::uuid,'FIREWALL_TEST',$2::jsonb,2147483000,$3,now())`,
      [randomUUID(), JSON.stringify({ marker, estimatedTokens: 512, productionAuthority: false }), "e".repeat(64)],
    );
    const visible = await client.query(
      "SELECT count(*)::int AS count FROM aiceo_audit_events WHERE payload->>'marker'=$1",
      [marker],
    );
    assert.equal(visible.rows[0].count, 1);
    await client.query("ROLLBACK");
    const persisted = await client.query(
      "SELECT count(*)::int AS count FROM aiceo_audit_events WHERE payload->>'marker'=$1",
      [marker],
    );
    assert.equal(persisted.rows[0].count, 0);
    const syntheticLeakCount = await client.query(`
      SELECT count(*)::int AS count FROM aiceo_audit_events
      WHERE payload::text LIKE '%synthetic-db-password%'
         OR payload::text LIKE '%SYNTHETICPROVIDER12345%'
    `);
    assert.equal(syntheticLeakCount.rows[0].count, 0);
    const coverage = await client.query(`
      SELECT
        count(*)::int AS table_count,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM pg_trigger trigger
          WHERE trigger.tgrelid = tables.oid
            AND NOT trigger.tgisinternal
            AND trigger.tgenabled <> 'D'
            AND pg_get_triggerdef(trigger.oid) LIKE '%aiceo_credential_persistence_guard%'
        ))::int AS guarded_count
      FROM pg_class tables
      JOIN pg_namespace namespace ON namespace.oid = tables.relnamespace
      WHERE namespace.nspname = current_schema()
        AND tables.relkind IN ('r', 'p')
        AND tables.relname LIKE 'aiceo\\_%' ESCAPE '\\'
    `);
    assert.equal(coverage.rows[0].guarded_count, coverage.rows[0].table_count);

    await client.query("BEGIN");
    await client.query("CREATE TABLE aiceo_credential_firewall_ddl_probe (payload jsonb NOT NULL)");
    const automaticGuard = await client.query(`
      SELECT count(*)::int AS count
      FROM pg_trigger
      WHERE tgrelid = 'aiceo_credential_firewall_ddl_probe'::regclass
        AND NOT tgisinternal
        AND tgenabled <> 'D'
        AND pg_get_triggerdef(oid) LIKE '%aiceo_credential_persistence_guard%'
    `);
    assert.equal(automaticGuard.rows[0].count, 1);
    await client.query("SAVEPOINT blocked_ddl_probe");
    await assert.rejects(
      client.query(
        "INSERT INTO aiceo_credential_firewall_ddl_probe(payload) VALUES ($1::jsonb)",
        [JSON.stringify({ api_token: "synthetic-future-table-token" })],
      ),
      /AICEO credential persistence blocked/,
    );
    await client.query("ROLLBACK TO SAVEPOINT blocked_ddl_probe");
    await client.query(
      "INSERT INTO aiceo_credential_firewall_ddl_probe(payload) VALUES ($1::jsonb)",
      [JSON.stringify({ marker: "normal-future-table-row" })],
    );
    await client.query("ROLLBACK");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
  console.log("AICEO credential persistence firewall tests passed");
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : "credential firewall test failed");
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
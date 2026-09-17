import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

const schema = `g1_memory_concurrency_${randomUUID().replaceAll("-", "")}`;
const projectId = randomUUID();
const candidateIds = [randomUUID(), randomUUID(), randomUUID()];
const quotedSchema = `"${schema}"`;
const insertEvent = async (client: Awaited<ReturnType<typeof pool.connect>>, actor: string, candidateId: string) => {
  await client.query("SELECT set_config('aiceo.memory_event_guard','1',true)");
  await client.query(
    `INSERT INTO aiceo_memory_events(
      project_id,candidate_id,event_type,actor_id,actor_authority,payload,event_hash
    ) VALUES($1,$2,'candidate_created',$3,'ordinary_agent',$4::jsonb,'db-owned')`,
    [projectId, candidateId, actor, JSON.stringify({ memoryType: "observation" })],
  );
};

async function main() {
  const clients = [await pool.connect(), await pool.connect(), await pool.connect()];
  try {
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  await pool.query(`CREATE TABLE ${quotedSchema}.aiceo_memory_events
    (LIKE public.aiceo_memory_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  await pool.query(`CREATE UNIQUE INDEX event_project_sequence_unique
    ON ${quotedSchema}.aiceo_memory_events(project_id,append_sequence)`);
  await pool.query(`CREATE TRIGGER event_chain BEFORE INSERT ON ${quotedSchema}.aiceo_memory_events
    FOR EACH ROW EXECUTE FUNCTION public.aiceo_memory_event_db_chain()`);
  for (const client of clients) await client.query(`SET search_path TO ${quotedSchema},public`);

  await clients[0].query("BEGIN");
  await clients[0].query("SELECT now()"); // establish transaction A before B
  await new Promise((resolve) => setTimeout(resolve, 30));

  await clients[1].query("BEGIN");
  await insertEvent(clients[1], "B-later-start-first-commit", candidateIds[1]);
  await clients[1].query("COMMIT");

  await insertEvent(clients[0], "A-earlier-start-later-commit", candidateIds[0]);
  await clients[0].query("COMMIT");

  await clients[2].query("BEGIN");
  await insertEvent(clients[2], "C-next-append", candidateIds[2]);
  await clients[2].query("COMMIT");

  const result = await pool.query(
    `SELECT actor_id,append_sequence,previous_hash,event_hash
     FROM ${quotedSchema}.aiceo_memory_events ORDER BY append_sequence`,
  );
  assert.deepEqual(result.rows.map((row) => Number(row.append_sequence)), [1, 2, 3]);
  assert.deepEqual(result.rows.map((row) => row.actor_id), [
    "B-later-start-first-commit", "A-earlier-start-later-commit", "C-next-append",
  ]);
  assert.equal(result.rows[0].previous_hash, null);
  assert.equal(result.rows[1].previous_hash, result.rows[0].event_hash);
  assert.equal(result.rows[2].previous_hash, result.rows[1].event_hash);
  console.log("AICEO G1-001 event concurrency: PASS (transaction-start inversion remains linear)");
  } finally {
    for (const client of clients) {
      try { await client.query("ROLLBACK"); } catch {}
      client.release();
    }
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
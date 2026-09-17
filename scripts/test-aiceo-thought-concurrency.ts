import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { thoughtEvidenceDigest } from "../artifacts/api-server/src/lib/aiceoMemory";

const schema = `g1_thought_concurrency_${randomUUID().replaceAll("-", "")}`;
const quoted = `"${schema}"`;
const projectId = randomUUID();
const graphId = randomUUID();
type Client = Awaited<ReturnType<typeof pool.connect>>;

const candidate = async (client: Client, content: string) => {
  const id = randomUUID();
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const evidence = { sourceType: "system_record", sourceId: id, observedAt, evidenceHash: "" };
  evidence.evidenceHash = thoughtEvidenceDigest(content, evidence);
  await client.query(
    `INSERT INTO aiceo_memory_candidates(
      id,project_id,content,memory_layer,memory_type,cognitive_state,truth_level,
      authority_level,source_actor_id,evidence_lineage,lifecycle
    ) VALUES($1,$2,$3,'semantic','observation','observation','unverified',
      'ordinary_agent','thought-concurrency',$4::jsonb,'candidate')`,
    [id, projectId, content, JSON.stringify([evidence])],
  );
  return id;
};
const node = async (
  client: Client, candidateId: string, kind: string,
  parentNodeId?: string,
) => {
  const result = await client.query(
    `INSERT INTO aiceo_thought_nodes(
      graph_id,project_id,memory_candidate_id,node_kind,epistemic_state,parent_node_id,
      relation_from_parent,outcome_validation,counterfactuals,append_sequence,production_authority
    ) VALUES($1,$2,$3,$4,'observed',$5,$6,'{"status":"not_applicable"}','[]',0,false)
    RETURNING id,append_sequence`,
    [graphId, projectId, candidateId, kind, parentNodeId ?? null, parentNodeId ? `causes_${kind}` : null],
  );
  return result.rows[0] as { id: string; append_sequence: string };
};

async function main() {
  const clients = [await pool.connect(), await pool.connect()];
  const before = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM public.aiceo_memory_candidates) candidates,
      (SELECT count(*)::int FROM public.aiceo_memory_events) events,
      (SELECT count(*)::int FROM public.aiceo_thought_nodes) thoughts`);
  try {
    await pool.query(`CREATE SCHEMA ${quoted}`);
    await pool.query(`CREATE TABLE ${quoted}.aiceo_memory_candidates
      (LIKE public.aiceo_memory_candidates INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`CREATE TABLE ${quoted}.aiceo_memory_events
      (LIKE public.aiceo_memory_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`CREATE TABLE ${quoted}.aiceo_thought_nodes
      (LIKE public.aiceo_thought_nodes INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`CREATE UNIQUE INDEX event_sequence_unique
      ON ${quoted}.aiceo_memory_events(project_id,append_sequence)`);
    await pool.query(`CREATE TRIGGER event_binding BEFORE INSERT ON ${quoted}.aiceo_memory_events
      FOR EACH ROW EXECUTE FUNCTION public.aiceo_memory_event_binding_guard()`);
    await pool.query(`CREATE TRIGGER event_chain BEFORE INSERT ON ${quoted}.aiceo_memory_events
      FOR EACH ROW EXECUTE FUNCTION public.aiceo_memory_event_db_chain()`);
    await pool.query(`CREATE TRIGGER candidate_event AFTER INSERT ON ${quoted}.aiceo_memory_candidates
      FOR EACH ROW EXECUTE FUNCTION public.aiceo_memory_candidate_event()`);
    await pool.query(`CREATE UNIQUE INDEX graph_sequence_unique
      ON ${quoted}.aiceo_thought_nodes(graph_id,append_sequence)`);
    await pool.query(`CREATE UNIQUE INDEX single_superseder
      ON ${quoted}.aiceo_thought_nodes(supersedes_node_id) WHERE supersedes_node_id IS NOT NULL`);
    await pool.query(`CREATE TRIGGER thought_guard BEFORE INSERT ON ${quoted}.aiceo_thought_nodes
      FOR EACH ROW EXECUTE FUNCTION public.aiceo_thought_node_guard()`);
    for (const client of clients) await client.query(`SET search_path TO ${quoted},public`);

    await clients[0].query("BEGIN");
    const root = await node(clients[0], await candidate(clients[0], "root motivation"), "motivation");
    const context = await node(clients[0], await candidate(clients[0], "shared context"), "context", root.id);
    await clients[0].query("COMMIT");
    const candidateA = await candidate(clients[0], "A earlier transaction");
    const candidateB = await candidate(clients[1], "B later transaction");

    await clients[0].query("BEGIN");
    await clients[0].query("SELECT now()");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await clients[1].query("BEGIN");
    await node(clients[1], candidateB, "observation", context.id);
    await clients[1].query("COMMIT");
    await node(clients[0], candidateA, "observation", context.id);
    await clients[0].query("COMMIT");

    const rows = await pool.query(
      `SELECT c.content,n.append_sequence FROM ${quoted}.aiceo_thought_nodes n
       JOIN ${quoted}.aiceo_memory_candidates c ON c.id=n.memory_candidate_id
       ORDER BY n.append_sequence`,
    );
    assert.deepEqual(rows.rows.map((row) => Number(row.append_sequence)), [1, 2, 3, 4]);
    assert.deepEqual(rows.rows.slice(2).map((row) => row.content), [
      "B later transaction", "A earlier transaction",
    ]);
    const isolated = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM ${quoted}.aiceo_memory_candidates) candidates,
        (SELECT count(*)::int FROM ${quoted}.aiceo_memory_events) events,
        (SELECT count(*)::int FROM ${quoted}.aiceo_thought_nodes) thoughts`);
    assert.deepEqual(isolated.rows[0], { candidates: 4, events: 4, thoughts: 4 });
    console.log("AICEO G1-001 Thought concurrency: PASS (transaction-start inversion remains monotonic)");
  } finally {
    for (const client of clients) {
      try { await client.query("ROLLBACK"); } catch {}
      client.release();
    }
    await pool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
    const after = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM public.aiceo_memory_candidates) candidates,
        (SELECT count(*)::int FROM public.aiceo_memory_events) events,
        (SELECT count(*)::int FROM public.aiceo_thought_nodes) thoughts`);
    assert.deepEqual(after.rows[0], before.rows[0]);
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
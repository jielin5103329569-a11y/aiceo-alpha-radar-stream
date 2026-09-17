import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync("lib/db/src/schema/aiceoMemory.ts", "utf8");
const migration = fs.readFileSync("lib/db/drizzle/0022_aiceo_memory_operating_system.sql", "utf8");
const corrective = fs.readFileSync("lib/db/drizzle/0026_aiceo_memory_candidate_only_foundation.sql", "utf8");
const finalMigration = fs.readFileSync("lib/db/drizzle/0027_aiceo_memory_candidate_integrity.sql", "utf8");
const sequenceMigration = fs.readFileSync("lib/db/drizzle/0028_aiceo_memory_monotonic_event_sequence.sql", "utf8");
const thoughtMigration = fs.readFileSync("lib/db/drizzle/0030_aiceo_thought_continuity_graph.sql", "utf8");
const service = fs.readFileSync("artifacts/api-server/src/lib/aiceoMemory.ts", "utf8");
assert.equal(fs.existsSync("artifacts/api-server/src/routes/aiceoMemory.ts"), false, "promotion/candidate route must remain deferred");

for (const name of ["aiceo_memory_candidates", "aiceo_promoted_memories", "aiceo_memory_events"]) assert.match(migration, new RegExp(name));
for (const token of ["governance", "observation", "fact", "interpretation", "hypothesis", "decision", "rule", "truthLevel", "evidenceLineage", "validFrom", "validUntil"]) assert.match(schema, new RegExp(token));
assert.match(migration, /BEFORE UPDATE OR DELETE ON aiceo_promoted_memories/);
assert.match(migration, /BEFORE UPDATE OR DELETE ON aiceo_memory_events/);
for (const denial of ["Ordinary agents and external sources may only create candidates", "Governance promotion requires Owner/governance path", "Evidence is stale or expired", "kill switch/circuit breaker"]) {
  assert.ok(service.includes(denial), `missing safeguard: ${denial}`);
}
assert.match(service, /db\.transaction/);
assert.match(service, /Learning Promotion is DEFERRED/);
assert.match(corrective, /reject_g1_promoted_memory_insert/);
assert.match(corrective, /aiceo_memory_candidate_event/);
assert.match(finalMigration, /pg_advisory_xact_lock/);
assert.match(finalMigration, /ORDER BY created_at DESC,id DESC/);
assert.match(finalMigration, /DROP TABLE IF EXISTS aiceo_memory_chain_heads/);
assert.match(sequenceMigration, /append_sequence/);
assert.match(sequenceMigration, /pg_advisory_xact_lock/);
assert.match(sequenceMigration, /max\(append_sequence\)/);
assert.match(sequenceMigration, /efrom>now\(\)/);
for (const token of ["motivation","context","observation","interpretation","belief","hypothesis","principle","decision","action","outcome","reflection","updated_belief","next_decision"]) {
  assert.match(thoughtMigration, new RegExp(token));
}
for (const guard of ["past thought cannot be the sole evidence","explicit counterfactuals","outcome validation","must supersede","production authority","immutable"]) {
  assert.match(thoughtMigration, new RegExp(guard));
}
console.log("AICEO G1-001 memory static safeguards: PASS");
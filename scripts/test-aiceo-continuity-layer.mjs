import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync("lib/db/src/schema/aiceoControlPlane.ts", "utf8");
const migration = fs.readFileSync("lib/db/drizzle/0016_aiceo_continuity_layer.sql", "utf8");
const service = fs.readFileSync("artifacts/api-server/src/lib/aiceoContinuityLayer.ts", "utf8");
const routes = fs.readFileSync("artifacts/api-server/src/routes/aiceoControlPlane.ts", "utf8");
const spec = fs.readFileSync("lib/api-spec/openapi.yaml", "utf8");

for (const state of ["RUNNING", "PAUSED", "FAILED", "COMPLETED", "OWNER_GATE"]) {
  assert.match(schema, new RegExp(`\"${state}\"`), `supervisor state ${state} must be machine-readable`);
  assert.match(migration, new RegExp(`'${state}'`), `database must constrain ${state}`);
}
for (const field of ["current_state", "decision_rule_registry", "entity_registry", "alias_dictionary", "evidence_pointers", "resume_node"]) {
  assert.match(migration, new RegExp(`\"${field}\"`), `persistent ${field} is required`);
}
assert.match(migration, /Memory is context, Persistent State is truth/);
assert.match(migration, /AI CEO继续/);
assert.match(migration, /AICEO继续/);
assert.match(migration, /owner-zero-trial-error/);
assert.match(migration, /能力|能就直接执行/);
assert.match(migration, /production_authority = false/);
assert.match(migration, /one_running_unique/);
assert.match(migration, /append-only/);
assert.match(service, /不能：/);
assert.match(service, /RESUME_ALIASES/);
assert.match(service, /Kill Switch、Queue 或 Circuit gate/);
assert.match(service, /productionAuthority: false/g);
assert.match(service, /SESSION_SECRET/);
assert.doesNotMatch(service, /child_process|fetch\(|Databento|trading|alerts/i);
assert.match(routes, /privileged\("aiceo_operator".*aiceoContinuityLayer\.update/s);
assert.match(routes, /anyAiceoRole.*aiceoContinuityLayer\.resume/s);
assert.match(spec, /truthSource: \{ type: string, const: persistent_state \}/);
assert.match(spec, /productionAuthority: \{ type: boolean, const: false \}/);

console.log("CONTINUITY-001 acceptance passed: durable truth, registries, aliases, resume node, supervisor states, serial and safety gates are declared.");
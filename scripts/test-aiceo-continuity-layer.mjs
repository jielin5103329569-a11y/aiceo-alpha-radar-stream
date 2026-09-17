import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync("lib/db/src/schema/aiceoControlPlane.ts", "utf8");
const migration = fs.readFileSync("lib/db/drizzle/0016_aiceo_continuity_layer.sql", "utf8");
const improvementMigration = fs.readFileSync("lib/db/drizzle/0017_aiceo_collaboration_improvement_loop.sql", "utf8");
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
assert.match(service, /VERIFIED\/CLOSED requires a complete Closure Integrity Audit/);
assert.match(service, /closure-integrity-audit/);
assert.match(service, /Closure Integrity Audit detected invalid HMAC evidence/);
assert.match(service, /productionAuthority: false/g);
assert.match(service, /SESSION_SECRET/);
assert.doesNotMatch(service, /child_process|fetch\(/i);
assert.match(service, /candidateText/);
assert.match(service, /protectedTerms\.some/);
assert.match(service, /status === "ACTIVE" && prior\?\.status === "ACTIVE"/);
assert.match(routes, /privileged\("aiceo_operator".*aiceoContinuityLayer\.update/s);
assert.match(routes, /anyAiceoRole.*aiceoContinuityLayer\.resume/s);
assert.match(spec, /truthSource: \{ type: string, const: persistent_state \}/);
assert.match(spec, /productionAuthority: \{ type: boolean, const: false \}/);
for (const step of ["CAPTURED", "ANALYZED", "CANDIDATE_DEFINED", "OWNER_GATE", "ACTIVE", "VALIDATING", "IMPROVED", "ROLLED_BACK"]) {
  assert.match(improvementMigration, new RegExp(`'${step}'`), `collaboration loop must persist ${step}`);
}
for (const field of ["source", "reason", "scope", "validation_result", "supersedes_rule_id", "rollback_of_rule_id"]) {
  assert.match(improvementMigration, new RegExp(`\"${field}\"`), `versioned rules require ${field}`);
}
assert.match(improvementMigration, /owner_protection' OR status IN \('OWNER_GATE','REJECTED'\)/);
assert.match(service, /至少需要两项证据、根因和正确行为定义/);
assert.match(service, /requiresOwnerGovernanceApproval/);
assert.match(service, /rollbackRule/);
assert.match(routes, /aiceo_validator.*validateRule/s);

console.log("CONTINUITY-001 acceptance passed: durable truth, registries, aliases, resume node, supervisor states, serial and safety gates are declared.");
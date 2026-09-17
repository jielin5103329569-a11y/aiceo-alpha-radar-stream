import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, aiceoContinuityProjectsTable, aiceoContinuityStateTable } from "@workspace/db";
import { AiceoContinuityLayer, MEMORY_FOUNDATION_RULE } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update"))[0];
    const state = project && (await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
    assert.ok(project && state);
    assert.equal(state.revision, 30);
    assert.equal(state.currentState.verification, "VERIFIED");
    assert.equal(state.currentState.closure, "CLOSED");
    assert.equal(project.productionAuthority, false);
    const rules = state.decisionRuleRegistry.map((rule: any) =>
      rule.id === MEMORY_FOUNDATION_RULE.id ? MEMORY_FOUNDATION_RULE : rule);
    const entities = state.entityRegistry.map((entity: any) => {
      if (entity.id === "continuity-001") return { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      if (entity.id === "memory-g1-001") return { ...entity, status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      return entity;
    });
    return new AiceoContinuityLayer(tx, true).update({
      state: "COMPLETED",
      currentState: { ...state.currentState, activeTask: "G1-001 — Thought Continuity Graph core contract", verification: "NOT_VERIFIED", closure: "BLOCKED", closureIntegrityAudit: "NOT_VERIFIED" },
      decisionRuleRegistry: rules, entityRegistry: entities, aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, {
        id: "g1-001-thought-continuity-core-requirement", type: "owner_requirement",
        scope: "thought_continuity_graph_core_contract", result: "ACCEPTED_FOR_G1_001",
        noSelfReinforcement: true, realityMayCorrectThought: true,
        grantsAuthority: false, productionAuthority: false,
      }],
      resumeNode: { node: "g1-001-thought-continuity-validation", action: "Validate and closure-audit Thought Continuity as part of G1-001; do not start G1-002.", status: "BLOCKED", ownerGate: false },
      failureReason: "G1-001 was reopened by Owner requirement to include Thought Continuity Graph before final closure.",
      recoveryStrategy: "Verify the database-enforced causal graph, negative gates, persistence, and all legacy regressions, then run a new signed Closure Integrity Audit.",
      ownerGateReason: null,
    }, "aiceo:g1-001-thought-continuity-reopen");
  });
  assert.equal(result.revision, 31);
  console.log(JSON.stringify({ revision: 31, verification: "NOT_VERIFIED", closure: "BLOCKED", productionAuthority: false }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
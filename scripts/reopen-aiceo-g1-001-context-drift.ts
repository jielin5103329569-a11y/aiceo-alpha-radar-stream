import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { aiceoContinuityProjectsTable, aiceoContinuityStateTable, db } from "@workspace/db";
import {
  AiceoContinuityLayer, CONTEXT_AUTHORITY_CONTINUITY_RULE,
} from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const result = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update");
    const [state] = project ? await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update") : [];
    assert.ok(project && state);
    assert.equal(state.revision, 39);
    assert.equal(state.currentState.verification, "VERIFIED");
    assert.equal(state.currentState.closure, "CLOSED");
    assert.equal(project.productionAuthority, false);
    const rules = state.decisionRuleRegistry
      .filter((rule: any) => rule.id !== CONTEXT_AUTHORITY_CONTINUITY_RULE.id)
      .concat([CONTEXT_AUTHORITY_CONTINUITY_RULE]);
    const entities = state.entityRegistry.map((entity: any) => {
      if (entity.id === "continuity-001") {
        return { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      }
      if (entity.id === "memory-g1-001") {
        return { ...entity, status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      }
      return entity;
    });
    return new AiceoContinuityLayer(tx, true).update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        activeTask: "G1-001 — Context Authority, Drift Detection, and cross-ingress recovery",
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        closureIntegrityAudit: "NOT_VERIFIED",
      },
      decisionRuleRegistry: rules,
      entityRegistry: entities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, {
        id: "g1-001-context-drift-owner-requirement",
        type: "owner_requirement",
        source: "real_work_notion_context_drift_case",
        staleClaim: "AICEO is entering Architecture Phase / next Grok Agent Integration Contract",
        requiredTruthSource: "persistent_state",
        strictSerial: true,
        grantsAuthority: false,
        productionAuthority: false,
      }],
      resumeNode: {
        node: "g1-001-context-drift-continuity-validation",
        action: "Implement and independently validate external-context candidate-only recovery and Context Drift rejection; do not start G1-002.",
        status: "BLOCKED",
        ownerGate: false,
      },
      failureReason: "G1-001 reopened because a real Work/Notion context drift case exposed an unverified Continuity recovery gap.",
      recoveryStrategy: "Persist append-only drift evidence, make Persistent State authoritative across ingress, test stale phase rejection and low-context aliases, then run independent acceptance and signed Closure.",
      ownerGateReason: null,
    }, "aiceo:g1-001-context-drift-reopen");
  });
  assert.equal(result.revision, 40);
  console.log(JSON.stringify({
    revision: result.revision, verification: "NOT_VERIFIED", closure: "BLOCKED",
    resumeNode: "g1-001-context-drift-continuity-validation",
    strictSerial: true, productionAuthority: false,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
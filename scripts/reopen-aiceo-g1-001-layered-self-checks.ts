import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, aiceoContinuityProjectsTable, aiceoContinuityStateTable } from "@workspace/db";
import { AiceoContinuityLayer, LAYERED_SELF_CHECK_RULE } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update"))[0];
    const state = project && (await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
    assert.ok(project && state);
    assert.equal(state.revision, 33);
    assert.equal(state.currentState.verification, "VERIFIED");
    assert.equal(state.currentState.closure, "CLOSED");
    assert.equal(project.productionAuthority, false);
    const rules = state.decisionRuleRegistry
      .filter((rule: any) => rule.id !== LAYERED_SELF_CHECK_RULE.id)
      .concat([LAYERED_SELF_CHECK_RULE]);
    const entities = state.entityRegistry.map((entity: any) => {
      if (entity.id === "continuity-001") return { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      if (entity.id === "memory-g1-001") return { ...entity, status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      return entity;
    });
    return new AiceoContinuityLayer(tx, true).update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        activeTask: "G1-001 — layered local, chain, and global self-check contract",
        verification: "NOT_VERIFIED", closure: "BLOCKED", closureIntegrityAudit: "NOT_VERIFIED",
      },
      decisionRuleRegistry: rules, entityRegistry: entities, aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, {
        id: "g1-001-layered-self-check-core-requirement", type: "owner_requirement",
        scope: "local_chain_global_progressive_diagnostics",
        strictSerial: true, selfCheckIsIndependentValidation: false,
        grantsAuthority: false, productionAuthority: false,
      }],
      resumeNode: {
        node: "g1-001-layered-self-check-validation",
        action: "Validate layered self-check contracts inside G1-001; do not start G1-002 or instrument later modules.",
        status: "BLOCKED", ownerGate: false,
      },
      failureReason: "G1-001 was reopened by Owner requirement to include layered local, chain, and global self-check architecture.",
      recoveryStrategy: "Verify progressive escalation, freshness, aggregation, observability, fault localization, non-authority and independent-validation separation; then run a new signed Closure Integrity Audit.",
      ownerGateReason: null,
    }, "aiceo:g1-001-layered-self-check-reopen");
  });
  assert.equal(result.revision, 34);
  console.log(JSON.stringify({ revision: 34, verification: "NOT_VERIFIED", closure: "BLOCKED", strictSerial: true, productionAuthority: false }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
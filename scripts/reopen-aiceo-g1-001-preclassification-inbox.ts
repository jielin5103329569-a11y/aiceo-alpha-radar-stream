import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { aiceoContinuityProjectsTable, aiceoContinuityStateTable, db } from "@workspace/db";
import { AiceoContinuityLayer, PRECLASSIFICATION_MEMORY_INBOX_RULE } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";
async function main() {
  const result = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update");
    const [state] = project ? await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update") : [];
    assert.ok(project && state);
    assert.equal(state.revision, 36); assert.equal(state.currentState.verification, "VERIFIED");
    assert.equal(state.currentState.closure, "CLOSED"); assert.equal(project.productionAuthority, false);
    const rules = state.decisionRuleRegistry
      .filter((rule: any) => rule.id !== PRECLASSIFICATION_MEMORY_INBOX_RULE.id)
      .concat([PRECLASSIFICATION_MEMORY_INBOX_RULE]);
    const entities = state.entityRegistry.map((entity: any) => {
      if (entity.id === "continuity-001") return { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      if (entity.id === "memory-g1-001") return { ...entity, status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      return entity;
    });
    return new AiceoContinuityLayer(tx, true).update({
      state: "COMPLETED",
      currentState: { ...state.currentState, activeTask: "G1-001 — controlled pre-classification memory inbox", verification: "NOT_VERIFIED", closure: "BLOCKED", closureIntegrityAudit: "NOT_VERIFIED" },
      decisionRuleRegistry: rules, entityRegistry: entities, aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, {
        id: "g1-001-preclassification-inbox-owner-requirement", type: "owner_requirement",
        scope: "preserve_eight_high_value_themes_without_premature_classification",
        futureMigrationMustPreserveOriginProvenance: true,
        strictSerial: true, grantsAuthority: false, productionAuthority: false,
      }],
      resumeNode: {
        node: "g1-001-preclassification-inbox-seed-and-validation",
        action: "Persist and validate the eight high-value raw themes; do not classify, promote, retrieve, or start G1-002.",
        status: "BLOCKED", ownerGate: false,
      },
      failureReason: "G1-001 reopened to add the Owner-directed controlled pre-classification memory inbox.",
      recoveryStrategy: "Seed exactly eight immutable high-value records, verify provenance/hash/idempotency/non-authority and future migration requirements, then run independent acceptance and signed Closure.",
      ownerGateReason: null,
    }, "aiceo:g1-001-preclassification-inbox-reopen");
  });
  assert.equal(result.revision, 37);
  console.log(JSON.stringify({ revision: 37, verification: "NOT_VERIFIED", closure: "BLOCKED", strictSerial: true, productionAuthority: false }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
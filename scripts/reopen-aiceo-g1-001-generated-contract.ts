import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { aiceoContinuityProjectsTable, aiceoContinuityStateTable, db } from "@workspace/db";
import { AiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const result = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update");
    const [state] = project ? await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update") : [];
    assert.ok(project && state);
    assert.equal(state.revision, 42);
    assert.equal(state.currentState.verification, "VERIFIED");
    assert.equal(state.currentState.closure, "CLOSED");
    const entities = state.entityRegistry.map((entity: any) =>
      entity.id === "continuity-001" || entity.id === "memory-g1-001"
        ? { ...entity, status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" }
        : entity);
    return new AiceoContinuityLayer(tx, true).update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        activeTask: "G1-001 — Context Authority generated API contract reconciliation",
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        closureIntegrityAudit: "NOT_VERIFIED",
      },
      decisionRuleRegistry: state.decisionRuleRegistry,
      entityRegistry: entities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, {
        id: "g1-001-context-authority-codegen-reopen",
        type: "derived_contract_validation_failure",
        cause: "OpenAPI codegen produced a Zod 3 incompatible integer validator after Closure",
        strictSerial: true,
        grantsAuthority: false,
        productionAuthority: false,
      }],
      resumeNode: {
        node: "g1-001-context-authority-generated-contract-validation",
        action: "Repair and regenerate the Context Authority API contract, independently re-accept, and rerun signed Closure; do not start G1-002.",
        status: "BLOCKED",
        ownerGate: false,
      },
      failureReason: "G1-001 reopened because post-Closure OpenAPI codegen exposed an unverified generated-client compatibility gap.",
      recoveryStrategy: "Fix the OpenAPI integer schema for the current Orval/Zod toolchain, regenerate clients, typecheck all libraries, then rerun independent acceptance and signed Closure.",
      ownerGateReason: null,
    }, "aiceo:g1-001-context-authority-codegen-reopen");
  });
  assert.equal(result.revision, 43);
  console.log(JSON.stringify({
    revision: result.revision, verification: "NOT_VERIFIED", closure: "BLOCKED",
    resumeNode: "g1-001-context-authority-generated-contract-validation",
    productionAuthority: false,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
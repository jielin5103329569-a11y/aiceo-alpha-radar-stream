import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { aiceoContinuityProjectsTable, aiceoContinuityStateTable } from "@workspace/db/schema";
import { AiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update"))[0];
    const state = project && (await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
    assert.ok(project && state, "Fail-Closed: AICEO Persistent State is missing");
    assert.equal(state.revision, 27, "Fail-Closed: G1-001 start revision drift");
    assert.equal(state.currentState.verification, "VERIFIED");
    assert.equal(state.currentState.closure, "CLOSED");
    assert.equal(project.productionAuthority, false);

    const entities = state.entityRegistry
      .filter((entity: any) => entity.id !== "memory-g1-001")
      .map((entity: any) => entity.id === "continuity-001"
        ? { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" }
        : entity)
      .concat([{
        id: "memory-g1-001",
        type: "memory_operating_system_foundation",
        status: "NOT_VERIFIED",
        closure: "BLOCKED",
        version: "G1-001",
        productionAuthority: false,
      }]);
    const layer = new AiceoContinuityLayer(tx, true);
    return layer.update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        activeTask: "G1-001 — AICEO Memory Operating System minimum foundation",
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        closureIntegrityAudit: "NOT_VERIFIED",
      },
      decisionRuleRegistry: state.decisionRuleRegistry,
      entityRegistry: entities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [
        ...state.evidencePointers,
        {
          id: "g1-001-start",
          type: "memory_foundation_start",
          scope: "minimum_machine_executable_memory_contract",
          excludes: [
            "retrieval_router", "context_compiler", "agent_memory_distribution",
            "learning_promotion", "temporal_replay",
          ],
          noNewAgents: true,
          grantsAuthority: false,
          productionAuthority: false,
        },
      ],
      resumeNode: {
        node: "g1-001-memory-foundation-implementation",
        action: "Implement and independently verify only the G1-001 minimum memory contract.",
        status: "BLOCKED",
        ownerGate: false,
      },
      failureReason: "G1-001 Memory Operating System foundation is not yet implemented, independently verified, or closure-audited.",
      recoveryStrategy: "Implement the isolated memory contract, candidate-write gates, lifecycle and negative tests; then run the full signed Closure Integrity Audit.",
      ownerGateReason: null,
    }, "aiceo:g1-001-starter");
  });
  assert.equal(result.revision, 28);
  console.log(JSON.stringify({
    revision: result.revision,
    verification: "NOT_VERIFIED",
    closure: "BLOCKED",
    resumeNode: "g1-001-memory-foundation-implementation",
    productionAuthority: false,
    eventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
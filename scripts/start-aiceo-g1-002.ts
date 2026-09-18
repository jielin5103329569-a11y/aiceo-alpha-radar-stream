import assert from "node:assert/strict";
import { count, eq, inArray } from "drizzle-orm";
import {
  aiceoContinuityProjectsTable, aiceoContinuityStateTable, aiceoControlStateTable,
  aiceoPolicyRegistryTable, aiceoTasksTable, db,
} from "@workspace/db";
import {
  AiceoContinuityLayer, MEMORY_RETRIEVAL_ROUTER_RULE,
} from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const result = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update");
    const [state] = project ? await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update") : [];
    const [control] = await tx.select().from(aiceoControlStateTable).limit(1).for("update");
    assert.ok(project && state && control, "Fail-Closed: AICEO control graph is incomplete");
    assert.equal(state.revision, 45, "Fail-Closed: G1-002 start revision drift");
    assert.equal(state.currentState.verification, "VERIFIED");
    assert.equal(state.currentState.closure, "CLOSED");
    assert.equal(state.resumeNode.node, "g1-002-memory-retrieval-router");
    assert.equal(state.resumeNode.status, "CLOSED");
    assert.equal(project.environment, "development");
    assert.equal(project.authority, "grok_restricted_development");
    assert.equal(project.productionAuthority, false);
    assert.equal(control.queueActive, true);
    assert.equal(control.killSwitch, false);
    assert.equal(control.circuitState, "CLOSED");
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoPolicyRegistryTable)
      .where(eq(aiceoPolicyRegistryTable.frozen, true)))[0].value), 13);
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoTasksTable)
      .where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"])))[0].value), 0);

    const rules = state.decisionRuleRegistry
      .filter((rule: any) => rule.id !== MEMORY_RETRIEVAL_ROUTER_RULE.id)
      .concat([MEMORY_RETRIEVAL_ROUTER_RULE]);
    const entities = state.entityRegistry
      .filter((entity: any) => entity.id !== "memory-g1-002-retrieval-router")
      .map((entity: any) => entity.id === "continuity-001"
        ? { id: "continuity-001", type: "implementation", status: "RUNNING", verification: "NOT_VERIFIED", closure: "BLOCKED" }
        : entity)
      .concat([{
        id: "memory-g1-002-retrieval-router",
        type: "memory_retrieval_router",
        version: "G1-002-RTR-1",
        status: "RUNNING",
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        productionAuthority: false,
      }]);
    return new AiceoContinuityLayer(tx, true).update({
      state: "RUNNING",
      currentState: {
        ...state.currentState,
        activeTask: "G1-002 — AICEO Memory Retrieval Router",
        implementation: "RUNNING",
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        closureIntegrityAudit: "NOT_VERIFIED",
      },
      decisionRuleRegistry: rules,
      entityRegistry: entities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, {
        id: "g1-002-retrieval-router-start",
        type: "retrieval_router_start",
        originRevision: 45,
        originResumeNode: "g1-002-memory-retrieval-router",
        scope: "minimum_explainable_read_only_candidate_retrieval",
        excludedModules: [
          "context_compiler", "agent_memory_distribution", "learning_promotion",
          "temporal_replay", "trading", "databento", "alerts", "production",
        ],
        strictSerial: true,
        grantsAuthority: false,
        productionAuthority: false,
      }],
      resumeNode: {
        node: "g1-002-retrieval-router-implementation",
        action: "Implement and negatively test only the minimum G1-002 Retrieval Router; do not start Context Compiler or later modules.",
        status: "BLOCKED",
        ownerGate: false,
      },
      failureReason: "G1-002 Retrieval Router is implementing and is not independently verified or closure-audited.",
      recoveryStrategy: "Complete the bounded read-only router, negative and governance regressions, independent acceptance, then signed Closure Integrity Audit.",
      ownerGateReason: null,
    }, "aiceo:g1-002-retrieval-router-starter");
  });
  assert.equal(result.revision, 46);
  console.log(JSON.stringify({
    revision: result.revision, state: "RUNNING", verification: "NOT_VERIFIED",
    closure: "BLOCKED", resumeNode: "g1-002-retrieval-router-implementation",
    productionAuthority: false, eventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
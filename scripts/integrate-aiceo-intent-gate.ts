import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
} from "@workspace/db/schema";
import {
  AiceoContinuityLayer,
  BRAIN_AGENT_EXECUTION_RULE,
  CLOSURE_INTEGRITY_RULE,
  INTENT_UNCERTAINTY_CONFIRMATION_RULE,
} from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update"))[0];
    const state = project && (await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
    assert.ok(project && state, "Fail-Closed: persistent continuity state is missing");
    assert.equal(state.revision, 25, "Fail-Closed: intent-gate integration revision drift");
    assert.equal(state.currentState.verification, "NOT_VERIFIED");
    assert.equal(state.currentState.closure, "BLOCKED");
    assert.equal(project.productionAuthority, false);

    const rules = state.decisionRuleRegistry
      .filter((rule: any) => ![
        "brain-agent-execution-protocol",
        "closure-integrity-audit",
        "intent-uncertainty-confirmation-gate",
      ].includes(rule.id))
      .concat([
        BRAIN_AGENT_EXECUTION_RULE,
        INTENT_UNCERTAINTY_CONFIRMATION_RULE,
        CLOSURE_INTEGRITY_RULE,
      ]);
    const entities = state.entityRegistry
      .filter((entity: any) => entity.id !== "intent-gate-001")
      .concat([{
        id: "intent-gate-001",
        type: "communication_understanding_gate",
        status: "ACTIVE",
        version: "INTENT-GATE-001",
        productionAuthority: false,
      }]);
    const evidencePointers = [
      ...state.evidencePointers,
      {
        id: "intent-uncertainty-confirmation-gate-implementation",
        type: "communication_understanding_gate_implementation",
        ruleVersion: 1,
        contractVersion: "BRAIN-AGENT-002",
        migration: "lib/db/drizzle/0019_aiceo_intent_uncertainty_confirmation_gate.sql",
        protocol: "artifacts/api-server/src/lib/aiceoAgentExecutionProtocol.ts",
        checks: {
          exactIntentContextRevisionBinding: true,
          shortestNaturalOwnerConfirmation: true,
          agentEscalatesBrainFirst: true,
          confirmationNotAuthorization: true,
          ownerProtectionTriadUnchanged: true,
          singleCaseInferenceForbidden: true,
        },
        grantsAuthority: false,
        productionAuthority: false,
      },
    ];
    const layer = new AiceoContinuityLayer(tx, true);
    return layer.update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        closureIntegrityAudit: "NOT_VERIFIED",
      },
      decisionRuleRegistry: rules,
      entityRegistry: entities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers,
      resumeNode: {
        node: "intent-uncertainty-confirmation-gate-acceptance",
        action: "Run the full signed Closure Integrity Audit for INTENT-GATE-001 and BRAIN-AGENT-002.",
        status: "BLOCKED",
        ownerGate: false,
        closureIntegrityAudit: "NOT_VERIFIED",
      },
      failureReason: "Intent Uncertainty Confirmation Gate is implemented and persisted; VERIFIED/CLOSED remains blocked pending full signed re-acceptance.",
      recoveryStrategy: "Run all protocol, collaboration, governance, continuity and Closure Integrity regressions, verify the confirmation evidence hash, then sign the complete closure intent.",
      ownerGateReason: null,
    }, "aiceo:intent-gate-integrator");
  });
  assert.equal(result.revision, 26);
  assert.equal(result.productionAuthority, false);
  console.log(JSON.stringify({
    revision: result.revision,
    state: result.state,
    verification: "NOT_VERIFIED",
    closure: "BLOCKED",
    intentGate: "INTENT-GATE-001",
    contractVersion: "BRAIN-AGENT-002",
    productionAuthority: false,
    eventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
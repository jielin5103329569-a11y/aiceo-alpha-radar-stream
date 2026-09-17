import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { aiceoContinuityProjectsTable, aiceoContinuityStateTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { AiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update"))[0];
    const state = project && (await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
    assert.ok(project && state, "Fail-Closed: continuity state missing");
    assert.equal(state.revision, 24, "Fail-Closed: remediation revision drift");
    assert.equal(state.currentState.closureIntegrityAudit, "VERIFIED", "Fail-Closed: target audit state changed");

    const layer = new AiceoContinuityLayer(tx, true);
    const blockedEntities = state.entityRegistry.map((entity: any) =>
      entity.id === "continuity-001"
        ? { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" }
        : entity);
    return layer.update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        closureIntegrityAudit: "REJECTED",
      },
      decisionRuleRegistry: state.decisionRuleRegistry,
      entityRegistry: blockedEntities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [
        ...state.evidencePointers,
        {
          id: "intent-uncertainty-confirmation-gate-remediation-r24",
          type: "closure_integrity_blocker",
          auditedRevision: 24,
          result: "NOT_VERIFIED",
          blocker: "Intent Uncertainty Confirmation Gate is not yet a protected persistent rule, Brain-to-Agent contract gate, or Closure Integrity Audit dependency.",
          requiredRepair: "Persist and enforce the intent gate, bind Owner confirmation to exact intent/context/revision, preserve Approval and Governance gates, add negative tests, then re-run closure acceptance.",
          productionAuthority: false,
        },
      ],
      resumeNode: {
        node: "closure-integrity-remediation",
        status: "BLOCKED",
        action: "Repair the Closure Integrity Audit trust boundary and repeat full acceptance.",
        ownerGate: false,
      },
      failureReason: "Intent Uncertainty Confirmation Gate is not yet integrated into persistent governance, Brain-to-Agent contracts, and Closure Integrity Audit; VERIFIED/CLOSED is blocked pending implementation.",
      recoveryStrategy: "Implement and persist the intent gate without authority expansion, run negative and integration tests, then repeat the full signed closure audit.",
      ownerGateReason: null,
    }, "aiceo:closure-integrity-auditor");
  });
  assert.equal(result.revision, 25);
  console.log(JSON.stringify({
    revision: result.revision,
    verification: "NOT_VERIFIED",
    closure: "BLOCKED",
    resumeNode: "closure-integrity-remediation",
    productionAuthority: false,
    evidenceEventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
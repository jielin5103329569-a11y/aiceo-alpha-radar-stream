import assert from "node:assert/strict";
import { count, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoCapabilityPerformanceLedgerTable,
  aiceoCapabilityRoutingDecisionsTable,
  aiceoContinuityStateTable,
  aiceoExecutionGovernanceLifecycleTable,
  aiceoFirstResolutionObligationsTable,
} from "@workspace/db/schema";
import { AiceoAgentExecutionProtocol } from "../artifacts/api-server/src/lib/aiceoAgentExecutionProtocol";
import { AiceoExecutionGovernanceV1 } from "../artifacts/api-server/src/lib/aiceoExecutionGovernanceV1";
import {
  AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
  AICEO_ROLE_GOVERNANCE_RULE_ID,
} from "../artifacts/api-server/src/lib/aiceoGovernanceRoot";

const ROLLBACK = Symbol("rollback");

async function main() {
  try {
    await db.transaction(async (tx) => {
      const protocol = new AiceoAgentExecutionProtocol(tx, true);
      const revision = (await tx.select().from(aiceoContinuityStateTable).limit(1))[0].revision;
      const understanding = {
        certainty: "HIGH",
        interpretedIntent: "Resume",
        actionTarget: "resume",
        confirmationSummary: "Resume the safe development check.",
        reasonableInterpretations: [{ meaning: "Resume the safe development check.", actionTarget: "resume" }],
        materiallyDifferentActions: false,
        contextHighlyClear: true,
        stableAlias: true,
        verifiedExpressionPattern: false,
        riskLevel: "LOW",
      };
      const input = {
        idempotencyKey: "eg001-test-contract",
        ownerIntent: "Bro，继续",
        intentUnderstanding: understanding,
        continuityRevision: revision,
        scope: { allowedOperations: ["code.inspect"] },
        objective: "Record EG-001 evidence",
        allowedCapabilities: ["code.inspect"],
        deniedCapabilities: [],
        frozenRules: [],
        completionDefinition: { result: true },
        evidenceRequirements: [{ type: "fact" }],
        executionPolicy: { timeoutMs: 10_000, maxRetries: 1, maxCalls: 2, maxCostMicrousd: 10_000, checkpointRequired: true },
        resumeNode: { node: "eg001-test" },
        escalationConditions: [],
        ownerAttentionBudget: { maxOwnerInterruptions: 1, mergeHumanActions: true, noScreenshotWhenAutoVerifiable: true },
        maxDelegationDepth: 1,
      };
      await assert.rejects(
        () => protocol.issue(input, "eg001-operator", "aiceo_operator" as any),
        /Owner-side governance validator lane/,
      );
      const contract = await protocol.issue(input, "eg001-validator", "aiceo_validator");
      assert.equal(contract.brainActorId, AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID);
      assert.equal(
        contract.frozenRules.some((rule: any) => rule.id === AICEO_ROLE_GOVERNANCE_RULE_ID),
        true,
      );
      await assert.rejects(
        () => protocol.start(contract.id, {
          idempotencyKey: "eg001-missing-fro", agentType: "coding", agentActorId: AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
          parentRunId: null, delegationDepth: 0, inheritedAuthority: "delegated_technical_authority",
          contextHash: contract.contextHash,
        }),
        /rootCauseDiagnosis and minimalEffectiveAction/,
      );
      const run = await protocol.start(contract.id, {
        idempotencyKey: "eg001-test-run",
        agentType: "coding",
        agentActorId: AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
        parentRunId: null,
        delegationDepth: 0,
        inheritedAuthority: "delegated_technical_authority",
        contextHash: contract.contextHash,
        routingCapability: "code.inspect",
        routingCandidates: [
          { adapter: "evidence-adapter", version: "v1" },
          { adapter: "fallback-adapter", version: "v1" },
        ],
        rootCauseDiagnosis: "Inspect the requested development evidence.",
        minimalEffectiveAction: "Run the smallest read-only check.",
      });
      const routing = (await tx.select().from(aiceoCapabilityRoutingDecisionsTable)
        .where(eq(aiceoCapabilityRoutingDecisionsTable.runId, run.id)))[0];
      assert.equal(routing.selectedAdapter, "evidence-adapter");
      assert.equal((routing.rejectedCandidates[0] as any).selectionBasis, "performance-evidence");
      assert.match(routing.policyHash, /^[a-f0-9]{64}$/);
      assert.equal((routing.selectionMetrics as any).deterministicBasis, "capability-performance-only");
      assert.equal((routing.selectionMetrics as any).noHistory, true);
      await assert.rejects(
        () => new AiceoExecutionGovernanceV1(tx).route({
          contractId: contract.id, runId: run.id, capability: "code.inspect",
          candidates: [{ adapter: "evidence-adapter", version: "v1" }],
          policyHash: "a".repeat(64), idempotencyKey: "route-invalid-policy",
        }),
        /policyHash is not bound/,
      );
      const obligation = (await tx.select().from(aiceoFirstResolutionObligationsTable)
        .where(eq(aiceoFirstResolutionObligationsTable.runId, run.id)))[0];
      assert.equal(obligation.rootCauseDiagnosis.length > 0, true);
      assert.equal(obligation.minimalEffectiveAction.length > 0, true);
      assert.equal(Number((await tx.select({ n: count() }).from(aiceoCapabilityPerformanceLedgerTable)
        .where(eq(aiceoCapabilityPerformanceLedgerTable.runId, run.id)))[0].n), 1);
      await assert.rejects(
        () => protocol.close(run.id, "eg001-validator", "aiceo_validator", "Premature close must remain blocked"),
        /requires the persisted independent Owner-side verification/,
      );
      await assert.rejects(
        () => new AiceoExecutionGovernanceV1(tx).transition({
          contractId: contract.id, runId: run.id, contextHash: contract.contextHash,
          state: "CLOSED", eventKey: "illegal-close", reason: "Skip verification", actorId: "eg001-validator",
        }),
        /illegal lifecycle transition|idempotency conflict/,
      );
      await protocol.submit(run.id, {
        understandingStatus: "CLEAR",
        observedScope: ["code.inspect"],
        result: { ok: true },
        evidence: [{ fact: "read-only evidence" }],
        usedCalls: 1,
        usedCostMicrousd: 200,
      });
      assert.equal((await tx.select().from(aiceoExecutionGovernanceLifecycleTable)
        .where(eq(aiceoExecutionGovernanceLifecycleTable.runId, run.id))).some((row) => row.state === "ACCEPTED"), true);
      await assert.rejects(
        () => new AiceoExecutionGovernanceV1(tx).accept({
          contractId: contract.id, runId: run.id, contextHash: contract.contextHash,
          actorId: "eg001-validator", evidence: [{ altered: true }],
        }),
        /idempotency conflict/,
      );
      await assert.rejects(
        () => protocol.verify(run.id, {
          passed: true,
          compliance: {
            authority: true, scope: true, understanding: true, intentGate: true,
            noDuplicate: true, noOwnerInterruption: true, evidence: true,
          },
          evidence: [{ validator: "wrong-role" }],
        }, "eg001-operator", "aiceo_operator" as any),
        /independent verification required/,
      );
      const verified = await protocol.verify(run.id, {
        passed: true,
        compliance: {
          authority: true, scope: true, understanding: true, intentGate: true,
          noDuplicate: true, noOwnerInterruption: true, evidence: true,
        },
        evidence: [{ validator: "independent" }],
      }, "eg001-validator", "aiceo_validator");
      assert.equal(verified.finalStatus, "VERIFIED");
      await assert.rejects(
        () => protocol.close(
          run.id,
          "eg001-validator",
          "aiceo_operator" as any,
          "Wrong role cannot close",
        ),
        /requires the persisted independent Owner-side verification/,
      );
      await protocol.close(run.id, "eg001-validator", "aiceo_validator", "Verified objective is complete", [{ closed: true }]);
      await protocol.rollback(run.id, "eg001-operator", "Backtrace required", [{ rollback: true }]);
      await protocol.reopen(run.id, "eg001-operator", "Root cause corrected", [{ reopened: true }]);
      const reopened = await tx.select().from(aiceoExecutionGovernanceLifecycleTable)
        .where(eq(aiceoExecutionGovernanceLifecycleTable.runId, run.id));
      assert.deepEqual(reopened.map((row) => row.state), ["ACCEPTED", "VERIFIED", "CLOSED", "ROLLED_BACK", "REOPENED"]);
      assert.equal(reopened[0].previousHash, null);
      assert.equal(reopened.slice(1).every((row, index) => row.previousHash === reopened[index].payloadHash), true);
      await assert.rejects(
        () => new AiceoExecutionGovernanceV1(tx).accept({
          contractId: contract.id, runId: run.id, contextHash: contract.contextHash,
          actorId: "eg001-validator", evidence: [{ invalidSameRunReuse: true }],
        }),
        /illegal lifecycle transition|idempotency conflict/,
      );
      await assert.rejects(
        () => tx.execute(sql`UPDATE aiceo_execution_governance_lifecycle SET reason = 'tampered' WHERE id = ${reopened[0].id}`),
        /Failed query/,
      );
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  console.log(JSON.stringify({
    routingBoundAndEvidenceRanked: true,
    rejectedCandidateReasonRecorded: true,
    immutablePerformanceEvents: true,
    firstResolutionBlocksPrematureClosure: true,
    independentVerificationRequired: true,
    lifecycleBacktraceComplete: true,
    productionAuthority: false,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
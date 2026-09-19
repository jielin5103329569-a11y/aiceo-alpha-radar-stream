import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoAgentRunsTable,
  aiceoContinuityStateTable,
  aiceoExecutionContractsTable,
  aiceoExecutionGovernanceLifecycleTable,
} from "@workspace/db/schema";
import { AiceoAgentExecutionProtocol } from "../artifacts/api-server/src/lib/aiceoAgentExecutionProtocol";
import {
  AICEO_OWNER_SIDE_GOVERNANCE_ACTOR_ID,
  AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
} from "../artifacts/api-server/src/lib/aiceoGovernanceRoot";
import {
  GOV_TASK_73_CONTRACT_KEY,
  GOV_TASK_73_SCOPE_KEY,
} from "../artifacts/api-server/src/routes/aiceoGov";

const evidence = [
  {
    source: "live-route-check",
    finding: "/gov, /gov/login, /gov/sso-callback, and /gov/tasks/73 are mounted on the existing API owner.",
  },
  {
    source: "clerk-role-binding",
    finding: "The durable mailbox Clerk user is bound to exclusive aiceo_owner; aiceo_operator remains non-authorizing.",
  },
  {
    source: "task-73-surface",
    finding: "Task 73 exposes persisted contract, execution, evidence, verification, and closure fields with an explicit Owner action.",
  },
];

async function main() {
  const output = await db.transaction(async (tx) => {
    const existingContract = (await tx.select().from(aiceoExecutionContractsTable)
      .where(eq(aiceoExecutionContractsTable.idempotencyKey, GOV_TASK_73_CONTRACT_KEY))
      .limit(1))[0];
    if (existingContract) {
      const existingRun = (await tx.select().from(aiceoAgentRunsTable)
        .where(eq(aiceoAgentRunsTable.contractId, existingContract.id))
        .limit(1))[0] ?? null;
      return {
        reused: true,
        contract: existingContract,
        run: existingRun,
        lifecycle: existingRun
          ? await tx.select().from(aiceoExecutionGovernanceLifecycleTable)
            .where(eq(aiceoExecutionGovernanceLifecycleTable.runId, existingRun.id))
          : [],
      };
    }

    const continuity = (await tx.select().from(aiceoContinuityStateTable).limit(1))[0];
    if (!continuity || continuity.revision !== 49) {
      throw new Error("Task 73 issuance requires current continuity revision 49.");
    }

    const protocol = new AiceoAgentExecutionProtocol(tx, true);
    const contract = await protocol.issue({
      idempotencyKey: GOV_TASK_73_CONTRACT_KEY,
      ownerIntent: "Bro，继续",
      intentUnderstanding: {
        certainty: "HIGH",
        interpretedIntent: "Resume",
        actionTarget: "resume",
        confirmationSummary: "Resume the already-authorized MGS-001 evidence recording.",
        reasonableInterpretations: [{
          meaning: "Resume the already-authorized MGS-001 evidence recording.",
          actionTarget: "resume",
        }],
        materiallyDifferentActions: false,
        contextHighlyClear: true,
        stableAlias: true,
        verifiedExpressionPattern: false,
        riskLevel: "LOW",
      },
      continuityRevision: 49,
      scope: {
        [GOV_TASK_73_SCOPE_KEY]: "73",
        workstream: "MGS-001",
        allowedOperations: ["code.inspect"],
      },
      objective: "Persist factual evidence for the isolated Clerk-authenticated Task 73 governance surface.",
      allowedCapabilities: ["code.inspect"],
      deniedCapabilities: [],
      frozenRules: [{
        id: "mgs-001-task-73-binding",
        taskId: "73",
        revision: 49,
        productionAuthority: false,
      }],
      completionDefinition: {
        taskViewMounted: true,
        clerkOwnerBound: true,
        evidencePersisted: true,
        finalState: "AWAITING_VERIFICATION",
        closed: false,
      },
      evidenceRequirements: [
        { type: "live-route-check" },
        { type: "clerk-role-binding" },
        { type: "task-view-field-check" },
      ],
      executionPolicy: {
        timeoutMs: 300_000,
        maxRetries: 1,
        maxCalls: 3,
        maxCostMicrousd: 10_000,
        checkpointRequired: true,
      },
      resumeNode: { node: "mgs-001-owner-verification" },
      escalationConditions: [{ target: "owner", condition: "independent_verification_required" }],
      ownerAttentionBudget: {
        maxOwnerInterruptions: 1,
        mergeHumanActions: true,
        noScreenshotWhenAutoVerifiable: true,
      },
      maxDelegationDepth: 0,
    }, AICEO_OWNER_SIDE_GOVERNANCE_ACTOR_ID, "aiceo_validator");

    const run = await protocol.start(contract.id, {
      idempotencyKey: "mgs-001-task-73-grok-execution",
      agentType: "technical_lead",
      agentActorId: AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
      parentRunId: null,
      delegationDepth: 0,
      inheritedAuthority: "delegated_technical_authority",
      contextHash: contract.contextHash,
      routingCapability: "code.inspect",
      routingCandidates: [
        { adapter: "grok-technical-lead", version: "mgs-001" },
        { adapter: "evidence-recorder", version: "v1" },
      ],
      rootCauseDiagnosis: "Task 73 lacked a dedicated revision-49 contract and persisted Grok execution evidence.",
      minimalEffectiveAction: "Issue the exact Task 73 contract and submit the already-built MGS-001 evidence.",
    });

    await protocol.submit(run.id, {
      understandingStatus: "CLEAR",
      observedScope: ["code.inspect"],
      result: {
        taskId: "73",
        workstream: "MGS-001",
        implementationStatus: "implemented_awaiting_owner_verification",
        routes: ["/gov", "/gov/login", "/gov/sso-callback", "/gov/tasks/73"],
        productionAuthority: false,
      },
      evidence,
      usedCalls: 1,
      usedCostMicrousd: 0,
      retryCount: 0,
      checkpoint: {
        node: "mgs-001-owner-verification",
        partialSuccess: false,
      },
    }, AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID);

    const persistedContract = (await tx.select().from(aiceoExecutionContractsTable)
      .where(eq(aiceoExecutionContractsTable.id, contract.id)).limit(1))[0];
    const persistedRun = (await tx.select().from(aiceoAgentRunsTable)
      .where(eq(aiceoAgentRunsTable.id, run.id)).limit(1))[0];
    const lifecycle = await tx.select().from(aiceoExecutionGovernanceLifecycleTable)
      .where(eq(aiceoExecutionGovernanceLifecycleTable.runId, run.id));
    return {
      reused: false,
      contract: persistedContract,
      run: persistedRun,
      lifecycle,
    };
  });

  console.log(JSON.stringify({
    reused: output.reused,
    taskId: "73",
    contractId: output.contract.id,
    contractStatus: output.contract.status,
    revision: output.contract.continuityRevision,
    productionAuthority: output.contract.productionAuthority,
    runId: output.run?.id ?? null,
    executionIdentity: output.run?.agentActorId ?? null,
    runState: output.run?.state ?? null,
    evidence: output.run?.evidence ?? [],
    lifecycle: output.lifecycle.map((event) => event.state),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
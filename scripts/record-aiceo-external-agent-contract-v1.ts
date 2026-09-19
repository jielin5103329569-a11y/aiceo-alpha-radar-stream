import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoAgentRunsTable,
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
  aiceoControlStateTable,
  aiceoExecutionContractsTable,
  aiceoTasksTable,
} from "@workspace/db/schema";
import {
  AiceoAgentExecutionProtocol,
  aiceoPersistentStateContextDigest,
} from "../artifacts/api-server/src/lib/aiceoAgentExecutionProtocol";
import {
  AiceoContinuityLayer,
  EXTERNAL_AGENT_CONTRACT_V1_ENTITY_IDENTITY,
} from "../artifacts/api-server/src/lib/aiceoContinuityLayer";
import {
  AiceoExternalAgentContractV1Service,
  verifyExternalAgentContractV1Integrity,
} from "../artifacts/api-server/src/lib/aiceoExternalAgentContractV1";
import {
  aiceoControlPlane,
  assertAiceoTaskGovernanceAuthorized,
} from "../artifacts/api-server/src/lib/aiceoControlPlane";
import { assertCredentialPersistenceSafe } from "../artifacts/api-server/src/lib/aiceoCredentialPersistenceFirewall";

const ACTOR = "aiceo:external-agent-contract-v1-implementation-recorder";
const TASK_RESOURCE = "External Agent Contract V1 implementation recorder binding only";
const IDEMPOTENCY_KEY = "external-agent-contract-v1-implementation-recorder";
const EXPECTED_TASK_ID = "ad5a806c-2166-4a72-a026-da55365f72f5";
const EXPECTED_EXECUTION_CONTRACT_ID = "10fe7faa-33aa-4b08-a3b8-ebff75cc3213";

async function getOrCreateRecorderTask() {
  const existing = (await db.select().from(aiceoTasksTable).where(and(
    eq(aiceoTasksTable.resource, TASK_RESOURCE),
    inArray(aiceoTasksTable.state, ["QUEUED", "VALIDATING", "COMPLETED"]),
  )).limit(1))[0];
  if (existing) return existing;
  return aiceoControlPlane.submit({
    action: "contract.echo",
    resource: TASK_RESOURCE,
    governance: { classification: "ordinary_technical", redLines: [] },
    environment: "development",
    maxRetries: 0,
    timeoutMs: 10_000,
  }, ACTOR);
}

async function main() {
  const task = await getOrCreateRecorderTask();
  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable).limit(1).for("update"))[0];
    const state = (await tx.select().from(aiceoContinuityStateTable).limit(1).for("update"))[0];
    const currentTask = (await tx.select().from(aiceoTasksTable)
      .where(eq(aiceoTasksTable.id, task.id)).limit(1).for("update"))[0];
    assert.ok(project && state && currentTask, "server-owned recorder roots are missing");
    assert.equal(currentTask.id, EXPECTED_TASK_ID, "unexpected recorder task");
    await assertAiceoTaskGovernanceAuthorized(tx, currentTask);

    const existingEvidence = currentTask.evidence?.externalAgentContractV1Implementation as
      | { executionContractId?: string; manifestHash?: string }
      | undefined;
    if (existingEvidence?.executionContractId && existingEvidence.manifestHash) {
      return {
        taskId: currentTask.id,
        executionContractId: existingEvidence.executionContractId,
        manifestHash: existingEvidence.manifestHash,
        revision: state.revision,
        alreadyRecorded: true,
      };
    }

    assert.equal(state.revision, 48, "recorder must start from accepted revision 48");
    assert.equal(state.state, "COMPLETED");
    assert.equal(state.currentState.verification, "VERIFIED");
    assert.equal(state.currentState.closure, "CLOSED");
    assert.equal(state.resumeNode.node, "g1-003-context-compiler-deferred");
    assert.equal(state.resumeNode.status, "CLOSED");
    assert.equal(
      state.entityRegistry.some((entity: Record<string, unknown>) =>
        entity.id === EXTERNAL_AGENT_CONTRACT_V1_ENTITY_IDENTITY.id),
      false,
      "External Agent Contract V1 recorder revision already exists",
    );

    const recorderPointer = {
      type: "external_agent_contract_v1_implementation_recorder",
      sourceRevision: state.revision,
      sourceResumeNode: state.resumeNode.node,
      taskId: currentTask.id,
      implementationActorId: ACTOR,
      result: "READY_FOR_INDEPENDENT_VALIDATION",
      finalClosurePerformed: false,
      authorityUnchanged: true,
      productionAuthority: false,
    };
    const update = {
      state: "COMPLETED" as const,
      currentState: {
        ...state.currentState,
        activeTask: null,
        completedTask: "External Agent Contract V1 implementation recorder",
        implementation: "COMPLETED",
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        closureIntegrityAudit: "NOT_VERIFIED",
        closureIntegrityAuditedRevision: null,
      },
      decisionRuleRegistry: state.decisionRuleRegistry,
      entityRegistry: [
        ...state.entityRegistry.map((entity: Record<string, unknown>) =>
          entity.id === "continuity-001"
            ? { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" }
            : entity),
        {
          ...EXTERNAL_AGENT_CONTRACT_V1_ENTITY_IDENTITY,
          status: "COMPLETED",
          verification: "NOT_VERIFIED",
          closure: "BLOCKED",
        },
      ],
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, recorderPointer],
      resumeNode: {
        node: "external-agent-contract-v1-ready-for-independent-validation",
        action: "Independent Validator may verify V1 recorder binding; final Closure and Capability Registry Gap 3 remain blocked",
        status: "BLOCKED",
        ownerGate: false,
      },
      failureReason: null,
      recoveryStrategy: "Independent read-only Validator must verify the server-owned V1 binding before any Closure",
      ownerGateReason: null,
    };
    assertCredentialPersistenceSafe(update, "external-agent-contract-v1-recorder-state");
    const recorded = await new AiceoContinuityLayer(tx, true).update(update, ACTOR);
    assert.equal(recorded.revision, 49);

    const protocol = new AiceoAgentExecutionProtocol(tx, true);
    const executionContract = await protocol.issue({
      idempotencyKey: IDEMPOTENCY_KEY,
      ownerIntent: "Bro，继续",
      intentUnderstanding: {
        certainty: "HIGH",
        interpretedIntent: "Resume",
        actionTarget: "resume",
        confirmationSummary: "Resume the verified Persistent State breakpoint",
        reasonableInterpretations: [{
          meaning: "Resume from the verified Persistent State breakpoint",
          actionTarget: "resume",
        }],
        materiallyDifferentActions: false,
        contextHighlyClear: true,
        stableAlias: true,
        verifiedExpressionPattern: true,
        riskLevel: "LOW",
      },
      continuityRevision: recorded.revision,
      scope: { controlPlaneTaskId: currentTask.id, operation: "record_existing_v1_implementation_binding" },
      objective: "Create a server-owned V1 manifest binding for later independent validation without starting a run",
      allowedCapabilities: ["contract.echo"],
      deniedCapabilities: [],
      frozenRules: [{ id: "001-013", frozen: true }],
      completionDefinition: {
        validationStatus: "READY_FOR_INDEPENDENT_VALIDATION",
        taskState: "QUEUED",
        executionContractState: "ISSUED",
        runId: null,
        finalClosurePerformed: false,
      },
      evidenceRequirements: [{ type: "canonical_manifest_and_hash" }],
      executionPolicy: {
        timeoutMs: 10_000,
        maxRetries: 0,
        maxCalls: 0,
        maxCostMicrousd: 0,
        checkpointRequired: false,
      },
      resumeNode: { node: "external-agent-contract-v1-ready-for-independent-validation" },
      escalationConditions: [{ target: "brain", condition: "binding_or_context_drift" }],
      ownerAttentionBudget: {
        maxOwnerInterruptions: 0,
        mergeHumanActions: true,
        noScreenshotWhenAutoVerifiable: true,
      },
      maxDelegationDepth: 0,
    }, ACTOR);
    assert.equal(executionContract.status, "ISSUED");

    const service = new AiceoExternalAgentContractV1Service({
      load: async (request) => {
        const boundTask = (await tx.select().from(aiceoTasksTable)
          .where(eq(aiceoTasksTable.id, request.taskId)).limit(1))[0];
        const boundContract = (await tx.select().from(aiceoExecutionContractsTable)
          .where(eq(aiceoExecutionContractsTable.id, request.executionContractId)).limit(1))[0];
        const persistentState = (await tx.select().from(aiceoContinuityStateTable)
          .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1))[0];
        const control = (await tx.select().from(aiceoControlStateTable).limit(1))[0];
        assert.ok(boundTask && boundContract && persistentState && control);
        await assertAiceoTaskGovernanceAuthorized(tx, boundTask);
        return {
          task: boundTask as any,
          executionContract: boundContract,
          run: null,
          persistentState: {
            projectId: persistentState.projectId,
            revision: persistentState.revision,
            contextHash: aiceoPersistentStateContextDigest(persistentState),
            decisionRuleRegistry: persistentState.decisionRuleRegistry,
          },
          project,
          control,
        };
      },
    });
    const request = {
      taskId: currentTask.id,
      executionContractId: executionContract.id,
      providerAdapter: {
        adapterId: "implementation-recorder",
        providerKind: "provider_neutral",
        declaredCapabilities: ["contract.echo"],
      },
    };
    const contractV1 = await service.issue(request);
    assert.equal(verifyExternalAgentContractV1Integrity(contractV1), true);
    assert.equal(contractV1.validationStatus, "READY_FOR_INDEPENDENT_VALIDATION");
    assert.equal(contractV1.manifest.bindings.run, null);
    assert.equal(contractV1.manifest.bindings.persistentState.revision, 49);

    const evidence = {
      ...(currentTask.evidence ?? {}),
      externalAgentContractV1Implementation: {
        recorderVersion: 1,
        implementationActorId: ACTOR,
        continuityEventHash: recorded.eventHash,
        persistentRevision: recorded.revision,
        taskId: currentTask.id,
        taskState: "QUEUED",
        executionContractId: executionContract.id,
        executionContractStatus: "ISSUED",
        runId: null,
        canonicalManifest: contractV1.canonicalManifest,
        manifestHash: contractV1.manifestHash,
        governanceDigest: contractV1.manifest.interfaces.governanceEnvelope.governanceDigest,
        validationStatus: "READY_FOR_INDEPENDENT_VALIDATION",
        finalClosurePerformed: false,
        capabilityRegistryGap3Started: false,
        productionAuthority: false,
      },
    };
    assertCredentialPersistenceSafe(evidence, "external-agent-contract-v1-recorder-evidence");
    await tx.update(aiceoTasksTable).set({ evidence, updatedAt: new Date() })
      .where(eq(aiceoTasksTable.id, currentTask.id));

    const activeRuns = await tx.select({ id: aiceoAgentRunsTable.id }).from(aiceoAgentRunsTable)
      .where(eq(aiceoAgentRunsTable.contractId, executionContract.id));
    assert.equal(activeRuns.length, 0);
    return {
      taskId: currentTask.id,
      executionContractId: executionContract.id,
      manifestHash: contractV1.manifestHash,
      governanceDigest: contractV1.manifest.interfaces.governanceEnvelope.governanceDigest,
      revision: recorded.revision,
      alreadyRecorded: false,
    };
  });

  const storedTask = (await db.select().from(aiceoTasksTable)
    .where(eq(aiceoTasksTable.id, result.taskId)).limit(1))[0];
  const evidence = storedTask.evidence?.externalAgentContractV1Implementation as any;
  assert.equal(result.executionContractId, EXPECTED_EXECUTION_CONTRACT_ID, "unexpected recorder execution contract");
  assert.ok(["QUEUED", "VALIDATING"].includes(storedTask.state));
  assert.equal(evidence.validationStatus, "READY_FOR_INDEPENDENT_VALIDATION");
  assert.equal(evidence.finalClosurePerformed, false);
  assert.equal(evidence.capabilityRegistryGap3Started, false);
  assert.equal(evidence.productionAuthority, false);
  const current = await new AiceoExternalAgentContractV1Service().issue({
    taskId: result.taskId,
    executionContractId: result.executionContractId,
    providerAdapter: {
      adapterId: "implementation-recorder",
      providerKind: "provider_neutral",
      declaredCapabilities: ["contract.echo"],
    },
  });
  assert.equal(current.manifestHash, result.manifestHash);
  assert.equal(current.canonicalManifest, evidence.canonicalManifest);
  const finalized = await aiceoControlPlane.finalizeExternalAgentContractV1Recorder({
    taskId: result.taskId,
    executionContractId: result.executionContractId,
    persistentRevision: result.revision,
    manifestHash: result.manifestHash,
    governanceDigest: result.governanceDigest ?? evidence.governanceDigest,
    actorId: ACTOR,
  });
  const finalizedContract = await new AiceoExternalAgentContractV1Service().issue({
    taskId: result.taskId,
    executionContractId: result.executionContractId,
    providerAdapter: {
      adapterId: "implementation-recorder",
      providerKind: "provider_neutral",
      declaredCapabilities: ["contract.echo"],
    },
  });
  assert.equal(finalizedContract.manifestHash, result.manifestHash);
  assert.equal(finalizedContract.canonicalManifest, evidence.canonicalManifest);
  console.log(JSON.stringify({ ...result, ...finalized, validationStatus: "READY_FOR_INDEPENDENT_VALIDATION", runId: null }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
import assert from "node:assert/strict";
import {
  AICEO_EXTERNAL_AGENT_CONTRACT_VERSION,
  AiceoExternalAgentContractV1Service,
  verifyExternalAgentContractV1Integrity,
} from "../artifacts/api-server/src/lib/aiceoExternalAgentContractV1";
import { AiceoCredentialPersistenceError } from "../artifacts/api-server/src/lib/aiceoCredentialPersistenceFirewall";

const hash = (character: string) => character.repeat(64);
const request = {
  providerAdapter: {
    adapterId: "adapter.example",
    providerKind: "provider-neutral-example",
    declaredCapabilities: ["analysis.read", "contract.echo"],
  },
  taskId: "task-1",
  executionContractId: "execution-contract-1",
  runId: "run-1",
};
const serverState = {
  task: {
    id: "task-1",
    state: "RUNNING",
    action: "contract.echo",
    resource: "Synthetic development evidence",
    contractVersion: "GROK-DEV-CONTRACT-1",
    contractHash: hash("a"),
    environment: "development",
    authority: "grok_restricted_development",
    governanceClassification: "ordinary_technical" as const,
    ownerProtectionRedLines: [],
  },
  executionContract: {
    id: "execution-contract-1",
    status: "RUNNING",
    projectId: "project-1",
    objective: "Analyze a bounded development artifact",
    scope: { controlPlaneTaskId: "task-1", artifact: "synthetic" },
    contractVersion: "BRAIN-AGENT-002",
    contractHash: hash("b"),
    continuityRevision: 48,
    contextHash: hash("c"),
    allowedCapabilities: ["contract.echo", "analysis.read"],
    deniedCapabilities: ["production", "trading", "shell", "workflow"],
    authorityBoundaries: {
      ownerSovereignty: true,
      ownerProtectionTriad: true,
      authority: "delegated_technical_authority",
      intentConfirmationIsNotAuthorization: true,
      ownerGovernanceGateStillRequired: false,
      productionAuthority: false,
    },
    evidenceRequirements: [{ kind: "scope" }, { kind: "result" }],
    productionAuthority: false,
  },
  run: {
    id: "run-1",
    contractId: "execution-contract-1",
    agentActorId: "external-agent-example",
    state: "RUNNING",
  },
  persistentState: {
    projectId: "project-1",
    revision: 48,
    contextHash: hash("c"),
    decisionRuleRegistry: [{ source: "persistent_state" }],
  },
  project: {
    id: "project-1",
    environment: "development",
    authority: "restricted_development",
    productionAuthority: false,
  },
  control: {
    queueActive: true,
    killSwitch: false,
    circuitState: "CLOSED",
  },
};

async function main() {
  const service = new AiceoExternalAgentContractV1Service({
    load: async () => structuredClone(serverState) as any,
  });
  const first = await service.issue(request);
  const reordered = await service.issue({
    ...request,
    providerAdapter: {
      ...request.providerAdapter,
      declaredCapabilities: ["contract.echo", "analysis.read", "contract.echo"],
    },
  });

  assert.equal(first.manifest.version, AICEO_EXTERNAL_AGENT_CONTRACT_VERSION);
  assert.equal(first.manifest.baseExecutionProtocol, "BRAIN-AGENT-002");
  assert.equal(Object.keys(first.manifest.interfaces).length, 8);
  assert.equal(first.manifestHash, reordered.manifestHash);
  assert.equal(verifyExternalAgentContractV1Integrity(first), true);
  assert.equal(await service.verifyCurrentBindings(first), true);
  assert.equal(first.validationStatus, "READY_FOR_INDEPENDENT_VALIDATION");
  assert.equal(first.productionAuthority, false);
  assert.equal(first.manifest.interfaces.executionReceipt.immutableReceiptStorageImplemented, false);
  assert.equal(first.manifest.interfaces.executionReceipt.storage, "deferred_to_gap_6");
  assert.equal(first.manifest.interfaces.independentVerificationGate.executionMaySelfVerify, false);
  assert.equal(first.manifest.interfaces.governanceEnvelope.digestSource, "server_owned");
  assert.equal(first.manifest.interfaces.governanceEnvelope.externalInterpretationAllowed, false);
  assert.equal(first.manifest.interfaces.governanceEnvelope.externalModificationAllowed, false);
  assert.equal(first.manifest.interfaces.governanceEnvelope.externalAuthorityGrantAllowed, false);
  assert.equal(first.manifest.bindings.persistentState.truthSource, "persistent_state");

  const escalated = new AiceoExternalAgentContractV1Service({
    load: async () => structuredClone(serverState) as any,
  });
  await assert.rejects(
    escalated.issue({
      ...request,
      providerAdapter: { ...request.providerAdapter, declaredCapabilities: ["production.deploy"] },
    }),
    /capability declaration is invalid/,
  );
  const stale = new AiceoExternalAgentContractV1Service({
    load: async () => ({
      ...structuredClone(serverState),
      persistentState: { ...serverState.persistentState, revision: 49 },
    }) as any,
  });
  await assert.rejects(stale.issue(request), /current restricted Development bindings/);
  const unrelated = new AiceoExternalAgentContractV1Service({
    load: async () => ({
      ...structuredClone(serverState),
      executionContract: {
        ...serverState.executionContract,
        scope: { controlPlaneTaskId: "different-task" },
      },
    }) as any,
  });
  await assert.rejects(unrelated.issue(request), /task\/contract link/);
  const lifecycleMismatch = new AiceoExternalAgentContractV1Service({
    load: async () => ({
      ...structuredClone(serverState),
      executionContract: { ...serverState.executionContract, status: "ISSUED" },
    }) as any,
  });
  await assert.rejects(lifecycleMismatch.issue(request), /lifecycle mismatch/);
  const recorderAwaitingValidation = new AiceoExternalAgentContractV1Service({
    load: async () => ({
      ...structuredClone(serverState),
      task: { ...serverState.task, state: "VALIDATING" },
      executionContract: {
        ...serverState.executionContract,
        status: "ISSUED",
        scope: {
          controlPlaneTaskId: "task-1",
          operation: "record_existing_v1_implementation_binding",
        },
      },
      run: null,
    }) as any,
  });
  const recorderContract = await recorderAwaitingValidation.issue({
    ...request,
    runId: undefined,
  });
  assert.equal(recorderContract.validationStatus, "READY_FOR_INDEPENDENT_VALIDATION");
  assert.equal(recorderContract.manifest.bindings.run, null);
  await assert.rejects(
    service.issue({
      ...request,
      providerAdapter: {
        ...request.providerAdapter,
        adapterId: "api_key=sk-test-SYNTHETICEXTERNAL123",
      },
    }),
    (error) => error instanceof AiceoCredentialPersistenceError
      && !error.message.includes("SYNTHETICEXTERNAL123"),
  );

  const tampered = structuredClone(first);
  tampered.manifest.interfaces.permissionEnvelope.productionAuthority = true as false;
  assert.equal(verifyExternalAgentContractV1Integrity(tampered), false);

  const governanceAttack = structuredClone(first);
  governanceAttack.manifest.interfaces.governanceEnvelope.externalAuthorityGrantAllowed = true as false;
  assert.equal(verifyExternalAgentContractV1Integrity(governanceAttack), false);

  const evidenceAttack = structuredClone(first);
  evidenceAttack.manifest.interfaces.evidenceAndProvenance.productionAuthority = true as false;
  assert.equal(verifyExternalAgentContractV1Integrity(evidenceAttack), false);

  const changedStateService = new AiceoExternalAgentContractV1Service({
    load: async () => ({
      ...structuredClone(serverState),
      persistentState: {
        ...serverState.persistentState,
        decisionRuleRegistry: [{ source: "persistent_state", changed: true }],
      },
    }) as any,
  });
  assert.equal(await changedStateService.verifyCurrentBindings(first), false);

  console.log("AICEO External Agent Contract V1 tests passed: server-owned bindings, eight interfaces, canonical manifest, authority isolation, credential firewall, and validator-ready status.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
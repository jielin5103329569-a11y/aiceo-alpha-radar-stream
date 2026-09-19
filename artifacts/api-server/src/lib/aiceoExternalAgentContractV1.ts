import { createHash } from "node:crypto";
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
  AICEO_AGENT_EXECUTION_PROTOCOL_VERSION,
  AICEO_INTENT_GATE_VERSION,
  aiceoPersistentStateContextDigest,
} from "./aiceoAgentExecutionProtocol";
import { assertCredentialPersistenceSafe } from "./aiceoCredentialPersistenceFirewall";
import { assertAiceoTaskGovernanceAuthorized } from "./aiceoControlPlane";
import {
  AICEO_AGENT_AUTHORITY,
  AICEO_GOVERNANCE_ROOT_VERSION,
  OWNER_PROTECTION_RED_LINES,
  type GovernanceClassification,
  type OwnerProtectionRedLine,
} from "./aiceoGovernanceRoot";

export const AICEO_EXTERNAL_AGENT_CONTRACT_VERSION = "AICEO-EXTERNAL-AGENT-CONTRACT-V1";
export const AICEO_EXTERNAL_AGENT_MANIFEST_HASH_ALGORITHM = "sha256";
const MANIFEST_HASH_DOMAIN = "AICEO_EXTERNAL_AGENT_CONTRACT_V1_MANIFEST\0";

type ExistingTaskBinding = {
  id: string;
  state: string;
  action: string;
  resource: string;
  contractVersion: string;
  contractHash: string;
  environment: string;
  authority: string;
  governanceClassification: GovernanceClassification;
  ownerProtectionRedLines: OwnerProtectionRedLine[];
};

type ExistingExecutionContractBinding = {
  id: string;
  status: string;
  projectId: string;
  objective: string;
  scope: Record<string, unknown>;
  contractVersion: string;
  contractHash: string;
  continuityRevision: number;
  contextHash: string;
  allowedCapabilities: string[];
  deniedCapabilities: string[];
  authorityBoundaries: Record<string, unknown>;
  evidenceRequirements: Record<string, unknown>[];
  productionAuthority: boolean;
};

type ExistingRunBinding = {
  id: string;
  contractId: string;
  agentActorId: string;
  state: string;
} | null;

type ServerOwnedExternalAgentContractV1State = {
  task: ExistingTaskBinding;
  executionContract: ExistingExecutionContractBinding;
  run: ExistingRunBinding;
  persistentState: {
    projectId: string;
    revision: number;
    contextHash: string;
    decisionRuleRegistry: Record<string, unknown>[];
  };
  project: {
    id: string;
    environment: string;
    authority: string;
    productionAuthority: boolean;
  };
  control: {
    queueActive: boolean;
    killSwitch: boolean;
    circuitState: string;
  };
};

export type ExternalAgentContractV1Request = {
  providerAdapter: {
    adapterId: string;
    providerKind: string;
    declaredCapabilities: string[];
  };
  taskId: string;
  executionContractId: string;
  runId?: string;
};

export type ExternalAgentContractV1Manifest = {
  version: typeof AICEO_EXTERNAL_AGENT_CONTRACT_VERSION;
  baseExecutionProtocol: typeof AICEO_AGENT_EXECUTION_PROTOCOL_VERSION;
  interfaces: {
    taskContract: {
      taskId: string;
      executionContractId: string;
      runId: string | null;
      objective: string;
      action: string;
      resource: string;
      taskExecutionBindingHash: string;
      lifecycleAuthority: "existing_state_machines";
    };
    capabilityDeclaration: {
      adapterId: string;
      providerKind: string;
      declared: string[];
      effective: string[];
      denied: string[];
      capabilityDeclarationGrantsAuthority: false;
    };
    permissionEnvelope: {
      allowedCapabilities: string[];
      deniedCapabilities: string[];
      inheritedAuthority: typeof AICEO_AGENT_AUTHORITY;
      environment: "development";
      productionAuthority: false;
    };
    executionReceipt: {
      interfaceVersion: "EXTERNAL-EXECUTION-RECEIPT-INTERFACE-V1";
      storage: "deferred_to_gap_6";
      immutableReceiptStorageImplemented: false;
      requiredBindings: string[];
      receiptGrantsAuthority: false;
    };
    evidenceAndProvenance: {
      requirements: Record<string, unknown>[];
      taskContractHash: string;
      executionContractHash: string;
      persistentStateContextHash: string;
      providerEvidenceIsCandidateOnly: true;
      productionAuthority: false;
    };
    independentVerificationGate: {
      required: true;
      verifierMustDifferFromAgent: true;
      executionMaySelfVerify: false;
      finalStatusAuthority: "existing_independent_validator";
      productionAuthority: false;
    };
    failureRecoveryContract: {
      resumableStates: string[];
      terminalStates: string[];
      staleBindingDisposition: "fail_closed";
      unsettledExecutionReplayAllowed: false;
      recoveryAuthority: "existing_control_plane_and_persistent_state";
      productionAuthority: false;
    };
    governanceEnvelope: {
      governanceRootVersion: typeof AICEO_GOVERNANCE_ROOT_VERSION;
      governanceDigest: string;
      digestSource: "server_owned";
      classification: GovernanceClassification;
      protectedRedLines: OwnerProtectionRedLine[];
      externalInterpretationAllowed: false;
      externalModificationAllowed: false;
      externalAuthorityGrantAllowed: false;
      ownerProtectionTriadPreserved: true;
      intentGateVersion: typeof AICEO_INTENT_GATE_VERSION;
      productionAuthority: false;
    };
  };
  bindings: {
    task: { id: string; contractVersion: string; contractHash: string };
    executionContract: {
      id: string;
      contractVersion: typeof AICEO_AGENT_EXECUTION_PROTOCOL_VERSION;
      contractHash: string;
    };
    run: { id: string; contractId: string; agentActorId: string } | null;
    persistentState: { revision: number; contextHash: string; truthSource: "persistent_state" };
  };
  productionAuthority: false;
};

export type ExternalAgentContractV1 = {
  manifest: ExternalAgentContractV1Manifest;
  canonicalManifest: string;
  manifestHash: string;
  hashAlgorithm: typeof AICEO_EXTERNAL_AGENT_MANIFEST_HASH_ALGORITHM;
  validationStatus: "READY_FOR_INDEPENDENT_VALIDATION";
  productionAuthority: false;
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
const normalizeCapability = (value: string) => normalize(value).toLowerCase();
const uniqueSorted = (values: string[]) => [...new Set(values.map(normalizeCapability))].sort();
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
};
const canonicalString = (value: unknown) => JSON.stringify(canonical(value));
const manifestDigest = (value: string) => createHash("sha256")
  .update(MANIFEST_HASH_DOMAIN)
  .update(value)
  .digest("hex");
const governanceDigest = (value: unknown) => createHash("sha256")
  .update("AICEO_EXTERNAL_AGENT_CONTRACT_V1_GOVERNANCE\0")
  .update(canonicalString(value))
  .digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;

function buildExternalAgentContractV1(
  request: ExternalAgentContractV1Request,
  input: ServerOwnedExternalAgentContractV1State,
): ExternalAgentContractV1 {
  assertCredentialPersistenceSafe({ request, input }, "external-agent-contract-v1");
  if (
    !normalize(request.providerAdapter.adapterId)
    || !normalize(request.providerAdapter.providerKind)
    || !normalize(input.executionContract.objective)
    || !normalize(input.task.action)
    || !normalize(input.task.resource)
    || !hashPattern.test(input.task.contractHash)
    || !hashPattern.test(input.executionContract.contractHash)
    || !hashPattern.test(input.executionContract.contextHash)
    || !hashPattern.test(input.persistentState.contextHash)
  ) {
    throw new Error("External Agent Contract V1 binding schema is invalid");
  }
  if (
    input.task.environment !== "development"
    || input.project.environment !== "development"
    || input.project.productionAuthority
    || input.executionContract.productionAuthority
    || input.executionContract.projectId !== input.project.id
    || input.persistentState.projectId !== input.project.id
    || input.executionContract.contractVersion !== AICEO_AGENT_EXECUTION_PROTOCOL_VERSION
    || input.executionContract.continuityRevision !== input.persistentState.revision
    || input.executionContract.contextHash !== input.persistentState.contextHash
    || input.run?.contractId !== undefined && input.run.contractId !== input.executionContract.id
    || !["QUEUED", "RUNNING", "VALIDATING"].includes(input.task.state)
    || !["ISSUED", "RUNNING", "AWAITING_VERIFICATION"].includes(input.executionContract.status)
    || input.run && !["RUNNING", "PAUSED", "AWAITING_VERIFICATION"].includes(input.run.state)
    || input.control.killSwitch
    || !input.control.queueActive
    || input.control.circuitState === "OPEN"
  ) {
    throw new Error("External Agent Contract V1 requires current restricted Development bindings");
  }
  const protectedRedLines = [...new Set(input.task.ownerProtectionRedLines)].sort();
  if (
    protectedRedLines.some((line) => !OWNER_PROTECTION_RED_LINES.includes(line))
    || input.task.governanceClassification === "ordinary_technical" && protectedRedLines.length > 0
    || input.task.governanceClassification === "owner_protection" && protectedRedLines.length === 0
    || input.task.governanceClassification === "legacy_unclassified"
  ) {
    throw new Error("External Agent Contract V1 governance envelope is invalid");
  }
  const allowedCapabilities = uniqueSorted(input.executionContract.allowedCapabilities);
  const deniedCapabilities = uniqueSorted(input.executionContract.deniedCapabilities);
  const declaredCapabilities = uniqueSorted(request.providerAdapter.declaredCapabilities);
  if (
    input.executionContract.scope.controlPlaneTaskId !== input.task.id
    || !allowedCapabilities.includes(normalizeCapability(input.task.action))
    || declaredCapabilities.some((capability) => !allowedCapabilities.includes(capability))
    || allowedCapabilities.some((capability) => deniedCapabilities.includes(capability))
  ) {
    throw new Error("External Agent Contract V1 task/contract link or capability declaration is invalid");
  }
  const coherentLifecycle = (
    input.task.state === "QUEUED"
      && input.executionContract.status === "ISSUED"
      && input.run === null
  ) || (
    input.task.state === "RUNNING"
      && input.executionContract.status === "RUNNING"
      && input.run !== null
      && ["RUNNING", "PAUSED"].includes(input.run.state)
  ) || (
    input.task.state === "VALIDATING"
      && input.executionContract.status === "AWAITING_VERIFICATION"
      && input.run?.state === "AWAITING_VERIFICATION"
  ) || (
    input.task.state === "VALIDATING"
      && input.executionContract.status === "ISSUED"
      && input.run === null
      && input.executionContract.scope.operation === "record_existing_v1_implementation_binding"
  );
  if (!coherentLifecycle) {
    throw new Error("External Agent Contract V1 task/contract/run lifecycle mismatch");
  }
  const authority = input.executionContract.authorityBoundaries;
  if (
    authority.ownerSovereignty !== true
    || authority.ownerProtectionTriad !== true
    || authority.authority !== AICEO_AGENT_AUTHORITY
    || authority.intentConfirmationIsNotAuthorization !== true
    || authority.productionAuthority !== false
  ) {
    throw new Error("External Agent Contract V1 authority boundary mismatch");
  }
  const serverOwnedGovernanceDigest = governanceDigest({
    governanceRootVersion: AICEO_GOVERNANCE_ROOT_VERSION,
    taskId: input.task.id,
    taskContractHash: input.task.contractHash,
    classification: input.task.governanceClassification,
    protectedRedLines,
    projectId: input.project.id,
    projectAuthority: input.project.authority,
    persistentStateRevision: input.persistentState.revision,
    persistentStateContextHash: input.persistentState.contextHash,
    decisionRuleRegistry: input.persistentState.decisionRuleRegistry,
  });
  const taskExecutionBindingHash = governanceDigest({
    task: {
      id: input.task.id,
      action: input.task.action,
      resource: input.task.resource,
      contractHash: input.task.contractHash,
    },
    executionContract: {
      id: input.executionContract.id,
      objective: input.executionContract.objective,
      scope: input.executionContract.scope,
      contractHash: input.executionContract.contractHash,
    },
  });

  const manifest: ExternalAgentContractV1Manifest = {
    version: AICEO_EXTERNAL_AGENT_CONTRACT_VERSION,
    baseExecutionProtocol: AICEO_AGENT_EXECUTION_PROTOCOL_VERSION,
    interfaces: {
      taskContract: {
        taskId: input.task.id,
        executionContractId: input.executionContract.id,
        runId: input.run?.id ?? null,
        objective: normalize(input.executionContract.objective),
        action: normalize(input.task.action),
        resource: normalize(input.task.resource),
        taskExecutionBindingHash,
        lifecycleAuthority: "existing_state_machines",
      },
      capabilityDeclaration: {
        adapterId: normalize(request.providerAdapter.adapterId),
        providerKind: normalize(request.providerAdapter.providerKind).toLowerCase(),
        declared: declaredCapabilities,
        effective: declaredCapabilities,
        denied: deniedCapabilities,
        capabilityDeclarationGrantsAuthority: false,
      },
      permissionEnvelope: {
        allowedCapabilities,
        deniedCapabilities,
        inheritedAuthority: AICEO_AGENT_AUTHORITY,
        environment: "development",
        productionAuthority: false,
      },
      executionReceipt: {
        interfaceVersion: "EXTERNAL-EXECUTION-RECEIPT-INTERFACE-V1",
        storage: "deferred_to_gap_6",
        immutableReceiptStorageImplemented: false,
        requiredBindings: [
          "manifestHash",
          "task.id",
          "executionContract.id",
          "executionContract.contractHash",
          "run.id",
          "persistentState.revision",
          "persistentState.contextHash",
        ],
        receiptGrantsAuthority: false,
      },
      evidenceAndProvenance: {
        requirements: input.executionContract.evidenceRequirements.map((item) =>
          canonical(item) as Record<string, unknown>),
        taskContractHash: input.task.contractHash,
        executionContractHash: input.executionContract.contractHash,
        persistentStateContextHash: input.persistentState.contextHash,
        providerEvidenceIsCandidateOnly: true,
        productionAuthority: false,
      },
      independentVerificationGate: {
        required: true,
        verifierMustDifferFromAgent: true,
        executionMaySelfVerify: false,
        finalStatusAuthority: "existing_independent_validator",
        productionAuthority: false,
      },
      failureRecoveryContract: {
        resumableStates: ["PAUSED"],
        terminalStates: ["FAILED", "REJECTED", "VERIFIED"],
        staleBindingDisposition: "fail_closed",
        unsettledExecutionReplayAllowed: false,
        recoveryAuthority: "existing_control_plane_and_persistent_state",
        productionAuthority: false,
      },
      governanceEnvelope: {
        governanceRootVersion: AICEO_GOVERNANCE_ROOT_VERSION,
        governanceDigest: serverOwnedGovernanceDigest,
        digestSource: "server_owned",
        classification: input.task.governanceClassification,
        protectedRedLines,
        externalInterpretationAllowed: false,
        externalModificationAllowed: false,
        externalAuthorityGrantAllowed: false,
        ownerProtectionTriadPreserved: true,
        intentGateVersion: AICEO_INTENT_GATE_VERSION,
        productionAuthority: false,
      },
    },
    bindings: {
      task: {
        id: input.task.id,
        contractVersion: input.task.contractVersion,
        contractHash: input.task.contractHash,
      },
      executionContract: {
        id: input.executionContract.id,
        contractVersion: AICEO_AGENT_EXECUTION_PROTOCOL_VERSION,
        contractHash: input.executionContract.contractHash,
      },
      run: input.run ? {
        id: input.run.id,
        contractId: input.run.contractId,
        agentActorId: input.run.agentActorId,
      } : null,
      persistentState: {
        revision: input.persistentState.revision,
        contextHash: input.persistentState.contextHash,
        truthSource: "persistent_state",
      },
    },
    productionAuthority: false,
  };
  assertCredentialPersistenceSafe(manifest, "external-agent-contract-v1-manifest");
  const canonicalManifest = canonicalString(manifest);
  return {
    manifest,
    canonicalManifest,
    manifestHash: manifestDigest(canonicalManifest),
    hashAlgorithm: AICEO_EXTERNAL_AGENT_MANIFEST_HASH_ALGORITHM,
    validationStatus: "READY_FOR_INDEPENDENT_VALIDATION",
    productionAuthority: false,
  };
}

export type ExternalAgentContractV1BindingRepository = {
  load(request: ExternalAgentContractV1Request): Promise<ServerOwnedExternalAgentContractV1State>;
};

const postgresBindingRepository: ExternalAgentContractV1BindingRepository = {
  load: (request) => db.transaction(async (tx) => {
    const task = (await tx.select().from(aiceoTasksTable)
      .where(eq(aiceoTasksTable.id, request.taskId)).limit(1))[0];
    const executionContract = (await tx.select().from(aiceoExecutionContractsTable)
      .where(eq(aiceoExecutionContractsTable.id, request.executionContractId)).limit(1))[0];
    const run = request.runId
      ? (await tx.select().from(aiceoAgentRunsTable)
        .where(eq(aiceoAgentRunsTable.id, request.runId)).limit(1))[0]
      : null;
    const existingActiveRun = !request.runId && executionContract
      ? (await tx.select({ id: aiceoAgentRunsTable.id }).from(aiceoAgentRunsTable)
        .where(and(
          eq(aiceoAgentRunsTable.contractId, executionContract.id),
          inArray(aiceoAgentRunsTable.state, ["RUNNING", "PAUSED", "AWAITING_VERIFICATION"]),
        )).limit(1))[0]
      : null;
    const state = executionContract
      ? (await tx.select().from(aiceoContinuityStateTable)
        .where(eq(aiceoContinuityStateTable.projectId, executionContract.projectId)).limit(1))[0]
      : null;
    const project = executionContract
      ? (await tx.select().from(aiceoContinuityProjectsTable)
        .where(eq(aiceoContinuityProjectsTable.id, executionContract.projectId)).limit(1))[0]
      : null;
    const control = (await tx.select().from(aiceoControlStateTable).limit(1))[0];
    if (!task || !executionContract || !state || !project || !control || request.runId && !run) {
      throw new Error("External Agent Contract V1 server-owned binding record is missing");
    }
    if (existingActiveRun) {
      throw new Error("External Agent Contract V1 active run binding cannot be omitted");
    }
    await assertAiceoTaskGovernanceAuthorized(tx, task);
    return {
      task: {
        ...task,
        governanceClassification: task.governanceClassification as GovernanceClassification,
        ownerProtectionRedLines: task.ownerProtectionRedLines as OwnerProtectionRedLine[],
      },
      executionContract,
      run,
      persistentState: {
        projectId: state.projectId,
        revision: state.revision,
        contextHash: aiceoPersistentStateContextDigest(state),
        decisionRuleRegistry: state.decisionRuleRegistry,
      },
      project,
      control,
    };
  }),
};

export class AiceoExternalAgentContractV1Service {
  constructor(private readonly repository: ExternalAgentContractV1BindingRepository = postgresBindingRepository) {}

  async issue(request: ExternalAgentContractV1Request): Promise<ExternalAgentContractV1> {
    assertCredentialPersistenceSafe(request, "external-agent-contract-v1-request");
    const state = await this.repository.load(request);
    return buildExternalAgentContractV1(request, state);
  }

  async verifyCurrentBindings(contract: ExternalAgentContractV1): Promise<boolean> {
    if (!verifyExternalAgentContractV1Integrity(contract)) return false;
    const request: ExternalAgentContractV1Request = {
      taskId: contract.manifest.bindings.task.id,
      executionContractId: contract.manifest.bindings.executionContract.id,
      runId: contract.manifest.bindings.run?.id,
      providerAdapter: {
        adapterId: contract.manifest.interfaces.capabilityDeclaration.adapterId,
        providerKind: contract.manifest.interfaces.capabilityDeclaration.providerKind,
        declaredCapabilities: contract.manifest.interfaces.capabilityDeclaration.declared,
      },
    };
    const current = await this.issue(request);
    return current.manifestHash === contract.manifestHash
      && current.canonicalManifest === contract.canonicalManifest;
  }
}

export const aiceoExternalAgentContractV1 = new AiceoExternalAgentContractV1Service();

export function verifyExternalAgentContractV1Integrity(contract: ExternalAgentContractV1): boolean {
  assertCredentialPersistenceSafe(contract, "external-agent-contract-v1-verification");
  const { manifest } = contract;
  const { interfaces, bindings } = manifest;
  if (
    manifest.version !== AICEO_EXTERNAL_AGENT_CONTRACT_VERSION
    || manifest.baseExecutionProtocol !== AICEO_AGENT_EXECUTION_PROTOCOL_VERSION
    || manifest.productionAuthority !== false
    || contract.hashAlgorithm !== AICEO_EXTERNAL_AGENT_MANIFEST_HASH_ALGORITHM
    || contract.validationStatus !== "READY_FOR_INDEPENDENT_VALIDATION"
    || contract.productionAuthority !== false
    || interfaces.taskContract.lifecycleAuthority !== "existing_state_machines"
    || !hashPattern.test(interfaces.taskContract.taskExecutionBindingHash)
    || interfaces.permissionEnvelope.inheritedAuthority !== AICEO_AGENT_AUTHORITY
    || interfaces.permissionEnvelope.environment !== "development"
    || interfaces.permissionEnvelope.productionAuthority !== false
    || interfaces.capabilityDeclaration.capabilityDeclarationGrantsAuthority !== false
    || interfaces.capabilityDeclaration.effective.some((capability) =>
      !interfaces.permissionEnvelope.allowedCapabilities.includes(capability)
      || interfaces.permissionEnvelope.deniedCapabilities.includes(capability))
    || interfaces.executionReceipt.immutableReceiptStorageImplemented !== false
    || interfaces.executionReceipt.interfaceVersion !== "EXTERNAL-EXECUTION-RECEIPT-INTERFACE-V1"
    || interfaces.executionReceipt.storage !== "deferred_to_gap_6"
    || interfaces.executionReceipt.receiptGrantsAuthority !== false
    || canonicalString(interfaces.executionReceipt.requiredBindings) !== canonicalString([
      "manifestHash",
      "task.id",
      "executionContract.id",
      "executionContract.contractHash",
      "run.id",
      "persistentState.revision",
      "persistentState.contextHash",
    ])
    || interfaces.evidenceAndProvenance.providerEvidenceIsCandidateOnly !== true
    || interfaces.evidenceAndProvenance.productionAuthority !== false
    || interfaces.independentVerificationGate.required !== true
    || interfaces.independentVerificationGate.verifierMustDifferFromAgent !== true
    || interfaces.independentVerificationGate.executionMaySelfVerify !== false
    || interfaces.independentVerificationGate.finalStatusAuthority !== "existing_independent_validator"
    || interfaces.independentVerificationGate.productionAuthority !== false
    || interfaces.failureRecoveryContract.staleBindingDisposition !== "fail_closed"
    || interfaces.failureRecoveryContract.unsettledExecutionReplayAllowed !== false
    || interfaces.failureRecoveryContract.recoveryAuthority !== "existing_control_plane_and_persistent_state"
    || interfaces.failureRecoveryContract.productionAuthority !== false
    || interfaces.governanceEnvelope.governanceRootVersion !== AICEO_GOVERNANCE_ROOT_VERSION
    || interfaces.governanceEnvelope.digestSource !== "server_owned"
    || interfaces.governanceEnvelope.externalInterpretationAllowed !== false
    || interfaces.governanceEnvelope.externalModificationAllowed !== false
    || interfaces.governanceEnvelope.externalAuthorityGrantAllowed !== false
    || interfaces.governanceEnvelope.ownerProtectionTriadPreserved !== true
    || interfaces.governanceEnvelope.intentGateVersion !== AICEO_INTENT_GATE_VERSION
    || interfaces.governanceEnvelope.productionAuthority !== false
    || !hashPattern.test(interfaces.governanceEnvelope.governanceDigest)
    || bindings.executionContract.contractVersion !== AICEO_AGENT_EXECUTION_PROTOCOL_VERSION
    || bindings.executionContract.id !== interfaces.taskContract.executionContractId
    || bindings.task.id !== interfaces.taskContract.taskId
    || canonicalString(interfaces.capabilityDeclaration.declared)
      !== canonicalString(interfaces.capabilityDeclaration.effective)
    || (bindings.run === null
      ? interfaces.taskContract.runId !== null
      : bindings.run.id !== interfaces.taskContract.runId)
    || bindings.run?.contractId !== undefined
      && bindings.run.contractId !== bindings.executionContract.id
    || bindings.persistentState.contextHash !== interfaces.evidenceAndProvenance.persistentStateContextHash
    || bindings.task.contractHash !== interfaces.evidenceAndProvenance.taskContractHash
    || bindings.executionContract.contractHash !== interfaces.evidenceAndProvenance.executionContractHash
    || bindings.persistentState.truthSource !== "persistent_state"
  ) return false;
  const canonicalManifest = canonicalString(manifest);
  return contract.canonicalManifest === canonicalManifest
    && contract.manifestHash === manifestDigest(canonicalManifest);
}
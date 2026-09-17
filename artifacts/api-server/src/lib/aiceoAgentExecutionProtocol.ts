import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoAgentRunsTable,
  aiceoAgentVerificationsTable,
  aiceoCollaborationIssuesTable,
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
  aiceoControlStateTable,
  aiceoExecutionContractsTable,
  aiceoIntentConfirmationsTable,
} from "@workspace/db/schema";

const INTENT_GATE_VERSION = "INTENT-GATE-001";
const CONTRACT_VERSION = "BRAIN-AGENT-002";
const DENIES = ["production", "trading", "databento", "alert", "shell", "workflow", "network", "database"];
const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
const normalizeCapability = (value: string) => normalize(value).toLowerCase();
const capabilityDenied = (value: string) => DENIES.some((deny) =>
  new RegExp(`^${deny}(?:$|[^a-z0-9])`, "i").test(value));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const forbidden = (value: unknown) => /password|secret|token|credential|api[_ -]?key/i.test(JSON.stringify(value));

type IntentRisk = "LOW" | "MEDIUM" | "HIGH" | "PROTECTED";
type IntentUnderstanding = {
  certainty: "HIGH" | "UNCERTAIN";
  interpretedIntent: string;
  actionTarget: string;
  confirmationSummary: string;
  reasonableInterpretations: { meaning: string; actionTarget: string }[];
  materiallyDifferentActions: boolean;
  contextHighlyClear: boolean;
  stableAlias: boolean;
  verifiedExpressionPattern: boolean;
  riskLevel: IntentRisk;
};

const contextDigest = (state: any) => digest({
  revision: state.revision,
  state: state.currentState,
  rules: state.decisionRuleRegistry,
});

const parseIntentUnderstanding = (value: unknown): IntentUnderstanding => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("不能：Intent Uncertainty Confirmation Gate requires a structured Brain understanding");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "certainty",
    "interpretedIntent",
    "actionTarget",
    "confirmationSummary",
    "reasonableInterpretations",
    "materiallyDifferentActions",
    "contextHighlyClear",
    "stableAlias",
    "verifiedExpressionPattern",
    "riskLevel",
  ]);
  const interpretations = input.reasonableInterpretations;
  if (
    Object.keys(input).some((key) => !allowed.has(key))
    || !["HIGH", "UNCERTAIN"].includes(String(input.certainty))
    || typeof input.interpretedIntent !== "string"
    || !normalize(input.interpretedIntent)
    || typeof input.actionTarget !== "string"
    || !normalize(input.actionTarget)
    || typeof input.confirmationSummary !== "string"
    || !normalize(input.confirmationSummary)
    || !Array.isArray(interpretations)
    || interpretations.length < 1
    || interpretations.some((item) =>
      !item
      || typeof item !== "object"
      || Array.isArray(item)
      || Object.keys(item as Record<string, unknown>).some((key) => !["meaning", "actionTarget"].includes(key))
      || typeof (item as Record<string, unknown>).meaning !== "string"
      || !normalize(String((item as Record<string, unknown>).meaning))
      || typeof (item as Record<string, unknown>).actionTarget !== "string"
      || !normalize(String((item as Record<string, unknown>).actionTarget)))
    || typeof input.materiallyDifferentActions !== "boolean"
    || typeof input.contextHighlyClear !== "boolean"
    || typeof input.stableAlias !== "boolean"
    || typeof input.verifiedExpressionPattern !== "boolean"
    || !["LOW", "MEDIUM", "HIGH", "PROTECTED"].includes(String(input.riskLevel))
  ) {
    throw new Error("不能：Intent Uncertainty Confirmation Gate understanding schema is invalid");
  }
  return input as IntentUnderstanding;
};

const requiresOwnerConfirmation = (
  understanding: IntentUnderstanding,
  ownerIntent: string,
  aliasDictionary: Record<string, unknown>,
) => {
  const hasMaterialAlternatives =
    understanding.reasonableInterpretations.length >= 2
    && understanding.materiallyDifferentActions;
  const normalizedIntent = normalize(ownerIntent).toLowerCase();
  const exactStableAliasTarget = Object.entries(aliasDictionary).find(([alias]) =>
    normalize(alias).toLowerCase() === normalizedIntent)?.[1];
  const exactStableAlias =
    exactStableAliasTarget === "resume"
    && normalize(understanding.interpretedIntent).toLowerCase() === "resume"
    && normalize(understanding.actionTarget).toLowerCase() === "resume";
  const hasUnresolvedReference = /(?:\b(?:it|that|this|those|these|there|same)\b|这个|那个|这件事|那件事|这样|那样|它|上面|刚才|之前)/i.test(ownerIntent);
  const trustedLowRiskLanguage =
    understanding.riskLevel === "LOW"
    && understanding.certainty === "HIGH"
    && !hasMaterialAlternatives
    && !hasUnresolvedReference
    && exactStableAlias;
  return hasMaterialAlternatives || !trustedLowRiskLanguage;
};

export const intentBindingDigest = (input: {
  ownerExpression: string;
  interpretedIntent: string;
  actionTarget: string;
  reasonableInterpretations: { meaning: string; actionTarget: string }[];
  riskLevel: IntentRisk;
  continuityRevision: number;
  contextHash: string;
}) => digest({
  ownerExpression: normalize(input.ownerExpression),
  interpretedIntent: normalize(input.interpretedIntent),
  actionTarget: normalize(input.actionTarget),
  reasonableInterpretations: input.reasonableInterpretations.map((item) => ({
    meaning: normalize(item.meaning),
    actionTarget: normalize(item.actionTarget),
  })),
  riskLevel: input.riskLevel,
  continuityRevision: input.continuityRevision,
  contextHash: input.contextHash,
});
export const executionBindingDigest = (input: {
  scope: Record<string, unknown>;
  objective: string;
  allowedCapabilities: string[];
  deniedCapabilities: string[];
  completionDefinition: Record<string, unknown>;
}) => digest({
  scope: input.scope,
  objective: normalize(input.objective),
  allowedCapabilities: [...input.allowedCapabilities].sort(),
  deniedCapabilities: [...input.deniedCapabilities].sort(),
  completionDefinition: input.completionDefinition,
});

export class AiceoAgentExecutionProtocol {
  constructor(private readonly database: any = db, private readonly existingTransaction = false) {}

  private transact<T>(work: (tx: any) => Promise<T>): Promise<T> {
    return this.existingTransaction ? work(this.database) : this.database.transaction(work);
  }

  async confirmIntent(input: any, ownerActorId: string) {
    return this.transact(async (tx) => {
      const project = (await tx.select().from(aiceoContinuityProjectsTable).limit(1))[0];
      const state = (await tx.select().from(aiceoContinuityStateTable).limit(1).for("update"))[0];
      if (!project || !state || input.continuityRevision !== state.revision) {
        throw new Error("不能：stale intent confirmation revision");
      }
      if (
        typeof input.confirmationKey !== "string"
        || !normalize(input.confirmationKey)
        || typeof input.ownerExpression !== "string"
        || !normalize(input.ownerExpression)
      ) {
        throw new Error("不能：Owner intent confirmation input is invalid");
      }
      const understanding = parseIntentUnderstanding(input.understanding);
      const contextHash = contextDigest(state);
      const executionBindingHash = executionBindingDigest(input.executionBinding);
      const intentHash = intentBindingDigest({
        ownerExpression: input.ownerExpression,
        interpretedIntent: understanding.interpretedIntent,
        actionTarget: understanding.actionTarget,
        reasonableInterpretations: understanding.reasonableInterpretations,
        riskLevel: understanding.riskLevel,
        continuityRevision: state.revision,
        contextHash,
      });
      const old = (await tx.select().from(aiceoIntentConfirmationsTable)
        .where(and(
          eq(aiceoIntentConfirmationsTable.projectId, project.id),
          eq(aiceoIntentConfirmationsTable.confirmationKey, input.confirmationKey),
        )).limit(1))[0];
      if (old) {
        if (old.intentHash !== intentHash || old.ownerActorId !== ownerActorId) {
          throw new Error("不能：Owner intent confirmation idempotency conflict");
        }
        return old;
      }
      return (await tx.insert(aiceoIntentConfirmationsTable).values({
        projectId: project.id,
        confirmationKey: normalize(input.confirmationKey),
        ownerActorId: ownerActorId.slice(0, 180),
        continuityRevision: state.revision,
        ownerExpression: normalize(input.ownerExpression),
        interpretedIntent: normalize(understanding.interpretedIntent),
        actionTarget: normalize(understanding.actionTarget),
        contextHash,
        intentHash,
        executionBindingHash,
        riskLevel: understanding.riskLevel,
        reasonableInterpretations: understanding.reasonableInterpretations,
        status: "CONFIRMED",
        productionAuthority: false,
      }).returning())[0];
    });
  }

  async issue(input: any, actorId: string) {
    return this.transact(async (tx) => {
      const project = (await tx.select().from(aiceoContinuityProjectsTable).limit(1))[0];
      const state = (await tx.select().from(aiceoContinuityStateTable).limit(1).for("update"))[0];
      if (!project || !state || input.continuityRevision !== state.revision) {
        throw new Error("不能：stale persistent state");
      }
      if (forbidden(input)) throw new Error("不能：秘密或凭据不得进入 Agent context");
      if (
        input.ownerAttentionBudget?.maxOwnerInterruptions > 1
        || input.ownerAttentionBudget?.mergeHumanActions !== true
        || input.ownerAttentionBudget?.noScreenshotWhenAutoVerifiable !== true
      ) {
        throw new Error("不能：Owner Attention Budget must minimize and merge Owner actions");
      }
      const understanding = parseIntentUnderstanding(input.intentUnderstanding);
      if (
        typeof input.ownerIntent !== "string"
        || !normalize(input.ownerIntent)
        || typeof input.objective !== "string"
        || !normalize(input.objective)
        || !input.scope
        || typeof input.scope !== "object"
        || Array.isArray(input.scope)
        || !input.completionDefinition
        || typeof input.completionDefinition !== "object"
        || Array.isArray(input.completionDefinition)
        || !Array.isArray(input.allowedCapabilities)
        || input.allowedCapabilities.some((capability: unknown) => typeof capability !== "string")
        || !Array.isArray(input.deniedCapabilities)
        || input.deniedCapabilities.some((capability: unknown) => typeof capability !== "string")
      ) {
        throw new Error("不能：Brain execution contract schema is invalid");
      }
      const allowedCapabilities: string[] = [...new Set<string>(
        input.allowedCapabilities.map(normalizeCapability),
      )];
      const deniedCapabilities: string[] = [...new Set<string>([
        ...input.deniedCapabilities.map(normalizeCapability),
        ...DENIES,
      ])];
      if (
        allowedCapabilities.some((capability) => deniedCapabilities.includes(capability))
        || allowedCapabilities.some(capabilityDenied)
      ) {
        throw new Error("不能：allowed and denied capabilities must be disjoint; protected capabilities remain denied");
      }
      const contextHash = contextDigest(state);
      const executionBindingHash = executionBindingDigest({
        scope: input.scope,
        objective: input.objective,
        allowedCapabilities,
        deniedCapabilities,
        completionDefinition: input.completionDefinition,
      });
      const intentHash = intentBindingDigest({
        ownerExpression: input.ownerIntent,
        interpretedIntent: understanding.interpretedIntent,
        actionTarget: understanding.actionTarget,
        reasonableInterpretations: understanding.reasonableInterpretations,
        riskLevel: understanding.riskLevel,
        continuityRevision: state.revision,
        contextHash,
      });
      const confirmationRequired = requiresOwnerConfirmation(
        understanding,
        input.ownerIntent,
        state.aliasDictionary,
      );
      let confirmation: any = null;
      if (confirmationRequired) {
        if (typeof input.intentConfirmationId !== "string") {
          throw new Error(`不能：意图不确定，需向 Owner 最短复述并确认：${understanding.confirmationSummary}`);
        }
        confirmation = (await tx.select().from(aiceoIntentConfirmationsTable)
          .where(and(
            eq(aiceoIntentConfirmationsTable.id, input.intentConfirmationId),
            eq(aiceoIntentConfirmationsTable.projectId, project.id),
          )).limit(1).for("update"))[0];
        if (
          !confirmation
          || confirmation.status !== "CONFIRMED"
          || confirmation.productionAuthority
          || confirmation.continuityRevision !== state.revision
          || confirmation.contextHash !== contextHash
          || confirmation.intentHash !== intentHash
          || confirmation.executionBindingHash !== executionBindingHash
        ) {
          throw new Error("不能：Owner intent confirmation is missing, stale, or bound to different meaning");
        }
      }
      if (understanding.riskLevel === "PROTECTED") {
        throw new Error("不能：Owner intent confirmation cannot replace the independently required Owner Governance Approval");
      }
      const gateEvidence = {
        id: "intent-uncertainty-confirmation-gate",
        version: INTENT_GATE_VERSION,
        certainty: understanding.certainty,
        riskLevel: understanding.riskLevel,
        confirmationRequired,
        confirmationId: confirmation?.id ?? null,
        confirmationIntentHash: confirmation?.intentHash ?? intentHash,
        interpretedIntent: normalize(understanding.interpretedIntent),
        actionTarget: normalize(understanding.actionTarget),
        agentAmbiguityEscalation: "brain_only",
        intentConfirmationIsNotAuthorization: true,
        ownerGovernanceGateStillRequired: false,
        productionAuthority: false,
      };
      const body = {
        ...input,
        projectId: project.id,
        brainActorId: actorId,
        contextHash,
        allowedCapabilities,
        deniedCapabilities,
        authorityBoundaries: {
          ownerSovereignty: true,
          ownerProtectionTriad: true,
          authority: "delegated_technical_authority",
          intentConfirmationIsNotAuthorization: true,
          ownerGovernanceGateStillRequired: false,
          productionAuthority: false,
        },
        frozenRules: [...(input.frozenRules ?? []), gateEvidence],
        escalationConditions: [
          ...(input.escalationConditions ?? []),
          { target: "brain", condition: "semantic_ambiguity" },
        ],
        intentConfirmationId: confirmation?.id ?? null,
        contractVersion: CONTRACT_VERSION,
        productionAuthority: false,
      };
      const contractHash = digest(body);
      const old = (await tx.select().from(aiceoExecutionContractsTable)
        .where(eq(aiceoExecutionContractsTable.idempotencyKey, input.idempotencyKey)).limit(1))[0];
      if (old) {
        if (old.contractHash !== contractHash) throw new Error("不能：contract idempotency conflict");
        return old;
      }
      if (confirmation) {
        const used = (await tx.select().from(aiceoExecutionContractsTable)
          .where(eq(aiceoExecutionContractsTable.intentConfirmationId, confirmation.id)).limit(1))[0];
        const usedByResolution = (await tx.select().from(aiceoAgentRunsTable)
          .where(eq(aiceoAgentRunsTable.intentResolutionConfirmationId, confirmation.id)).limit(1))[0];
        if (used || usedByResolution) {
          throw new Error("不能：Owner intent confirmation is already consumed");
        }
      }
      return (await tx.insert(aiceoExecutionContractsTable).values({
        ...body,
        contractHash,
      }).returning())[0];
    });
  }

  async start(contractId: string, input: any) {
    return this.transact(async (tx) => {
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      const contract = (await tx.select().from(aiceoExecutionContractsTable)
        .where(eq(aiceoExecutionContractsTable.id, contractId)).for("update"))[0];
      const state = (await tx.select().from(aiceoContinuityStateTable).limit(1))[0];
      if (!control || control.killSwitch || !control.queueActive || control.circuitState === "OPEN") {
        throw new Error("不能：control gate closed");
      }
      if (!contract || !state || contract.continuityRevision !== state.revision || input.contextHash !== contract.contextHash) {
        throw new Error("不能：stale contract/context");
      }
      const intentGate = (contract.frozenRules as Record<string, unknown>[]).find(
        (rule) => rule.id === "intent-uncertainty-confirmation-gate",
      );
      if (!intentGate || intentGate.version !== INTENT_GATE_VERSION || intentGate.intentConfirmationIsNotAuthorization !== true) {
        throw new Error("不能：Agent contract lacks the protected Intent Uncertainty Confirmation Gate");
      }
      if (
        contract.allowedCapabilities.some((capability: string) => contract.deniedCapabilities.includes(capability))
        || contract.allowedCapabilities.some(capabilityDenied)
      ) {
        throw new Error("不能：Agent contract contains a denied capability");
      }
      if (input.delegationDepth > contract.maxDelegationDepth || input.inheritedAuthority !== "delegated_technical_authority") {
        throw new Error("不能：delegation authority expansion");
      }
      const old = (await tx.select().from(aiceoAgentRunsTable)
        .where(and(
          eq(aiceoAgentRunsTable.contractId, contractId),
          eq(aiceoAgentRunsTable.idempotencyKey, input.idempotencyKey),
        )).limit(1))[0];
      if (old) return old;
      if (contract.status !== "ISSUED") throw new Error("不能：terminal or active contract replay");
      await tx.update(aiceoExecutionContractsTable).set({ status: "RUNNING" })
        .where(eq(aiceoExecutionContractsTable.id, contract.id));
      return (await tx.insert(aiceoAgentRunsTable).values({
        ...input,
        contractId,
        state: "RUNNING",
        checkpoint: { node: contract.resumeNode, partialSuccess: false },
        observedScope: [],
        deadlineAt: new Date(Date.now() + Number(contract.executionPolicy.timeoutMs)),
      }).returning())[0];
    });
  }

  async checkpoint(runId: string, input: any) {
    return this.transact(async (tx) => {
      const run = (await tx.select().from(aiceoAgentRunsTable)
        .where(eq(aiceoAgentRunsTable.id, runId)).for("update"))[0];
      const contract = run && (await tx.select().from(aiceoExecutionContractsTable)
        .where(eq(aiceoExecutionContractsTable.id, run.contractId)).limit(1))[0];
      if (!run || !contract || run.state !== "RUNNING") throw new Error("不能：active run missing");
      if (
        forbidden(input)
        || input.usedCalls > Number(contract.executionPolicy.maxCalls)
        || input.usedCostMicrousd > Number(contract.executionPolicy.maxCostMicrousd)
        || input.retryCount > Number(contract.executionPolicy.maxRetries)
      ) {
        throw new Error("不能：checkpoint secret, retry, call, or cost budget violation");
      }
      if (!["CLEAR", "AMBIGUOUS"].includes(String(input.understandingStatus))) {
        throw new Error("不能：Agent checkpoint must declare understanding status");
      }
      if (input.understandingStatus === "AMBIGUOUS" && (input.semanticAmbiguity !== true || input.state !== "PAUSED")) {
        throw new Error("不能：Agent semantic ambiguity must pause and escalate to Brain");
      }
      if (input.understandingStatus === "CLEAR" && input.semanticAmbiguity === true) {
        throw new Error("不能：Agent understanding status is contradictory");
      }
      if (["FAILED", "OWNER_GATE"].includes(input.state) && !input.blocker) {
        throw new Error("不能：真实 capability blocker required");
      }
      await tx.update(aiceoAgentRunsTable).set({
        ...input,
        checkpoint: {
          ...input.checkpoint,
          intentResolutionRequired: input.understandingStatus === "AMBIGUOUS",
        },
        updatedAt: new Date(),
        heartbeatAt: new Date(),
      }).where(eq(aiceoAgentRunsTable.id, runId));
      return {
        state: input.state,
        checkpoint: input.checkpoint,
        escalateTo: input.semanticAmbiguity === true ? "brain" : input.state === "OWNER_GATE" ? "owner" : "brain",
        ownerConfirmationRequired: false,
        productionAuthority: false,
      };
    });
  }

  async resume(runId: string, input: any, brainActorId: string) {
    return this.transact(async (tx) => {
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      const run = (await tx.select().from(aiceoAgentRunsTable)
        .where(eq(aiceoAgentRunsTable.id, runId)).for("update"))[0];
      const state = (await tx.select().from(aiceoContinuityStateTable).limit(1))[0];
      const contract = run && (await tx.select().from(aiceoExecutionContractsTable)
        .where(eq(aiceoExecutionContractsTable.id, run.contractId)).limit(1))[0];
      if (!control || control.killSwitch || !control.queueActive || control.circuitState === "OPEN") {
        throw new Error("不能：control gate closed");
      }
      if (
        !run
        || !contract
        || !state
        || run.state !== "PAUSED"
        || input.contextHash !== contract.contextHash
        || contract.continuityRevision !== state.revision
      ) {
        throw new Error("不能：stale or non-resumable checkpoint");
      }
      if ((run.checkpoint as Record<string, unknown>).intentResolutionRequired === true) {
        const resolution = input.brainResolution;
        if (
          !resolution
          || resolution.resolvedByBrain !== true
          || !["HIGH", "UNCERTAIN"].includes(String(resolution.certainty))
          || typeof resolution.interpretedIntent !== "string"
          || !normalize(resolution.interpretedIntent)
          || typeof resolution.actionTarget !== "string"
          || !normalize(resolution.actionTarget)
        ) {
          throw new Error("不能：ambiguous Agent checkpoint requires a bound Brain resolution");
        }
        if (resolution.certainty === "UNCERTAIN") {
          if (typeof resolution.ownerConfirmationId !== "string") {
            throw new Error("不能：Brain remains uncertain and must obtain Owner confirmation");
          }
          const confirmation = (await tx.select().from(aiceoIntentConfirmationsTable)
            .where(eq(aiceoIntentConfirmationsTable.id, resolution.ownerConfirmationId))
            .limit(1).for("update"))[0];
          const executionBindingHash = executionBindingDigest({
            scope: contract.scope,
            objective: contract.objective,
            allowedCapabilities: contract.allowedCapabilities,
            deniedCapabilities: contract.deniedCapabilities,
            completionDefinition: contract.completionDefinition,
          });
          const contractUse = confirmation && (await tx.select().from(aiceoExecutionContractsTable)
            .where(eq(aiceoExecutionContractsTable.intentConfirmationId, confirmation.id)).limit(1))[0];
          const runUse = confirmation && (await tx.select().from(aiceoAgentRunsTable)
            .where(eq(aiceoAgentRunsTable.intentResolutionConfirmationId, confirmation.id)).limit(1))[0];
          if (
            !confirmation
            || confirmation.ownerExpression !== normalize(contract.ownerIntent)
            || confirmation.interpretedIntent !== normalize(resolution.interpretedIntent)
            || confirmation.actionTarget !== normalize(resolution.actionTarget)
            || confirmation.continuityRevision !== state.revision
            || confirmation.contextHash !== contract.contextHash
            || confirmation.executionBindingHash !== executionBindingHash
            || confirmation.productionAuthority
            || contractUse
            || runUse
          ) {
            throw new Error("不能：Brain resolution Owner confirmation is missing, stale, or mismatched");
          }
        }
        await tx.update(aiceoAgentRunsTable).set({
          checkpoint: {
            ...(run.checkpoint as Record<string, unknown>),
            intentResolutionRequired: false,
            brainResolution: {
              resolvedBy: brainActorId.slice(0, 180),
              certainty: resolution.certainty,
              interpretedIntent: normalize(resolution.interpretedIntent),
              actionTarget: normalize(resolution.actionTarget),
              ownerConfirmationId: resolution.ownerConfirmationId ?? null,
            },
          },
          updatedAt: new Date(),
          intentResolutionConfirmationId: resolution.ownerConfirmationId ?? null,
        }).where(eq(aiceoAgentRunsTable.id, runId));
      }
      await tx.update(aiceoAgentRunsTable).set({
        state: "RUNNING",
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(aiceoAgentRunsTable.id, runId));
      return { state: "RUNNING", checkpoint: run.checkpoint, productionAuthority: false };
    });
  }

  async submit(runId: string, input: any) {
    return this.transact(async (tx) => {
      const run = (await tx.select().from(aiceoAgentRunsTable)
        .where(eq(aiceoAgentRunsTable.id, runId)).for("update"))[0];
      const contract = run && (await tx.select().from(aiceoExecutionContractsTable)
        .where(eq(aiceoExecutionContractsTable.id, run.contractId)).limit(1))[0];
      if (!run || !contract) throw new Error("不能：run missing");
      if (
        new Date() > run.deadlineAt
        || input.usedCalls > Number(contract.executionPolicy.maxCalls)
        || input.usedCostMicrousd > Number(contract.executionPolicy.maxCostMicrousd)
      ) {
        throw new Error("不能：timeout, call, or cost budget exceeded");
      }
      if (
        forbidden(input)
        || input.understandingStatus !== "CLEAR"
        || input.observedScope.map(normalizeCapability).some((capability: string) =>
          capabilityDenied(capability) || contract.deniedCapabilities.includes(capability))
        || input.observedScope.map(normalizeCapability).some((capability: string) => !contract.allowedCapabilities.includes(capability))
        || !input.evidence.length
      ) {
        throw new Error("不能：scope drift, secret, or missing evidence");
      }
      await tx.update(aiceoAgentRunsTable).set({
        ...input,
        state: "AWAITING_VERIFICATION",
        updatedAt: new Date(),
      }).where(eq(aiceoAgentRunsTable.id, runId));
      await tx.update(aiceoExecutionContractsTable).set({ status: "AWAITING_VERIFICATION" })
        .where(eq(aiceoExecutionContractsTable.id, contract.id));
      return { state: "AWAITING_VERIFICATION", verified: false, productionAuthority: false };
    });
  }

  async verify(runId: string, input: any, validator: string) {
    return this.transact(async (tx) => {
      const run = (await tx.select().from(aiceoAgentRunsTable)
        .where(eq(aiceoAgentRunsTable.id, runId)).for("update"))[0];
      if (!run || run.agentActorId === validator || run.state !== "AWAITING_VERIFICATION") {
        throw new Error("不能：independent verification required");
      }
      const required = [
        "authority",
        "scope",
        "understanding",
        "intentGate",
        "noDuplicate",
        "noOwnerInterruption",
        "evidence",
      ];
      const compliant = required.every((key) => input.compliance?.[key] === true);
      const passed = input.passed && compliant;
      await tx.insert(aiceoAgentVerificationsTable).values({
        runId,
        validatorActorId: validator,
        passed,
        compliance: input.compliance,
        evidence: input.evidence,
        resultHash: digest(run.result),
        finalStatus: passed ? "VERIFIED" : "REJECTED",
      });
      await tx.update(aiceoAgentRunsTable).set({ state: passed ? "VERIFIED" : "REJECTED" })
        .where(eq(aiceoAgentRunsTable.id, runId));
      await tx.update(aiceoExecutionContractsTable).set({ status: passed ? "VERIFIED" : "REJECTED" })
        .where(eq(aiceoExecutionContractsTable.id, run.contractId));
      if (!passed) {
        await tx.insert(aiceoCollaborationIssuesTable).values({
          projectId: (await tx.select().from(aiceoContinuityProjectsTable).limit(1))[0].id,
          category: "execution_friction",
          summary: "Agent behavioral compliance failure",
          evidence: input.evidence,
          context: { runId, compliance: input.compliance },
          status: "CAPTURED",
          createdBy: validator,
        });
      }
      return { finalStatus: passed ? "VERIFIED" : "REJECTED", productionAuthority: false };
    });
  }
}

export const aiceoAgentExecutionProtocol = new AiceoAgentExecutionProtocol();
import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoContinuityEventsTable,
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
  aiceoCollaborationIssuesTable,
  aiceoCollaborationRulesTable,
  aiceoControlStateTable,
  aiceoIntentConfirmationsTable,
  aiceoPolicyRegistryTable,
  aiceoTasksTable,
  type AiceoContinuityState,
} from "@workspace/db/schema";
import type { AiceoRole } from "./aiceoAuthorization";

const VERSION = "CONTINUITY-001";
const AUTHORITY = "grok_restricted_development";
const CLOSURE_REGRESSION_CHECKS = [
  "api-server:typecheck",
  "test:aiceo-control-plane",
  "test:aiceo-permission-matrix",
  "test:aiceo-governance-root",
  "test:aiceo-continuity-layer",
  "test:aiceo-agent-protocol",
  "test:aiceo-collaboration-loop-integration",
  "test:aiceo-agent-protocol-integration",
  "test:aiceo-closure-integrity",
  "test:aiceo-memory",
  "test:aiceo-memory-integration",
  "test:aiceo-memory-concurrency",
  "test:aiceo-thought-continuity",
  "test:aiceo-thought-concurrency",
  "test:aiceo-layered-self-checks",
  "test:aiceo-preclassification-inbox",
];
const PROTECTED_CURRENT_STATE_FIELDS_EXCLUDED_AT_CLOSURE = new Set([
  "verification",
  "closure",
  "closureIntegrityAudit",
  "closureIntegrityAuditedRevision",
]);
export const INTENT_UNCERTAINTY_CONFIRMATION_RULE = {
  id: "intent-uncertainty-confirmation-gate",
  version: 1,
  classification: "owner_brain_communication_safety",
  rule: "When Owner context, reference, tone, action target, or true intent is not sufficiently certain—especially when two or more reasonable interpretations lead to different actions—the Brain must pause that action, briefly restate its current understanding, and obtain Owner confirmation. Inference is not authorization. Understanding confidence and execution authority remain separate; higher-risk actions require stricter confirmation. Owner Protection, irreversible action, authority change, and Governance Approval gates remain independently mandatory. Clear low-risk language, stable Aliases, and verified expression patterns may be parsed directly. Agents escalate semantic ambiguity to Brain and never guess Owner intent.",
  lowInterruptionPolicy: {
    clearLowRiskLanguage: "direct_parse",
    stableAliases: "direct_parse",
    verifiedExpressionPatterns: "direct_parse",
    singleCaseLongTermInference: "forbidden_without_validation",
  },
  ownerProtectionTriadUnaffected: true,
  confirmationIsAuthorization: false,
  grantsAuthority: false,
  productionAuthority: false,
};
export const BRAIN_AGENT_EXECUTION_RULE = {
  id: "brain-agent-execution-protocol",
  version: 2,
  rule: "Only the Brain resolves Owner intent and issues immutable machine contracts. Agents cannot guess ambiguous Owner intent: semantic ambiguity pauses and escalates to Brain; only if Brain remains uncertain does it ask Owner for the shortest natural confirmation. Agents cannot expand authority, drift scope, reuse stale context, expose secrets, or self-verify; only true Owner Gates reach Owner.",
  scope: "All current and future delegated agents",
};
export const CLOSURE_INTEGRITY_RULE = {
  id: "closure-integrity-audit",
  version: 2,
  classification: "technical_quality_and_collaboration_process",
  rule: "Before any Task or phase may become VERIFIED or CLOSED, perform a mandatory backward integrity audit of dependencies, governing and peer rules, authority changes, Persistent State, Evidence/HMAC, Intent Uncertainty Confirmation Gate, Agent/Contract constraints, safety mechanisms, legacy regressions, Queue and Resume Node. Any conflict, missing evidence, drift, authority anomaly or regression must fail closed with a real blocker and require repair plus re-acceptance.",
  protectedInvariants: {
    foundations: "001-013_frozen",
    ownerSovereignty: true,
    ownerProtectionTriad: [
      "financial_and_physical_assets",
      "legal_liability",
      "aiceo_system_integrity",
    ],
    failClosed: true,
    killSwitchAndCircuitBreaker: "unchanged_and_not_bypassed",
    productionAuthority: false,
  },
  grantsAuthority: false,
};
export const MEMORY_FOUNDATION_RULE = {
  id: "memory-operating-system-foundation",
  version: "G1-001",
  classification: "memory_governance_foundation",
  rule: "Memory records are project-isolated context candidates with explicit layer, cognitive state, truth level, source lineage, temporal validity, lifecycle, and writer authority. Thought Continuity Graph is a core G1-001 contract: immutable non-authoritative candidates preserve the causal chain Motivation, Context, Observation, Interpretation, Belief/Hypothesis, Principle, Decision, Action, Outcome, Reflection, Updated Belief, and Next Decision. Important judgments remain backtraceable to prior context, evidence, intended result, outcome validation, counterfactuals, and superseded thought. Repetition or citation never upgrades thought to fact or rule; reality may contradict and supersede prior thought without rewriting history. Persistent State remains engineering truth. Ordinary agents and external sources cannot establish facts, decisions, rules, governance memory, or authority. Learning Promotion, Retrieval Router, Context Compiler, Agent Memory Distribution, and Temporal Replay are DEFERRED and non-executable in G1-001.",
  persistentStateIsTruth: true,
  candidateOnly: true,
  immutableCandidates: true,
  thoughtContinuityGraphCore: true,
  citationDoesNotUpgradeTruth: true,
  realityMaySupersedeThought: true,
  deferredCapabilities: [
    "retrieval_router", "context_compiler", "agent_memory_distribution",
    "learning_promotion", "temporal_replay",
  ],
  grantsAuthority: false,
  productionAuthority: false,
};
export const LAYERED_SELF_CHECK_RULE = {
  id: "layered-self-check-integrity",
  version: "G1-001-SC-1",
  classification: "cross_cutting_diagnostic_integrity",
  rule: "Every future AICEO critical module or node must expose a lightweight Local Self-Check over input, output, state, permission, evidence, version, freshness, and invariants. Each functional chain must aggregate fresh local summaries into a Chain Health Check that cannot report healthier than its children and must localize fault domains. Global Integrity Check reads health summaries, anomalies, hashes, timestamps, versions, and necessary evidence by default; it may deepen into raw evidence only for an unexplained chain or cross-chain conflict with an explicit reason. Self-checks are immutable diagnostic evidence only: they cannot grant authority, modify governance, promote memory, or count as independent validation. High-risk and critical closure still require an independent Validator and signed Closure Integrity Audit.",
  progressiveEscalation: ["local_low_cost", "related_chain", "global_deep_on_unexplained_or_cross_chain_conflict"],
  defaultGlobalMode: "summary_only",
  selfCheckIsIndependentValidation: false,
  closureStillRequiresIndependentValidator: true,
  grantsAuthority: false,
  productionAuthority: false,
};
export const PRECLASSIFICATION_MEMORY_INBOX_RULE = {
  id: "preclassification-memory-inbox",
  version: "G1-001-INBOX-1",
  classification: "memory_governance_foundation",
  rule: "Before scientific Memory OS classification is complete, Owner-designated high-value ideas may be preserved only as immutable pre-classification, unverified, non-operational candidate records with original semantics, source context, time, provenance hashes, and non-authoritative future destination hints. Inbox records are not facts, decisions, production rules, governance rules, retrieval inputs, or independent validation. Future scientific migration may split one origin into Decision, Knowledge, Experience/Learning, Collaboration, and Project/Roadmap memory only after classification, permission, provenance, epistemic-state, lifecycle, independent-validation, and Owner-approved migration gates are verified. Every formal descendant must retain the origin inbox ID, origin hash, and source/context/time snapshot; the original record remains immutable. No automatic promotion is allowed.",
  migrationAcceptanceRequirements: {
    scientificClassificationRequired: true,
    allowSplitIntoMultipleFormalNodes: true,
    preserveOriginInboxId: true,
    preserveOriginHash: true,
    preserveSourceContextTimeSnapshot: true,
    independentValidationRequired: true,
    ownerApprovedMigrationRequired: true,
    noAutomaticPromotion: true,
  },
  formalDescendantMigrationImplementation: "DEFERRED_BLOCKED_UNTIL_MEMORY_OS_SCIENTIFIC_CLASSIFICATION",
  currentClosureCertifiesMigrationImplementation: false,
  trustedWriterBoundary: "database_owner_and_explicit_migration_only_public_revoked_no_runtime_route",
  operationalInput: false,
  retrievalAuthority: false,
  grantsAuthority: false,
  productionAuthority: false,
};
const PROTECTED_RULE_BASELINES: Record<string, Record<string, unknown>> = {
  "owner-zero-trial-error": {
    id: "owner-zero-trial-error",
    rule: "AICEO completes safely delegable technical work without transferring trial-and-error to the Owner.",
  },
  "capability-binary": {
    id: "capability-binary",
    rule: "能就直接执行；不能就明确说不能，并只说明真实阻塞原因。",
  },
  "owner-only-gates": {
    id: "owner-only-gates",
    rule: "Pause only for identity or credentials, personal Owner Governance Approval, Owner Protection red lines, or genuinely non-delegable human acts.",
  },
  "authority-boundary": {
    id: "authority-boundary",
    rule: "No Production, trading, Databento, Alert, asset, legal, or other new authority.",
  },
  "strict-serial": {
    id: "strict-serial",
    rule: "Only one continuity project may be RUNNING.",
  },
  "continuous-collaboration-improvement-loop": {
    id: "continuous-collaboration-improvement-loop",
    version: 1,
    rule: "Capture evidence-backed collaboration friction, classify root cause, define correct behavior, conflict-check, version ordinary improvements, validate actual improvement, and roll back safely. Owner Protection or authority changes fail closed at OWNER_GATE.",
    scope: "Owner–Brain collaboration",
  },
  "brain-agent-execution-protocol": BRAIN_AGENT_EXECUTION_RULE,
  "intent-uncertainty-confirmation-gate": INTENT_UNCERTAINTY_CONFIRMATION_RULE,
  "closure-integrity-audit": CLOSURE_INTEGRITY_RULE,
  "memory-operating-system-foundation": MEMORY_FOUNDATION_RULE,
  "layered-self-check-integrity": LAYERED_SELF_CHECK_RULE,
  "preclassification-memory-inbox": PRECLASSIFICATION_MEMORY_INBOX_RULE,
};
const PROTECTED_ENTITY_BASELINES: Record<string, Record<string, unknown>> = {
  owner: { id: "owner", type: "human_authority", authority: "ultimate_human_governance_authority" },
  brain: { id: "brain", type: "technical_authority", authority: "maximum_technical_sovereignty_below_owner_red_lines" },
  agent: { id: "agent", type: "delegated_executor", authority: "delegated_technical_authority" },
  "impl-001": { id: "impl-001", type: "governance_root", status: "VERIFIED" },
  "collaboration-loop-001": { id: "collaboration-loop-001", type: "continuous_improvement_loop", status: "ACTIVE", version: "COLLABORATION-LOOP-001" },
  "brain-agent-001": { id: "brain-agent-001", type: "execution_protocol", status: "ACTIVE", version: "BRAIN-AGENT-001" },
  "intent-gate-001": { id: "intent-gate-001", type: "communication_understanding_gate", status: "ACTIVE", version: "INTENT-GATE-001", productionAuthority: false },
};
const MEMORY_ENTITY_IDENTITY = {
  id: "memory-g1-001",
  type: "memory_operating_system_foundation",
  version: "G1-001",
  productionAuthority: false,
};
const PROTECTED_ALIASES: Record<string, unknown> = {
  "AI CEO继续": "resume",
  "AICEO继续": "resume",
  "ai ceo continue": "resume",
  "aiceo continue": "resume",
  Bro: "aiceo_brain_exclusive_alias",
  "Bro，继续": "resume",
};
const RESUME_ALIASES = new Set([
  "ai ceo继续",
  "aiceo继续",
  "ai ceo continue",
  "aiceo continue",
  "bro，继续",
]);
const TRANSITIONS: Record<AiceoContinuityState, AiceoContinuityState[]> = {
  RUNNING: ["PAUSED", "FAILED", "COMPLETED", "OWNER_GATE"],
  PAUSED: ["RUNNING", "FAILED", "COMPLETED", "OWNER_GATE"],
  FAILED: ["RUNNING", "PAUSED", "OWNER_GATE"],
  COMPLETED: [],
  OWNER_GATE: ["RUNNING", "PAUSED", "FAILED", "COMPLETED"],
};

const canonical = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  );
  return value;
};
const evidenceClaimsAuthority = (value: unknown, key = ""): boolean => {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "productionauthority" || normalizedKey === "grantsauthority") return value !== false;
  if (normalizedKey === "authorityunchanged" || normalizedKey === "authoritychanges") return value !== true;
  if (/authority|permission|capability|role/.test(normalizedKey)) return true;
  if (typeof value === "string") {
    return /production_authority|ultimate_human_governance_authority|delegated_technical_authority|grok_restricted_development|authority_assignment/i.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => evidenceClaimsAuthority(item));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([childKey, child]) => evidenceClaimsAuthority(child, childKey));
  }
  return false;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const closureIntentDigest = (input: {
  auditedRevision: number;
  state: string;
  currentState: Record<string, unknown>;
  decisionRuleRegistry: Record<string, unknown>[];
  entityRegistry: Record<string, unknown>[];
  aliasDictionary: Record<string, unknown>;
  historicalEvidence: Record<string, unknown>[];
  resumeNode: Record<string, unknown>;
  failureReason: string | null;
  recoveryStrategy: string | null;
  ownerGateReason: string | null;
}) => hash({
  auditedRevision: input.auditedRevision,
  state: input.state,
  currentState: input.currentState,
  decisionRuleRegistryHash: hash(input.decisionRuleRegistry),
  entityRegistryHash: hash(input.entityRegistry),
  aliasDictionaryHash: hash(input.aliasDictionary),
  historicalEvidenceHashes: input.historicalEvidence.map((pointer) => hash(pointer)).sort(),
  resumeNode: input.resumeNode,
  failureReason: input.failureReason,
  recoveryStrategy: input.recoveryStrategy,
  ownerGateReason: input.ownerGateReason,
});
const signingSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("CONTINUITY-001 signing authority is unavailable");
  return secret;
};
const eventHash = (value: unknown) => createHmac("sha256", signingSecret()).update(JSON.stringify(canonical(value))).digest("hex");

export type ContinuityUpdate = {
  state: AiceoContinuityState;
  currentState: Record<string, unknown>;
  decisionRuleRegistry: Record<string, unknown>[];
  entityRegistry: Record<string, unknown>[];
  aliasDictionary: Record<string, unknown>;
  evidencePointers: Record<string, unknown>[];
  resumeNode: Record<string, unknown>;
  failureReason?: string | null;
  recoveryStrategy?: string | null;
  ownerGateReason?: string | null;
};

export class AiceoContinuityLayer {
  constructor(private readonly database: any = db, private readonly existingTransaction = false) {}

  private transact<T>(work: (tx: any) => Promise<T>): Promise<T> {
    return this.existingTransaction ? work(this.database) : this.database.transaction(work);
  }

  private async project(tx: any) {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1))[0];
    if (!project || project.environment !== "development" || project.authority !== AUTHORITY || project.productionAuthority) {
      throw new Error("CONTINUITY-001 persistent project authority is invalid; fail closed");
    }
    return project;
  }

  async snapshot(role: AiceoRole) {
    const project = await this.project(this.database);
    const state = (await this.database.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1))[0];
    if (!state) throw new Error("CONTINUITY-001 persistent state is missing; cannot resume from memory");
    const events = await this.database.select().from(aiceoContinuityEventsTable)
      .where(eq(aiceoContinuityEventsTable.projectId, project.id))
      .orderBy(desc(aiceoContinuityEventsTable.serverTimestamp), desc(aiceoContinuityEventsTable.id)).limit(100);
    return {
      version: VERSION,
      truthSource: "persistent_state",
      memoryPolicy: "Memory is context, Persistent State is truth",
      role,
      project,
      state,
      events,
      productionAuthority: false,
    };
  }

  async resume(alias: string, role: AiceoRole) {
    const normalized = alias.trim().toLowerCase().replace(/\s+/g, " ");
    if (!RESUME_ALIASES.has(normalized)) throw new Error("不能：未识别恢复别名");
    const snapshot = await this.snapshot(role);
    const state = snapshot.state;
    let directive = "continue";
    let blocker: string | null = null;
    if (state.state === "OWNER_GATE") {
      directive = "owner_action_required";
      blocker = state.ownerGateReason;
    } else if (state.state === "FAILED") {
      directive = state.recoveryStrategy ? "recover" : "blocked";
      blocker = state.failureReason;
    } else if (state.state === "COMPLETED") {
      directive = "completed";
    } else if (state.state === "PAUSED") {
      directive = "resume";
    }
    return { ...snapshot, resume: { directive, blocker, node: state.resumeNode }, productionAuthority: false };
  }

  async update(input: ContinuityUpdate, actorId: string) {
    return this.transact(async (tx) => {
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      if (!control || control.killSwitch || !control.queueActive || control.circuitState === "OPEN") {
        throw new Error("不能：Kill Switch、Queue 或 Circuit gate 阻止 Continuity 状态推进");
      }
      const project = await this.project(tx);
      const current = (await tx.select().from(aiceoContinuityStateTable)
        .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
      if (!current) throw new Error("不能：持久 Continuity 状态不存在");
      const allowedCurrentStateKeys = new Set([
        "activeTask",
        "completedTask",
        "memoryPolicy",
        "strictSerial",
        "implementation",
        "verification",
        "closure",
        "acceptedRevision",
        "closureIntegrityAudit",
        "closureIntegrityAuditedRevision",
      ]);
      if (
        Object.keys(input.currentState).some((key) => !allowedCurrentStateKeys.has(key))
        || input.currentState.memoryPolicy !== "Memory is context, Persistent State is truth"
        || input.currentState.strictSerial !== true
        || !["RUNNING", "COMPLETED"].includes(String(input.currentState.implementation))
        || input.currentState.implementation !== input.state
        || !["PENDING_INDEPENDENT_READ_ONLY_ACCEPTANCE", "NOT_VERIFIED", "VERIFIED"].includes(String(input.currentState.verification))
        || !["BLOCKED", "CLOSED", "undefined"].includes(String(input.currentState.closure))
        || (input.currentState.activeTask != null && typeof input.currentState.activeTask !== "string")
        || (input.currentState.completedTask != null && typeof input.currentState.completedTask !== "string")
        || (input.currentState.acceptedRevision != null && !Number.isInteger(input.currentState.acceptedRevision))
      ) {
        throw new Error("不能：currentState 必须符合受保护机器 schema，不能携带未声明权限或状态字段");
      }
      const allowedResumeNodeKeys = new Set(["node", "action", "status", "ownerGate", "closureIntegrityAudit"]);
      if (
        Object.keys(input.resumeNode).some((key) => !allowedResumeNodeKeys.has(key))
        || typeof input.resumeNode.node !== "string"
        || !input.resumeNode.node.trim()
        || typeof input.resumeNode.action !== "string"
        || typeof input.resumeNode.ownerGate !== "boolean"
        || !["BLOCKED", "CLOSED", "undefined"].includes(String(input.resumeNode.status))
      ) {
        throw new Error("不能：Resume Node 必须符合受保护机器 schema，不能携带未声明权限或状态字段");
      }
      const inputRules = new Map(input.decisionRuleRegistry.map((rule) => [rule.id, rule]));
      const inputEntities = new Map(input.entityRegistry.map((entity) => [entity.id, entity]));
      if (
        inputRules.size !== input.decisionRuleRegistry.length
        || inputEntities.size !== input.entityRegistry.length
        || input.decisionRuleRegistry.some((rule) => typeof rule.id !== "string" || !rule.id.trim())
        || input.entityRegistry.some((entity) => typeof entity.id !== "string" || !entity.id.trim())
      ) {
        throw new Error("不能：Continuity registries require unique, non-empty machine IDs");
      }
      for (const [id, baseline] of Object.entries(PROTECTED_RULE_BASELINES)) {
        if (JSON.stringify(canonical(inputRules.get(id))) !== JSON.stringify(canonical(baseline))) {
          throw new Error(`不能：受保护的机器规则 ${id} 不可删除、改写或绕过`);
        }
      }
      for (const [id, baseline] of Object.entries(PROTECTED_ENTITY_BASELINES)) {
        if (JSON.stringify(canonical(inputEntities.get(id))) !== JSON.stringify(canonical(baseline))) {
          throw new Error(`不能：受保护的治理实体 ${id} 不可删除、改写或绕过`);
        }
      }
      const memoryEntity = inputEntities.get("memory-g1-001");
      const memoryAllowedKeys = new Set(["id", "type", "version", "productionAuthority", "status", "verification", "closure"]);
      const memoryIdentity = memoryEntity && Object.fromEntries(
        Object.keys(MEMORY_ENTITY_IDENTITY).map((key) => [key, memoryEntity[key]]),
      );
      const expectedMemoryStatus = input.currentState.verification === "VERIFIED"
        ? { status: "COMPLETED", verification: "VERIFIED", closure: "CLOSED" }
        : { status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      const starterMemoryStatus = memoryEntity?.status === "NOT_VERIFIED"
        && memoryEntity?.verification === undefined
        && memoryEntity?.closure === "BLOCKED"
        && input.currentState.verification === "NOT_VERIFIED"
        && input.currentState.closure === "BLOCKED";
      if (
        !memoryEntity
        || Object.keys(memoryEntity).some((key) => !memoryAllowedKeys.has(key))
        || JSON.stringify(canonical(memoryIdentity)) !== JSON.stringify(canonical(MEMORY_ENTITY_IDENTITY))
        || (!starterMemoryStatus && (
          memoryEntity.status !== expectedMemoryStatus.status
          || memoryEntity.verification !== expectedMemoryStatus.verification
          || memoryEntity.closure !== expectedMemoryStatus.closure
        ))
      ) {
        throw new Error("不能：memory-g1-001 身份不可改写，且状态必须与受保护 verification/closure 一致");
      }
      const continuityEntity = inputEntities.get("continuity-001");
      const continuityEntityKeys = continuityEntity ? Object.keys(continuityEntity) : [];
      const continuityEntityAllowedKeys = new Set(["id", "type", "status", "verification", "closure"]);
      if (
        !continuityEntity
        || continuityEntity.type !== "implementation"
        || continuityEntityKeys.some((key) => !continuityEntityAllowedKeys.has(key))
        || !["RUNNING", "PAUSED", "FAILED", "COMPLETED", "OWNER_GATE"].includes(String(continuityEntity.status))
        || !["PENDING_INDEPENDENT_READ_ONLY_ACCEPTANCE", "NOT_VERIFIED", "VERIFIED"].includes(String(continuityEntity.verification))
        || !["BLOCKED", "CLOSED", "undefined"].includes(String(continuityEntity.closure))
        || continuityEntity.status !== input.state
        || continuityEntity.verification !== input.currentState.verification
        || String(continuityEntity.closure) !== String(input.currentState.closure)
      ) {
        throw new Error("不能：continuity-001 只能携带受限 implementation 状态字段，不能携带任何权限或能力");
      }
      for (const [alias, target] of Object.entries(PROTECTED_ALIASES)) {
        if (input.aliasDictionary[alias] !== target) throw new Error(`不能：受保护的 Continuity Alias ${alias} 不可改写`);
      }
      for (const rule of input.decisionRuleRegistry) {
        if (!PROTECTED_RULE_BASELINES[rule.id as string]) {
          throw new Error(`不能：未知机器规则 ${String(rule.id)} 未经过代码基线化与 Closure Integrity Audit`);
        }
      }
      for (const entity of input.entityRegistry) {
        if (PROTECTED_ENTITY_BASELINES[entity.id as string] || entity.id === "continuity-001" || entity.id === "memory-g1-001") continue;
        throw new Error(`不能：未知治理实体 ${String(entity.id)} 未经过代码基线化与 Closure Integrity Audit`);
      }
      for (const [alias, target] of Object.entries(input.aliasDictionary)) {
        if (!(alias in PROTECTED_ALIASES) && target !== "resume") {
          throw new Error(`不能：未知 Continuity Alias ${alias} 只能作为无权限恢复别名`);
        }
      }
      const retainedEvidenceOnEveryUpdate = new Set(input.evidencePointers.map((pointer) => hash(pointer)));
      if (current.evidencePointers.some((pointer: Record<string, unknown>) => !retainedEvidenceOnEveryUpdate.has(hash(pointer)))) {
        throw new Error("不能：Continuity evidence is append-only across every revision");
      }
      const existingEvidence = new Set(current.evidencePointers.map((pointer: Record<string, unknown>) => hash(pointer)));
      const invalidNewEvidence = input.evidencePointers
        .filter((pointer) => !existingEvidence.has(hash(pointer)))
        .some((pointer) => evidenceClaimsAuthority(pointer));
      if (invalidNewEvidence) throw new Error("不能：Continuity evidence 不能声明或授予新权限");
      if (input.state !== current.state && !TRANSITIONS[current.state as AiceoContinuityState].includes(input.state)) {
        throw new Error(`不能：非法 Continuity 状态转换 ${current.state}->${input.state}`);
      }
      if (input.state === "FAILED" && !input.failureReason) throw new Error("不能：FAILED 必须记录真实失败原因");
      if (input.state === "OWNER_GATE" && !input.ownerGateReason) throw new Error("不能：OWNER_GATE 必须记录不可代理的 Owner 原因");
      const requestsVerifiedClosure = input.currentState.verification === "VERIFIED"
        || input.currentState.closure === "CLOSED"
        || input.resumeNode.status === "CLOSED";
      if (requestsVerifiedClosure) {
        const rule = current.decisionRuleRegistry.find((candidate: Record<string, unknown>) => candidate.id === "closure-integrity-audit");
        const audit = input.evidencePointers.find((pointer) =>
          pointer.type === "closure_integrity_audit"
          && pointer.auditedRevision === current.revision
          && pointer.result === "VERIFIED");
        const report = audit?.regressionReport as Record<string, unknown> | undefined;
        const reportHmac = audit?.regressionReportHmac;
        const reportCommands = Array.isArray(report?.commands) ? report.commands as Record<string, unknown>[] : [];
        const reportNames = new Set(reportCommands
          .filter((command) => command.exitCode === 0 && /^[a-f0-9]{64}$/.test(String(command.outputSha256)))
          .map((command) => command.name));
        if (
          !rule
          || JSON.stringify(canonical(rule)) !== JSON.stringify(canonical(CLOSURE_INTEGRITY_RULE))
          || !audit
          || !report
          || report.auditedRevision !== current.revision
          || report.allPassed !== true
          || typeof reportHmac !== "string"
          || eventHash(report) !== reportHmac
          || !CLOSURE_REGRESSION_CHECKS.every((name) => reportNames.has(name))
        ) {
          throw new Error("不能：VERIFIED/CLOSED requires a complete Closure Integrity Audit bound to the current revision");
        }
        if (
          input.state !== "COMPLETED"
          || input.currentState.verification !== "VERIFIED"
          || input.currentState.closure !== "CLOSED"
          || input.currentState.closureIntegrityAudit !== "VERIFIED"
          || input.currentState.closureIntegrityAuditedRevision !== current.revision
          || input.resumeNode.status !== "CLOSED"
          || input.resumeNode.ownerGate !== false
          || typeof input.resumeNode.node !== "string"
          || !input.resumeNode.node.trim()
          || input.failureReason != null
          || input.ownerGateReason != null
        ) {
          throw new Error("不能：Closure Integrity Audit detected contradictory closure metadata or Resume Node");
        }
        const expectedClosureIntent = closureIntentDigest({
          auditedRevision: current.revision,
          state: input.state,
          currentState: input.currentState,
          decisionRuleRegistry: input.decisionRuleRegistry,
          entityRegistry: input.entityRegistry,
          aliasDictionary: input.aliasDictionary,
          historicalEvidence: current.evidencePointers,
          resumeNode: input.resumeNode,
          failureReason: input.failureReason ?? null,
          recoveryStrategy: input.recoveryStrategy ?? null,
          ownerGateReason: input.ownerGateReason ?? null,
        });
        if (report.closureIntentHash !== expectedClosureIntent) {
          throw new Error("不能：signed regression evidence is not bound to the complete closure intent");
        }
        const closureEntityIdentity = (entities: Record<string, unknown>[]) => entities.map((entity) =>
          entity.id === "continuity-001" || entity.id === "memory-g1-001"
            ? { id: entity.id, type: entity.type, version: entity.version, productionAuthority: entity.productionAuthority }
            : entity);
        if (
          JSON.stringify(canonical(input.decisionRuleRegistry)) !== JSON.stringify(canonical(current.decisionRuleRegistry))
          || JSON.stringify(canonical(closureEntityIdentity(input.entityRegistry))) !== JSON.stringify(canonical(closureEntityIdentity(current.entityRegistry)))
          || JSON.stringify(canonical(input.aliasDictionary)) !== JSON.stringify(canonical(current.aliasDictionary))
        ) {
          throw new Error("不能：Closure Integrity Audit cannot certify a request that mutates rules, entities, or aliases");
        }
        for (const [key, value] of Object.entries(current.currentState)) {
          if (!PROTECTED_CURRENT_STATE_FIELDS_EXCLUDED_AT_CLOSURE.has(key)
            && JSON.stringify(canonical(input.currentState[key])) !== JSON.stringify(canonical(value))) {
            throw new Error("不能：Closure Integrity Audit detected protected Persistent State mutation");
          }
        }
        const retainedEvidence = new Set(input.evidencePointers.map((pointer) => hash(pointer)));
        if (current.evidencePointers.some((pointer: Record<string, unknown>) => !retainedEvidence.has(hash(pointer)))) {
          throw new Error("不能：Closure Integrity Audit cannot remove or rewrite historical evidence");
        }
        const owner = current.entityRegistry.find((entity: Record<string, unknown>) => entity.id === "owner");
        const brain = current.entityRegistry.find((entity: Record<string, unknown>) => entity.id === "brain");
        const agent = current.entityRegistry.find((entity: Record<string, unknown>) => entity.id === "agent");
        const authorityRule = current.decisionRuleRegistry.find((candidate: Record<string, unknown>) => candidate.id === "authority-boundary");
        const ownerGateRule = current.decisionRuleRegistry.find((candidate: Record<string, unknown>) => candidate.id === "owner-only-gates");
        const agentRule = current.decisionRuleRegistry.find((candidate: Record<string, unknown>) => candidate.id === "brain-agent-execution-protocol");
        const intentGateRule = current.decisionRuleRegistry.find((candidate: Record<string, unknown>) => candidate.id === "intent-uncertainty-confirmation-gate");
        const intentGateEntity = current.entityRegistry.find((entity: Record<string, unknown>) => entity.id === "intent-gate-001");
        const governanceText = JSON.stringify({ authorityRule, ownerGateRule, agentRule }).toLowerCase();
        if (
          owner?.authority !== "ultimate_human_governance_authority"
          || !String(brain?.authority).includes("maximum_technical_sovereignty_below_owner_red_lines")
          || agent?.authority !== "delegated_technical_authority"
          || !["production", "trading", "databento", "alert"].every((term) => governanceText.includes(term))
          || !governanceText.includes("owner")
          || !governanceText.includes("self-verify")
          || JSON.stringify(canonical(intentGateRule)) !== JSON.stringify(canonical(INTENT_UNCERTAINTY_CONFIRMATION_RULE))
          || intentGateEntity?.version !== "INTENT-GATE-001"
          || intentGateEntity?.productionAuthority !== false
        ) {
          throw new Error("不能：Closure Integrity Audit detected governance hierarchy or authority-boundary drift");
        }
        const intentConfirmations = await tx.select().from(aiceoIntentConfirmationsTable)
          .where(eq(aiceoIntentConfirmationsTable.projectId, project.id))
          .orderBy(asc(aiceoIntentConfirmationsTable.createdAt), asc(aiceoIntentConfirmationsTable.id));
        if (
          intentConfirmations.some((confirmation: any) =>
            confirmation.status !== "CONFIRMED"
            || confirmation.productionAuthority
            || !/^[a-f0-9]{64}$/.test(String(confirmation.intentHash))
            || !/^[a-f0-9]{64}$/.test(String(confirmation.contextHash)))
          || report.intentConfirmationsHash !== hash(intentConfirmations)
        ) {
          throw new Error("不能：Closure Integrity Audit detected invalid or unbound Intent Confirmation evidence");
        }
        const foundations = await tx.select().from(aiceoPolicyRegistryTable);
        if (foundations.length !== 13 || foundations.some((foundation: any) => !foundation.frozen)) {
          throw new Error("不能：Closure Integrity Audit detected Foundation 001–013 drift");
        }
        const active = Number((await tx.select({ value: count() }).from(aiceoTasksTable)
          .where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"])))[0].value);
        if (active !== 0 || control.killSwitch || !control.queueActive || control.circuitState !== "CLOSED") {
          throw new Error("不能：Closure Integrity Audit detected Queue or safety-control drift");
        }
        const events = await tx.select().from(aiceoContinuityEventsTable)
          .where(eq(aiceoContinuityEventsTable.projectId, project.id))
          .orderBy(asc(aiceoContinuityEventsTable.serverTimestamp), asc(aiceoContinuityEventsTable.id));
        let previous: string | null = null;
        for (const event of events) {
          if (event.previousHash !== previous) throw new Error("不能：Closure Integrity Audit detected a broken evidence chain");
          const expected = eventHash({
            id: event.id,
            projectId: event.projectId,
            state: event.state,
            actorId: event.actorId,
            eventType: event.eventType,
            payload: event.payload,
            previousHash: event.previousHash,
            serverTimestamp: event.serverTimestamp,
          });
          if (event.eventHash !== expected) throw new Error("不能：Closure Integrity Audit detected invalid HMAC evidence");
          previous = event.eventHash;
        }
      }
      const now = new Date();
      const revision = current.revision + 1;
      const intent = {
        state: input.state,
        currentState: input.currentState,
        decisionRuleRegistry: input.decisionRuleRegistry,
        entityRegistry: input.entityRegistry,
        aliasDictionary: input.aliasDictionary,
        evidencePointers: input.evidencePointers,
        resumeNode: input.resumeNode,
        failureReason: input.failureReason ?? null,
        recoveryStrategy: input.recoveryStrategy ?? null,
        ownerGateReason: input.ownerGateReason ?? null,
        revision,
        productionAuthority: false,
      };
      await tx.update(aiceoContinuityStateTable).set({
        ...intent,
        heartbeatAt: now,
        supervisorVersion: VERSION,
        updatedAt: now,
      }).where(and(eq(aiceoContinuityStateTable.id, current.id), eq(aiceoContinuityStateTable.revision, current.revision)));
      const prior = (await tx.select({ hash: aiceoContinuityEventsTable.eventHash })
        .from(aiceoContinuityEventsTable).orderBy(desc(aiceoContinuityEventsTable.serverTimestamp), desc(aiceoContinuityEventsTable.id)).limit(1))[0];
      const values = {
        id: randomUUID(),
        projectId: project.id,
        state: input.state,
        actorId: actorId.slice(0, 180),
        eventType: "STATE_RECORDED",
        payload: { intentHash: hash(intent), resumeNode: input.resumeNode, revision, supervisorVersion: VERSION, productionAuthority: false },
        previousHash: prior?.hash ?? null,
        serverTimestamp: now,
      };
      const signed = eventHash(values);
      await tx.insert(aiceoContinuityEventsTable).values({ ...values, eventHash: signed });
      return { projectId: project.id, state: input.state, revision, heartbeatAt: now, eventHash: signed, productionAuthority: false };
    });
  }

  async captureIssue(input: {
    category: string;
    summary: string;
    evidence: Record<string, unknown>[];
    context: Record<string, unknown>;
  }, actorId: string) {
    if (!input.evidence.length) throw new Error("不能：合作问题必须包含证据，不能用临时情绪直接生成长期规则");
    return this.transact(async (tx) => {
      const project = await this.project(tx);
      const [issue] = await tx.insert(aiceoCollaborationIssuesTable).values({
        projectId: project.id,
        category: input.category,
        summary: input.summary,
        evidence: input.evidence,
        context: input.context,
        status: "CAPTURED",
        createdBy: actorId.slice(0, 180),
      }).returning();
      return { issue, next: "root_cause_and_desired_behavior", productionAuthority: false };
    });
  }

  async proposeRule(input: {
    issueId: string;
    ruleKey: string;
    ruleText: string;
    source: string;
    reason: string;
    scope: Record<string, unknown>;
    rootCause: string;
    desiredBehavior: string;
    additionalEvidence: Record<string, unknown>[];
    protectedImpacts: string[];
  }, actorId: string) {
    return this.transact(async (tx) => {
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      if (!control || control.killSwitch || !control.queueActive || control.circuitState === "OPEN") {
        throw new Error("不能：安全控制阻止合作规则持久化");
      }
      const project = await this.project(tx);
      const issue = (await tx.select().from(aiceoCollaborationIssuesTable)
        .where(and(eq(aiceoCollaborationIssuesTable.id, input.issueId), eq(aiceoCollaborationIssuesTable.projectId, project.id)))
        .for("update"))[0];
      if (!issue) throw new Error("不能：合作问题证据不存在");
      const evidence = [...issue.evidence, ...input.additionalEvidence];
      if (evidence.length < 2 || !input.rootCause.trim() || !input.desiredBehavior.trim()) {
        throw new Error("不能：至少需要两项证据、根因和正确行为定义，避免偶发事件污染长期规则");
      }
      const protectedTerms = [
        "financial_and_physical_assets", "legal_liability", "aiceo_system_integrity",
        "financial and physical assets", "legal liability", "aiceo system integrity",
        "owner_sovereignty", "owner sovereignty", "governance_authority", "governance authority",
        "production", "trading", "databento", "alert",
      ];
      const candidateText = JSON.stringify({
        ruleText: input.ruleText,
        reason: input.reason,
        scope: input.scope,
        rootCause: input.rootCause,
        desiredBehavior: input.desiredBehavior,
        protectedImpacts: input.protectedImpacts,
      }).toLowerCase();
      const touchesProtection = protectedTerms.some((term) => candidateText.includes(term));
      const classification = touchesProtection ? "owner_protection" : "ordinary_collaboration";
      const status = touchesProtection ? "OWNER_GATE" : "ACTIVE";
      const latest = (await tx.select({ version: max(aiceoCollaborationRulesTable.version) })
        .from(aiceoCollaborationRulesTable)
        .where(and(eq(aiceoCollaborationRulesTable.projectId, project.id), eq(aiceoCollaborationRulesTable.ruleKey, input.ruleKey))))[0];
      const version = Number(latest?.version ?? 0) + 1;
      const prior = version > 1
        ? (await tx.select().from(aiceoCollaborationRulesTable).where(and(
          eq(aiceoCollaborationRulesTable.projectId, project.id),
          eq(aiceoCollaborationRulesTable.ruleKey, input.ruleKey),
          eq(aiceoCollaborationRulesTable.version, version - 1),
        )).limit(1))[0]
        : null;
      if (status === "ACTIVE" && prior?.status === "ACTIVE") {
        await tx.update(aiceoCollaborationRulesTable).set({ status: "IMPROVED" }).where(eq(aiceoCollaborationRulesTable.id, prior.id));
      }
      const conflictCheck = {
        ownerProtectionTriad: touchesProtection ? "OWNER_GATE" : "CLEAR",
        ownerSovereignty: touchesProtection ? "OWNER_GATE" : "CLEAR",
        authorityExpansion: touchesProtection ? "BLOCKED_PENDING_OWNER" : "NONE",
        productionAuthority: false,
      };
      const [rule] = await tx.insert(aiceoCollaborationRulesTable).values({
        projectId: project.id,
        issueId: issue.id,
        ruleKey: input.ruleKey,
        version,
        ruleText: input.ruleText,
        source: input.source,
        reason: input.reason,
        scope: input.scope,
        classification,
        conflictCheck,
        status,
        supersedesRuleId: prior?.id ?? null,
        activatedAt: status === "ACTIVE" ? new Date() : null,
        createdBy: actorId.slice(0, 180),
      }).returning();
      await tx.update(aiceoCollaborationIssuesTable).set({
        evidence,
        rootCause: input.rootCause,
        desiredBehavior: input.desiredBehavior,
        status,
        occurrenceCount: evidence.length,
        lastObservedAt: new Date(),
      }).where(eq(aiceoCollaborationIssuesTable.id, issue.id));
      return {
        rule,
        decision: touchesProtection ? "不能：候选规则触及 Owner-only Gate，必须走 Owner Governance Approval" : "能：普通协作规则已安全版本化并激活",
        requiresOwnerGovernanceApproval: touchesProtection,
        productionAuthority: false,
      };
    });
  }

  async validateRule(ruleId: string, input: { improved: boolean; evidence: Record<string, unknown>[]; summary: string }, actorId: string) {
    if (!input.evidence.length) throw new Error("不能：规则改善验证必须包含实际证据");
    return this.transact(async (tx) => {
      const rule = (await tx.select().from(aiceoCollaborationRulesTable).where(eq(aiceoCollaborationRulesTable.id, ruleId)).for("update"))[0];
      if (!rule || !["ACTIVE", "VALIDATING"].includes(rule.status)) throw new Error("不能：只有已激活的普通协作规则可以验证");
      if (rule.classification !== "ordinary_collaboration") throw new Error("不能：Owner Protection 候选未获个人批准，不能验证或激活");
      const result = { improved: input.improved, evidence: input.evidence, summary: input.summary, validatedBy: actorId.slice(0, 180), validatedAt: new Date().toISOString() };
      await tx.update(aiceoCollaborationRulesTable).set({ status: input.improved ? "IMPROVED" : "ACTIVE", validationResult: result })
        .where(eq(aiceoCollaborationRulesTable.id, rule.id));
      await tx.update(aiceoCollaborationIssuesTable).set({ status: input.improved ? "IMPROVED" : "ACTIVE", lastObservedAt: new Date() })
        .where(eq(aiceoCollaborationIssuesTable.id, rule.issueId));
      return { ruleId, status: input.improved ? "IMPROVED" : "ACTIVE", validationResult: result, productionAuthority: false };
    });
  }

  async rollbackRule(ruleId: string, reason: string, actorId: string) {
    return this.transact(async (tx) => {
      const rule = (await tx.select().from(aiceoCollaborationRulesTable).where(eq(aiceoCollaborationRulesTable.id, ruleId)).for("update"))[0];
      if (!rule || rule.classification !== "ordinary_collaboration" || !["ACTIVE", "IMPROVED"].includes(rule.status)) {
        throw new Error("不能：该规则不能自动回滚；Owner Protection 变更必须走 Owner Governance Approval");
      }
      const latest = (await tx.select({ version: max(aiceoCollaborationRulesTable.version) })
        .from(aiceoCollaborationRulesTable).where(and(
          eq(aiceoCollaborationRulesTable.projectId, rule.projectId),
          eq(aiceoCollaborationRulesTable.ruleKey, rule.ruleKey),
        )))[0];
      const [rollback] = await tx.insert(aiceoCollaborationRulesTable).values({
        projectId: rule.projectId,
        issueId: rule.issueId,
        ruleKey: rule.ruleKey,
        version: Number(latest?.version ?? rule.version) + 1,
        ruleText: `ROLLBACK ${rule.ruleKey} v${rule.version}`,
        source: "validated rollback",
        reason,
        scope: rule.scope,
        classification: "ordinary_collaboration",
        conflictCheck: { rollback: true, ownerProtectionTriad: "CLEAR", productionAuthority: false },
        status: "ACTIVE",
        supersedesRuleId: rule.id,
        rollbackOfRuleId: rule.id,
        createdBy: actorId.slice(0, 180),
        activatedAt: new Date(),
      }).returning();
      await tx.update(aiceoCollaborationRulesTable).set({ status: "ROLLED_BACK", rolledBackAt: new Date() })
        .where(eq(aiceoCollaborationRulesTable.id, rule.id));
      return { rolledBackRuleId: rule.id, rollbackRule: rollback, productionAuthority: false };
    });
  }

  async collaborationLoop() {
    const project = await this.project(this.database);
    const [issues, rules] = await Promise.all([
      this.database.select().from(aiceoCollaborationIssuesTable).where(eq(aiceoCollaborationIssuesTable.projectId, project.id))
        .orderBy(desc(aiceoCollaborationIssuesTable.lastObservedAt)).limit(100),
      this.database.select().from(aiceoCollaborationRulesTable).where(eq(aiceoCollaborationRulesTable.projectId, project.id))
        .orderBy(desc(aiceoCollaborationRulesTable.createdAt)).limit(100),
    ]);
    return { version: "COLLABORATION-LOOP-001", issues, rules, productionAuthority: false };
  }
}

export const aiceoContinuityLayer = new AiceoContinuityLayer();
import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, desc, eq, max } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoContinuityEventsTable,
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
  aiceoCollaborationIssuesTable,
  aiceoCollaborationRulesTable,
  aiceoControlStateTable,
  type AiceoContinuityState,
} from "@workspace/db/schema";
import type { AiceoRole } from "./aiceoAuthorization";

const VERSION = "CONTINUITY-001";
const AUTHORITY = "grok_restricted_development";
const RESUME_ALIASES = new Set(["ai ceo继续", "aiceo继续", "ai ceo continue", "aiceo continue"]);
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
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
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
  private async project(tx: any) {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1))[0];
    if (!project || project.environment !== "development" || project.authority !== AUTHORITY || project.productionAuthority) {
      throw new Error("CONTINUITY-001 persistent project authority is invalid; fail closed");
    }
    return project;
  }

  async snapshot(role: AiceoRole) {
    const project = await this.project(db);
    const state = (await db.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1))[0];
    if (!state) throw new Error("CONTINUITY-001 persistent state is missing; cannot resume from memory");
    const events = await db.select().from(aiceoContinuityEventsTable)
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
    return db.transaction(async (tx) => {
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      if (!control || control.killSwitch || !control.queueActive || control.circuitState === "OPEN") {
        throw new Error("不能：Kill Switch、Queue 或 Circuit gate 阻止 Continuity 状态推进");
      }
      const project = await this.project(tx);
      const current = (await tx.select().from(aiceoContinuityStateTable)
        .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
      if (!current) throw new Error("不能：持久 Continuity 状态不存在");
      if (input.state !== current.state && !TRANSITIONS[current.state as AiceoContinuityState].includes(input.state)) {
        throw new Error(`不能：非法 Continuity 状态转换 ${current.state}->${input.state}`);
      }
      if (input.state === "FAILED" && !input.failureReason) throw new Error("不能：FAILED 必须记录真实失败原因");
      if (input.state === "OWNER_GATE" && !input.ownerGateReason) throw new Error("不能：OWNER_GATE 必须记录不可代理的 Owner 原因");
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
    return db.transaction(async (tx) => {
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
    return db.transaction(async (tx) => {
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
    return db.transaction(async (tx) => {
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
    return db.transaction(async (tx) => {
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
    const project = await this.project(db);
    const [issues, rules] = await Promise.all([
      db.select().from(aiceoCollaborationIssuesTable).where(eq(aiceoCollaborationIssuesTable.projectId, project.id))
        .orderBy(desc(aiceoCollaborationIssuesTable.lastObservedAt)).limit(100),
      db.select().from(aiceoCollaborationRulesTable).where(eq(aiceoCollaborationRulesTable.projectId, project.id))
        .orderBy(desc(aiceoCollaborationRulesTable.createdAt)).limit(100),
    ]);
    return { version: "COLLABORATION-LOOP-001", issues, rules, productionAuthority: false };
  }
}

export const aiceoContinuityLayer = new AiceoContinuityLayer();
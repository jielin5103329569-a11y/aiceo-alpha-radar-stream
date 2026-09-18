import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  aiceoAuditEventsTable,
  aiceoControlStateTable,
  aiceoPolicyRegistryTable,
  aiceoSourceRegistryTable,
  aiceoTasksTable,
  db,
} from "@workspace/db";
import {
  APPROVED_GROK_DEVELOPMENT_ACTIONS,
  executeGrokDevelopmentAttempt,
  type ApprovedGrokDevelopmentAction,
  type GrokAttemptResult,
} from "./grokProviderAdapter";
import {
  assertCredentialPersistenceSafe,
  safeCredentialErrorMessage,
  sanitizeProviderOutputForPersistence,
} from "./aiceoCredentialPersistenceFirewall";
import {
  AICEO_AGENT_AUTHORITY,
  AICEO_BRAIN_AUTHORITY,
  AICEO_GOVERNANCE_ROOT_VERSION,
  AICEO_OWNER_AUTHORITY,
  ownerGovernanceApprovalHash,
  validateGovernanceDeclaration,
  type GovernanceDeclaration,
} from "./aiceoGovernanceRoot";
import type { AiceoRole } from "./aiceoAuthorization";

export const AICEO_STATES = ["QUEUED", "RUNNING", "VALIDATING", "COMPLETED", "FAILED", "UNKNOWN", "STALE", "BLOCKED", "CANCELLED"] as const;
export type AiceoState = (typeof AICEO_STATES)[number];
const INCIDENTS = ["FAILED", "UNKNOWN", "STALE"] as const;
const DENIES = ["shell", "workflow", "network", "tool", "database", "radar", "alpha", "databento", "alerts", "trading", "production", "model-upgrade"];
const FOUNDATION_COUNT = 13;
const FIXED_VERSION = "ARCH-001";
const FIXED_AUTHORITY = "grok_restricted_development";
const TOKEN_USD_RATE = 0.00005;
const MAX_ATTEMPT_TOKENS = 1024;
const FIXED_PERMISSIONS = {
  actions: [...APPROVED_GROK_DEVELOPMENT_ACTIONS],
  resources: ["synthetic", "development-text"],
  explicitDenies: DENIES,
};
const GOVERNANCE_ACCEPTANCE_ACTION = "contract.echo";
const GOVERNANCE_ACCEPTANCE_RESOURCE = "IMPL-001 fixed synthetic governance acceptance evidence; advisory text only; no side effects.";
const GOVERNANCE_ACCEPTANCE_RED_LINES = [
  "financial_and_physical_assets",
  "legal_liability",
  "aiceo_system_integrity",
] as const;
export const allowedAiceoTransition = (from: AiceoState, to: AiceoState, diagnosed = false): boolean => (
  (from === "QUEUED" && ["RUNNING", "CANCELLED"].includes(to))
  || (from === "RUNNING" && ["VALIDATING", "FAILED", "UNKNOWN", "STALE", "CANCELLED"].includes(to))
  || (from === "VALIDATING" && ["FAILED", "UNKNOWN", "STALE", "CANCELLED"].includes(to))
  || (["FAILED", "UNKNOWN", "STALE"].includes(from) && ["BLOCKED", "CANCELLED"].includes(to) && diagnosed)
);
export function classifyAiceoSource(configured: boolean, connected: boolean, tested: boolean): "CONFIGURED" | "CONNECTED" | "TESTED" | "BLOCKED" {
  if (tested) return "TESTED";
  if (connected) return "CONNECTED";
  if (configured) return "CONFIGURED";
  return "BLOCKED";
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function safe(value: unknown, max = 500): string { return String(value).replace(/(?:sk|pk|rk|db)[-_][a-z0-9_-]{12,}/gi, "[redacted]").replace(/[\r\n]/g, " ").slice(0, max); }
function fail(error: unknown): Error { return new Error(safe(error instanceof Error ? error.message : error)); }
function ownerApprovalSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("IMPL-001 Owner approval signing authority is unavailable");
  return secret;
}
function expectedContractHash(): string {
  return digest({ authority: FIXED_AUTHORITY, version: FIXED_VERSION, actions: APPROVED_GROK_DEVELOPMENT_ACTIONS });
}
function taskIntent(task: {
  action: string;
  resource: string;
  permissions: unknown;
  sourceId: string | null;
  policyId: string | null;
  contractVersion: string;
  contractHash: string;
  environment: string;
  authority: string;
  budget: unknown;
  timeoutMs: number;
  maxRetries: number;
}) {
  return {
    action: task.action,
    resource: task.resource,
    permissions: task.permissions,
    sourceId: task.sourceId,
    policyId: task.policyId,
    contractVersion: task.contractVersion,
    contractHash: task.contractHash,
    environment: task.environment,
    authority: task.authority,
    budget: task.budget,
    timeoutMs: task.timeoutMs,
    maxRetries: task.maxRetries,
  };
}
function isGovernanceAcceptanceTask(task: typeof aiceoTasksTable.$inferSelect): boolean {
  return task.action === GOVERNANCE_ACCEPTANCE_ACTION
    && task.resource === GOVERNANCE_ACCEPTANCE_RESOURCE
    && task.environment === "development"
    && task.authority === FIXED_AUTHORITY
    && task.contractVersion === FIXED_VERSION
    && task.contractHash === expectedContractHash()
    && digest(task.permissions) === digest(FIXED_PERMISSIONS)
    && task.governanceClassification === "owner_protection"
    && task.ownerProtectionRedLines.length === GOVERNANCE_ACCEPTANCE_RED_LINES.length
    && GOVERNANCE_ACCEPTANCE_RED_LINES.every((redLine) => task.ownerProtectionRedLines.includes(redLine))
    && task.timeoutMs === 10_000
    && task.maxRetries === 0
    && Number(task.budget.estimatedTokens) === MAX_ATTEMPT_TOKENS
    && Number(task.budget.estimatedCalls) === 1
    && Number(task.budget.estimatedUsd) === Number((MAX_ATTEMPT_TOKENS * TOKEN_USD_RATE).toFixed(6));
}
function auditHash(input: {
  id: string;
  serverTimestamp: Date;
  correlationId: string;
  taskId: string | null;
  runId: string | null;
  eventType: string;
  state: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  previousHash: string | null;
}): string {
  return createHmac("sha256", ownerApprovalSecret()).update(JSON.stringify(canonical(input))).digest("hex");
}
function auditHashIsValid(event: typeof aiceoAuditEventsTable.$inferSelect): boolean {
  return event.eventHash === auditHash({
    id: event.id,
    serverTimestamp: event.serverTimestamp,
    correlationId: event.correlationId,
    taskId: event.taskId,
    runId: event.runId,
    eventType: event.eventType,
    state: event.state,
    actorId: event.actorId,
    payload: event.payload,
    previousHash: event.previousHash,
  });
}

export async function assertAiceoTaskGovernanceAuthorized(
  tx: any,
  task: typeof aiceoTasksTable.$inferSelect,
): Promise<void> {
  if (task.governanceClassification === "owner_protection") {
    if (!isGovernanceAcceptanceTask(task)) throw new Error("IMPL-001 fixed governance acceptance intent is required");
    if (!task.ownerProtectionRedLines.length || !task.ownerGovernanceApprovedAt || !task.ownerGovernanceApprovedBy || !task.ownerGovernanceApprovalHash) {
      throw new Error("IMPL-001 independent Owner Governance Approval is required");
    }
    const submissions = await tx.select().from(aiceoAuditEventsTable).where(and(
      eq(aiceoAuditEventsTable.taskId, task.id),
      eq(aiceoAuditEventsTable.eventType, "SUBMITTED"),
    ));
    const submitted = submissions[0];
    if (
      submissions.length !== 1
      || !submitted
      || !auditHashIsValid(submitted)
      || submitted.payload.taskIntentHash !== digest(taskIntent(task))
      || submitted.actorId === task.ownerGovernanceApprovedBy
    ) throw new Error("IMPL-001 submission audit provenance is invalid; execution fails closed");
    const expectedHash = ownerGovernanceApprovalHash({
      taskId: task.id,
      taskIntent: taskIntent(task),
      classification: "owner_protection",
      redLines: task.ownerProtectionRedLines,
      submission: { eventId: submitted.id, eventHash: submitted.eventHash, actorId: submitted.actorId ?? "" },
      ownerId: task.ownerGovernanceApprovedBy,
      approvedAt: task.ownerGovernanceApprovedAt,
    }, ownerApprovalSecret());
    if (expectedHash !== task.ownerGovernanceApprovalHash) {
      throw new Error("IMPL-001 Owner Governance Approval integrity conflict; execution fails closed");
    }
    const approvalEvents = await tx.select().from(aiceoAuditEventsTable).where(and(
      eq(aiceoAuditEventsTable.taskId, task.id),
      eq(aiceoAuditEventsTable.eventType, "OWNER_GOVERNANCE_APPROVED"),
    ));
    if (
      approvalEvents.length !== 1
      || !auditHashIsValid(approvalEvents[0])
      || approvalEvents[0].actorId !== task.ownerGovernanceApprovedBy
      || approvalEvents[0].payload.approvalHash !== task.ownerGovernanceApprovalHash
    ) throw new Error("IMPL-001 Owner Governance Approval audit provenance is missing; execution fails closed");
  } else if (
    task.governanceClassification !== "ordinary_technical"
    || task.ownerProtectionRedLines.length
    || task.ownerGovernanceApprovedAt
    || task.ownerGovernanceApprovedBy
    || task.ownerGovernanceApprovalHash
  ) {
    throw new Error("IMPL-001 governance classification or authority conflict; execution fails closed");
  }
}

/** PostgreSQL is the sole state authority; this class intentionally has no process-owned state. */
export class AiceoControlPlane {
  async selfCheck() {
    const [source, policies, controls] = await Promise.all([
      db.select().from(aiceoSourceRegistryTable).where(eq(aiceoSourceRegistryTable.catalogId, "connector_catalog:xai")),
      db.select({ id: aiceoPolicyRegistryTable.foundationId, version: aiceoPolicyRegistryTable.version, policyHash: aiceoPolicyRegistryTable.policyHash, frozen: aiceoPolicyRegistryTable.frozen }).from(aiceoPolicyRegistryTable).orderBy(asc(aiceoPolicyRegistryTable.foundationId)),
      db.select({ id: aiceoControlStateTable.id }).from(aiceoControlStateTable).limit(1),
    ]);
    const exactIds = policies.length === FOUNDATION_COUNT && new Set(policies.map((p) => p.id)).size === FOUNDATION_COUNT && policies.every((p, i) => p.id === String(i + 1).padStart(3, "0") && p.frozen && p.version.trim() && p.policyHash.trim());
    const gaps = [
      ...(source[0]?.configured ? [] : ["xAI/Grok credentials are not configured; secrets are never accessed or stored"]),
      ...(source[0]?.connected ? [] : ["provider connection has not been tested"]),
      ...(source[0]?.tested ? [] : ["provider self-test has not run"]),
      ...(exactIds ? [] : ["Foundation 001-013 frozen policy set is incomplete or invalid"]),
      ...(controls.length === 1 ? [] : ["durable control singleton is missing"]),
    ];
    const sourceState = source[0] ? classifyAiceoSource(source[0].configured, source[0].connected, source[0].tested) : "BLOCKED";
    return { source: source[0] ?? null, foundations: policies, state: gaps.length ? "BLOCKED" : sourceState, gaps: [...gaps, "production environment is disabled (safety note)"], authority: FIXED_AUTHORITY };
  }

  async status() {
    await this.reconcileExpiredAttempts("aiceo:lifecycle-status");
    const [control, active, incidents] = await Promise.all([
      db.select().from(aiceoControlStateTable).limit(1),
      db.select().from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"])),
      db.select({ id: aiceoTasksTable.id, state: aiceoTasksTable.state }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, INCIDENTS)),
    ]);
    const row = control[0];
    if (!row) throw new Error("AICEO durable control row is missing");
    return { queueActive: row.queueActive, killSwitch: row.killSwitch, circuit: { state: row.circuitState, failureCount: row.circuitFailureCount, threshold: row.circuitThreshold, cooldownMs: row.circuitCooldownMs }, activeTask: active[0] ?? null, unresolvedIncidents: incidents, degraded: false };
  }

  async history(limit = 100) { return db.select().from(aiceoAuditEventsTable).orderBy(desc(aiceoAuditEventsTable.serverTimestamp), desc(aiceoAuditEventsTable.id)).limit(Math.min(Math.max(limit, 1), 100)); }

  private async audit(tx: any, input: { taskId?: string; correlationId: string; runId?: string; type: string; state?: AiceoState; actorId: string; details?: Record<string, unknown> }) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('aiceo:audit-events'))`);
    const prior = await tx.select({
      hash: aiceoAuditEventsTable.eventHash,
      appendSequence: aiceoAuditEventsTable.appendSequence,
    }).from(aiceoAuditEventsTable).orderBy(desc(aiceoAuditEventsTable.appendSequence)).limit(1);
    const appendSequence = Number(prior[0]?.appendSequence ?? 0) + 1;
    const id = randomUUID();
    const serverTimestamp = new Date();
    const actorId = safe(input.actorId, 180);
    const payload = { ...input.details, actorId, type: input.type, state: input.state ?? null, integrityVersion: "hmac-sha256-v1" };
    assertCredentialPersistenceSafe(payload, "audit-event");
    const values = { id, taskId: input.taskId ?? null, correlationId: input.correlationId, runId: input.runId ?? null, eventType: input.type, state: input.state ?? null, actorId, payload, previousHash: prior[0]?.hash ?? null, serverTimestamp };
    const eventHash = auditHash({ ...values, eventType: input.type });
    const [event] = await tx.insert(aiceoAuditEventsTable).values({ ...values, appendSequence, eventHash }).returning();
    return event;
  }

  private async auditRejection(input: { taskId?: string; correlationId?: string; type: string; actorId: string; error: unknown }) {
    await db.transaction(async (tx) => {
      const task = input.taskId
        ? (await tx.select().from(aiceoTasksTable).where(eq(aiceoTasksTable.id, input.taskId)).limit(1))[0]
        : null;
      await this.audit(tx, {
        taskId: task?.id,
        correlationId: task?.correlationId ?? input.correlationId ?? randomUUID(),
        runId: task?.runId ?? undefined,
        type: input.type,
        state: task?.state as AiceoState | undefined,
        actorId: input.actorId,
        details: { reason: safeCredentialErrorMessage(input.error), failClosed: true, productionAuthority: false },
      });
    });
  }

  async rejectSubmission(actorId: string, error: unknown) {
    await this.auditRejection({ type: "SUBMISSION_REJECTED", actorId, error });
  }

  async rejectAccess(actorId: string, requiredRole: string, error: unknown) {
    await this.auditRejection({
      type: "ACCESS_REJECTED",
      actorId,
      error: `${safe(error)} Required role: ${safe(requiredRole)}.`,
    });
  }

  async createGovernanceAcceptanceTask(actorId: string) {
    return this.submit({
      action: GOVERNANCE_ACCEPTANCE_ACTION,
      resource: GOVERNANCE_ACCEPTANCE_RESOURCE,
      governance: {
        classification: "owner_protection",
        redLines: [...GOVERNANCE_ACCEPTANCE_RED_LINES],
      },
      environment: "development",
      budget: {
        estimatedTokens: MAX_ATTEMPT_TOKENS,
        estimatedCalls: 1,
        estimatedUsd: Number((MAX_ATTEMPT_TOKENS * TOKEN_USD_RATE).toFixed(6)),
      },
      timeoutMs: 10_000,
      maxRetries: 0,
    }, actorId, "governance_acceptance");
  }

  async governanceAcceptance(role: AiceoRole) {
    const tasks = await db.select().from(aiceoTasksTable)
      .where(eq(aiceoTasksTable.governanceClassification, "owner_protection"))
      .orderBy(desc(aiceoTasksTable.createdAt));
    const acceptanceTasks = tasks.filter(isGovernanceAcceptanceTask).slice(0, 20);
    const taskIds = acceptanceTasks.map((task) => task.id);
    const events = taskIds.length
      ? await db.select().from(aiceoAuditEventsTable)
        .where(inArray(aiceoAuditEventsTable.taskId, taskIds))
        .orderBy(desc(aiceoAuditEventsTable.serverTimestamp), desc(aiceoAuditEventsTable.id))
      : [];
    return {
      governanceRootVersion: AICEO_GOVERNANCE_ROOT_VERSION,
      role,
      ownerAuthority: AICEO_OWNER_AUTHORITY,
      brainAuthority: AICEO_BRAIN_AUTHORITY,
      agentAuthority: AICEO_AGENT_AUTHORITY,
      productionAuthority: false,
      tasks: acceptanceTasks.map((task) => ({
        id: task.id,
        state: task.state,
        action: task.action,
        resource: task.resource,
        permissions: task.permissions,
        contractVersion: task.contractVersion,
        contractHash: task.contractHash,
        environment: task.environment,
        authority: task.authority,
        governanceClassification: task.governanceClassification,
        ownerProtectionRedLines: task.ownerProtectionRedLines,
        ownerGovernanceApprovedAt: task.ownerGovernanceApprovedAt,
        ownerGovernanceApprovedBy: task.ownerGovernanceApprovedBy,
        ownerGovernanceApprovalHash: task.ownerGovernanceApprovalHash,
        createdAt: task.createdAt,
        events: events.filter((event) => event.taskId === task.id).map((event) => ({
          id: event.id,
          eventType: event.eventType,
          actorId: event.actorId,
          eventHash: event.eventHash,
          previousHash: event.previousHash,
          serverTimestamp: event.serverTimestamp,
          payload: event.payload,
        })),
      })),
    };
  }

  async submit(input: { action: string; resource: string; governance?: GovernanceDeclaration; environment?: "development" | "staging" | "production"; budget?: { estimatedTokens?: number; estimatedCalls?: number; estimatedUsd?: number }; timeoutMs?: number; maxRetries?: number; clientTimestamp?: string }, actorId: string, submissionMode: "generic" | "governance_acceptance" = "generic") {
    try {
      assertCredentialPersistenceSafe({ input, actorId }, "grok-task-submit");
      return await db.transaction(async (tx) => {
      const source = (await tx.select().from(aiceoSourceRegistryTable).where(eq(aiceoSourceRegistryTable.catalogId, "connector_catalog:xai")))[0];
      const policies = await tx.select().from(aiceoPolicyRegistryTable);
      const environment = input.environment ?? "development";
      const text = `${input.action} ${input.resource}`.toLowerCase();
      const governance = validateGovernanceDeclaration(input.governance, input.action, input.resource);
      const requestsAcceptanceIdentity = input.action === GOVERNANCE_ACCEPTANCE_ACTION
        && input.resource === GOVERNANCE_ACCEPTANCE_RESOURCE
        && governance.classification === "owner_protection"
        && governance.redLines.length === GOVERNANCE_ACCEPTANCE_RED_LINES.length
        && GOVERNANCE_ACCEPTANCE_RED_LINES.every((redLine) => governance.redLines.includes(redLine));
      if (submissionMode === "generic" && requestsAcceptanceIdentity) {
        throw new Error("IMPL-001 fixed governance acceptance tasks may only be created by the dedicated server-owned route");
      }
      if (submissionMode === "governance_acceptance" && !requestsAcceptanceIdentity) {
        throw new Error("IMPL-001 governance acceptance fingerprint mismatch");
      }
      if (!source || policies.length !== FOUNDATION_COUNT) throw new Error("ARCH-001 source or frozen policy registry is incomplete");
      if (!source.tested || environment !== "development" || !APPROVED_GROK_DEVELOPMENT_ACTIONS.includes(input.action as ApprovedGrokDevelopmentAction) || DENIES.some((item) => text.includes(item))) throw new Error("ARCH-001 permission denied");
      const maxRetries = Math.min(input.maxRetries ?? 1, 2);
      const defaultTokens = MAX_ATTEMPT_TOKENS * (maxRetries + 1);
      const requiredCalls = maxRetries + 1;
      const requiredUsd = Number((defaultTokens * TOKEN_USD_RATE).toFixed(6));
      const estimatedTokens = input.budget?.estimatedTokens ?? defaultTokens, estimatedCalls = input.budget?.estimatedCalls ?? requiredCalls, estimatedUsd = input.budget?.estimatedUsd ?? requiredUsd;
      if (estimatedTokens < defaultTokens || estimatedCalls < requiredCalls || estimatedUsd < requiredUsd) throw new Error("ARCH-001 reservation must cover the maximum usage of all attempts");
      if (estimatedTokens > 4096 || estimatedCalls > 4 || estimatedUsd > 0.25) throw new Error("ARCH-001 per-task development budget exceeded");
      const totals = await tx.select({ budget: aiceoTasksTable.budget }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, ["QUEUED", "RUNNING", "VALIDATING"]));
      const totalTokens = totals.reduce((sum, item) => sum + Number(item.budget.reservedTokens ?? 0), 0);
      if (totalTokens + estimatedTokens > 8192) throw new Error("ARCH-001 aggregate token budget exceeded");
      const id = randomUUID(), correlationId = randomUUID(), timestamp = new Date();
      const task = { id, correlationId, runId: null, sourceId: source.id, policyId: policies[0].id, state: "QUEUED" as const, action: safe(input.action, 120), resource: safe(input.resource, 180), permissions: FIXED_PERMISSIONS, contractVersion: FIXED_VERSION, contractHash: expectedContractHash(), environment, authority: FIXED_AUTHORITY, governanceClassification: governance.classification, ownerProtectionRedLines: governance.redLines, ownerGovernanceApprovedAt: null, ownerGovernanceApprovedBy: null, ownerGovernanceApprovalHash: null, evidence: null, budget: { estimatedTokens, reservedTokens: 0, actualTokens: 0, estimatedCalls, reservedCalls: 0, actualCalls: 0, estimatedUsd: String(estimatedUsd), reservedUsd: "0", actualUsd: "0" }, timeoutMs: Math.min(input.timeoutMs ?? 10_000, 30_000), maxRetries, retryCount: 0, serverTimestamp: timestamp, clientTimestamp: input.clientTimestamp ? new Date(input.clientTimestamp) : null, createdAt: timestamp, updatedAt: timestamp };
      await tx.insert(aiceoTasksTable).values(task);
      await this.audit(tx, { taskId: id, correlationId, type: "SUBMITTED", state: "QUEUED", actorId, details: { action: task.action, resource: task.resource, taskIntentHash: digest(taskIntent(task)), governanceRootVersion: AICEO_GOVERNANCE_ROOT_VERSION, governanceClassification: governance.classification, ownerProtectionRedLines: governance.redLines, ownerAuthority: AICEO_OWNER_AUTHORITY, brainAuthority: AICEO_BRAIN_AUTHORITY, agentAuthority: AICEO_AGENT_AUTHORITY, productionAuthority: false } });
      return task;
      });
    } catch (error) {
      await this.auditRejection({ type: "SUBMISSION_REJECTED", actorId, error });
      throw fail(error);
    }
  }

  async approveOwnerGovernance(id: string, ownerId: string) {
    return db.transaction(async (tx) => {
      const task = (await tx.select().from(aiceoTasksTable).where(eq(aiceoTasksTable.id, id)).for("update"))[0];
      if (!task || task.state !== "QUEUED") throw new Error("IMPL-001 Owner Governance Approval applies only to a queued task");
      if (!isGovernanceAcceptanceTask(task)) throw new Error("IMPL-001 only the fixed governance acceptance task may use this approval path");
      if (task.governanceClassification !== "owner_protection" || !task.ownerProtectionRedLines.length) {
        throw new Error("IMPL-001 ordinary tasks cannot acquire or inherit Owner Governance Approval");
      }
      if (task.ownerGovernanceApprovedAt || task.ownerGovernanceApprovedBy || task.ownerGovernanceApprovalHash) {
        throw new Error("IMPL-001 Owner Governance Approval is immutable and cannot be replaced");
      }
      const submissions = await tx.select().from(aiceoAuditEventsTable)
        .where(and(eq(aiceoAuditEventsTable.taskId, id), eq(aiceoAuditEventsTable.eventType, "SUBMITTED")));
      const submitted = submissions[0];
      if (
        submissions.length !== 1
        || !submitted
        || !auditHashIsValid(submitted)
        || submitted.payload.taskIntentHash !== digest(taskIntent(task))
        || submitted.actorId === safe(ownerId, 180)
      ) {
        throw new Error("IMPL-001 independent Owner Governance Approval cannot be self-approved");
      }
      const approvedAt = new Date();
      const approvalHash = ownerGovernanceApprovalHash({
        taskId: task.id,
        taskIntent: taskIntent(task),
        classification: "owner_protection",
        redLines: task.ownerProtectionRedLines,
        submission: { eventId: submitted.id, eventHash: submitted.eventHash, actorId: submitted.actorId ?? "" },
        ownerId: safe(ownerId, 180),
        approvedAt,
      }, ownerApprovalSecret());
      await tx.update(aiceoTasksTable).set({
        ownerGovernanceApprovedAt: approvedAt,
        ownerGovernanceApprovedBy: safe(ownerId, 180),
        ownerGovernanceApprovalHash: approvalHash,
        updatedAt: approvedAt,
      }).where(eq(aiceoTasksTable.id, id));
      const auditEvent = await this.audit(tx, { taskId: id, correlationId: task.correlationId, type: "OWNER_GOVERNANCE_APPROVED", state: "QUEUED", actorId: ownerId, details: { governanceRootVersion: AICEO_GOVERNANCE_ROOT_VERSION, redLines: task.ownerProtectionRedLines, approvalHash, productionAuthority: false } });
      return {
        taskId: id,
        approvedAt,
        approvedBy: safe(ownerId, 180),
        approvalHash,
        redLines: task.ownerProtectionRedLines,
        auditEvent: {
          id: auditEvent.id,
          eventType: auditEvent.eventType,
          eventHash: auditEvent.eventHash,
          previousHash: auditEvent.previousHash,
          serverTimestamp: auditEvent.serverTimestamp,
        },
        productionAuthority: false,
      };
    }).catch(async (error) => {
      await this.auditRejection({ taskId: id, type: "OWNER_GOVERNANCE_APPROVAL_REJECTED", actorId: ownerId, error });
      throw fail(error);
    });
  }

  private async claimAttempt(id: string, actorId: string, allowQueuedStart = false) {
    return db.transaction(async (tx) => {
      let task = (await tx.select().from(aiceoTasksTable).where(eq(aiceoTasksTable.id, id)).for("update"))[0];
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      const source = (await tx.select().from(aiceoSourceRegistryTable).where(eq(aiceoSourceRegistryTable.catalogId, "connector_catalog:xai")))[0];
      if (!task) throw new Error("Task not found");
      if (!control || !control.queueActive || control.killSwitch || control.circuitState === "OPEN") throw new Error("ARCH-001 provider gate is closed");
      if (!source?.tested || !source.model) throw new Error("ARCH-001 verified Grok source is unavailable");
      if (task.environment !== "development" || task.authority !== FIXED_AUTHORITY || !APPROVED_GROK_DEVELOPMENT_ACTIONS.includes(task.action as ApprovedGrokDevelopmentAction)) throw new Error("ARCH-001 execution authority denied");
      await assertAiceoTaskGovernanceAuthorized(tx, task);
      if (allowQueuedStart && task.state !== "QUEUED") throw new Error("ARCH-001 task has already started");
      if (task.state === "QUEUED" && allowQueuedStart) {
        const submitted = (await tx.select({ actorId: aiceoAuditEventsTable.actorId }).from(aiceoAuditEventsTable).where(and(eq(aiceoAuditEventsTable.taskId, id), eq(aiceoAuditEventsTable.eventType, "SUBMITTED"))).limit(1))[0];
        if (submitted?.actorId !== safe(actorId, 180)) throw new Error("Only the submitting user may approve this queued development task");
        const incidents = await tx.select({ id: aiceoTasksTable.id }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, INCIDENTS));
        if (incidents.length) throw new Error("ARCH-001 unresolved incident blocks execution");
        const active = await tx.select({ budget: aiceoTasksTable.budget }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"]));
        const sums = active.reduce((total, row) => ({ tokens: total.tokens + Number(row.budget.reservedTokens ?? 0), calls: total.calls + Number(row.budget.reservedCalls ?? 0), usd: total.usd + Number(row.budget.reservedUsd ?? 0) }), { tokens: 0, calls: 0, usd: 0 });
        if (sums.tokens + Number(task.budget.estimatedTokens) > control.aggregateTokenCap || sums.calls + Number(task.budget.estimatedCalls) > control.aggregateCallCap || sums.usd + Number(task.budget.estimatedUsd) > Number(control.aggregateUsdCap)) throw new Error("ARCH-001 aggregate reservation budget exceeded");
        const runId = randomUUID();
        const budget = { ...task.budget, reservedTokens: task.budget.estimatedTokens, reservedCalls: task.budget.estimatedCalls, reservedUsd: task.budget.estimatedUsd };
        await this.audit(tx, { taskId: id, correlationId: task.correlationId, type: "APPROVED", state: "QUEUED", actorId, details: { environment: task.environment, authority: task.authority } });
        await this.audit(tx, { taskId: id, correlationId: task.correlationId, runId, type: "STARTED", state: "RUNNING", actorId });
        task = { ...task, state: "RUNNING", runId, budget };
      }
      if (task.state !== "RUNNING" || !task.runId) throw new Error("Only a durable RUNNING task may call Grok");
      if (!allowQueuedStart) {
        const started = (await tx.select({ actorId: aiceoAuditEventsTable.actorId }).from(aiceoAuditEventsTable).where(and(eq(aiceoAuditEventsTable.taskId, id), eq(aiceoAuditEventsTable.eventType, "STARTED"))).limit(1))[0];
        if (started?.actorId !== safe(actorId, 180)) throw new Error("Only the durable executor may continue retries");
        if (!task.nextRetryAt || task.nextRetryAt > new Date()) throw new Error("Durable retry is not eligible yet");
      }
      if (task.providerAttemptId || task.providerAttemptDeadlineAt) throw new Error("A provider attempt is already claimed");
      const actualCalls = Number(task.budget.actualCalls) + 1;
      const maximumTokensAfterAttempt = Number(task.budget.actualTokens) + MAX_ATTEMPT_TOKENS;
      const maximumUsdAfterAttempt = maximumTokensAfterAttempt * TOKEN_USD_RATE;
      if (actualCalls > Number(task.budget.reservedCalls) || maximumTokensAfterAttempt > Number(task.budget.reservedTokens) || maximumUsdAfterAttempt > Number(task.budget.reservedUsd)) throw new Error("ARCH-001 remaining reservation cannot cover another provider attempt");
      const attemptId = randomUUID();
      const budget = { ...task.budget, actualCalls };
      const attemptDeadline = new Date(Date.now() + task.timeoutMs + 5_000);
      await tx.update(aiceoTasksTable).set({ state: "RUNNING", runId: task.runId, budget, nextRetryAt: null, providerAttemptId: attemptId, providerAttemptDeadlineAt: attemptDeadline, updatedAt: new Date() }).where(eq(aiceoTasksTable.id, id));
      await this.audit(tx, { taskId: id, correlationId: task.correlationId, runId: task.runId, type: "PROVIDER_ATTEMPT_STARTED", state: "RUNNING", actorId, details: { attemptId, attempt: actualCalls, maximumTokens: MAX_ATTEMPT_TOKENS, attemptDeadline: attemptDeadline.toISOString(), modelAuthority: "registry" } });
      return { task: { ...task, budget }, model: source.model, attemptId, actualCalls };
    });
  }

  async reconcileExpiredAttempts(actorId: string) {
    return db.transaction(async (tx) => {
      const expired = await tx.select().from(aiceoTasksTable).where(and(eq(aiceoTasksTable.state, "RUNNING"), sql`(
        (${aiceoTasksTable.providerAttemptId} is not null and ${aiceoTasksTable.providerAttemptDeadlineAt} <= now())
        or
        (${aiceoTasksTable.providerAttemptId} is null and ${aiceoTasksTable.nextRetryAt} is not null and ${aiceoTasksTable.nextRetryAt} + interval '30 seconds' <= now())
      )`)).for("update");
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      if (!control) throw new Error("AICEO control row is missing");
      for (const task of expired) {
        const evidence = { reason: task.providerAttemptId ? "Durably claimed provider attempt exceeded its recovery deadline" : "Durable retry handoff expired before the next attempt was claimed", settled: false, productionAuthority: false };
        await tx.update(aiceoTasksTable).set({ state: "UNKNOWN", evidence, nextRetryAt: null, providerAttemptId: null, providerAttemptDeadlineAt: null, updatedAt: new Date() }).where(eq(aiceoTasksTable.id, task.id));
        await this.audit(tx, { taskId: task.id, correlationId: task.correlationId, runId: task.runId ?? undefined, type: "EXPIRED_ATTEMPT_RECOVERED", state: "UNKNOWN", actorId, details: evidence });
      }
      if (expired.length) {
        await tx.update(aiceoControlStateTable).set({ queueActive: false, circuitFailureCount: sql`${aiceoControlStateTable.circuitFailureCount} + ${expired.length}`, circuitState: sql`CASE WHEN ${aiceoControlStateTable.circuitFailureCount} + ${expired.length} >= ${aiceoControlStateTable.circuitThreshold} THEN 'OPEN' ELSE ${aiceoControlStateTable.circuitState} END`, circuitHalfOpenAt: sql`CASE WHEN ${aiceoControlStateTable.circuitFailureCount} + ${expired.length} >= ${aiceoControlStateTable.circuitThreshold} THEN now() + (${aiceoControlStateTable.circuitCooldownMs} * interval '1 millisecond') ELSE ${aiceoControlStateTable.circuitHalfOpenAt} END`, updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id));
      }
      return expired.length;
    });
  }

  private async recordRetry(id: string, attemptId: string, actorId: string, attempt: number, result: Extract<GrokAttemptResult, { ok: false }>, actualTokens: number, actualCalls: number) {
    await db.transaction(async (tx) => {
      const task = (await tx.select().from(aiceoTasksTable).where(eq(aiceoTasksTable.id, id)).for("update"))[0];
      if (!task || task.state !== "RUNNING" || task.providerAttemptId !== attemptId) throw new Error("Retry settlement does not own the active provider attempt");
      const actualUsd = (actualTokens * TOKEN_USD_RATE).toFixed(6);
      if (actualTokens > Number(task.budget.reservedTokens) || actualCalls > Number(task.budget.reservedCalls) || Number(actualUsd) > Number(task.budget.reservedUsd)) throw new Error("ARCH-001 retry would exceed reserved budget");
      const nextRetryAt = new Date(Date.now() + 250 * (2 ** (attempt - 1)));
      await tx.update(aiceoTasksTable).set({ retryCount: attempt, nextRetryAt, providerAttemptId: null, providerAttemptDeadlineAt: null, budget: { ...task.budget, actualTokens, actualCalls, actualUsd }, updatedAt: new Date() }).where(eq(aiceoTasksTable.id, id));
      await this.audit(tx, { taskId: id, correlationId: task.correlationId, runId: task.runId ?? undefined, type: "PROVIDER_RETRY_SCHEDULED", state: "RUNNING", actorId, details: { attempt, nextRetryAt: nextRetryAt.toISOString(), reason: safeCredentialErrorMessage(result.reason), settled: result.settled } });
    });
  }

  private async settleExecution(id: string, attemptId: string, actorId: string, result: GrokAttemptResult, actualTokens: number, actualCalls: number) {
    return db.transaction(async (tx) => {
      const task = (await tx.select().from(aiceoTasksTable).where(eq(aiceoTasksTable.id, id)).for("update"))[0];
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      if (!task || task.state !== "RUNNING" || !control || task.providerAttemptId !== attemptId) throw new Error("Execution settlement does not own the active provider attempt");
      const actualUsd = (actualTokens * TOKEN_USD_RATE).toFixed(6);
      const overBudget = actualTokens > Number(task.budget.reservedTokens) || actualCalls > Number(task.budget.reservedCalls) || Number(actualUsd) > Number(task.budget.reservedUsd);
      const state: AiceoState = result.ok && !overBudget ? "VALIDATING" : result.ok ? "FAILED" : result.state;
      const providerOutput = result.ok
        ? sanitizeProviderOutputForPersistence(result.text, "grok-provider-output")
        : null;
      const providerResponseId = result.ok
        ? sanitizeProviderOutputForPersistence(result.responseId, "grok-provider-response-id")
        : null;
      const providerDetections = [
        ...(providerOutput?.detections ?? []),
        ...(providerResponseId?.detections ?? []),
      ];
      const evidence = result.ok && !overBudget
        ? {
            provider: "xAI", modelAuthority: "registry", responseId: safe(providerResponseId!.value, 180),
            providerTimestamp: result.providerTimestamp.toISOString(),
            output: safe(providerOutput!.value, 4000), outputHash: digest(providerOutput!.value),
            sourceOutputDigest: providerOutput!.originalDigest,
            credentialFirewall: {
              version: "AICEO-CREDENTIAL-FIREWALL-1",
              redacted: providerOutput!.redacted || providerResponseId!.redacted,
              classifications: [...new Set(providerDetections.map((item) => item.classification))],
              detectionDigests: providerDetections.map((item) => item.contentDigest),
              productionAuthority: false,
            },
            attempts: actualCalls, usage: { tokens: actualTokens, usd: actualUsd },
            tools: "disabled", productionAuthority: false,
          }
        : { provider: "xAI", reason: overBudget ? "Actual usage exceeded reserved budget" : result.ok ? "Budget settlement failed" : safeCredentialErrorMessage(result.reason), settled: result.settled, attempts: actualCalls, usage: { tokens: actualTokens, usd: actualUsd }, productionAuthority: false };
      await tx.update(aiceoTasksTable).set({ state, evidence, providerTimestamp: result.providerTimestamp ?? null, nextRetryAt: null, providerAttemptId: null, providerAttemptDeadlineAt: null, budget: { ...task.budget, actualTokens, actualCalls, actualUsd }, updatedAt: new Date() }).where(eq(aiceoTasksTable.id, id));
      if (INCIDENTS.includes(state as (typeof INCIDENTS)[number])) {
        await tx.update(aiceoControlStateTable).set({ queueActive: false, circuitFailureCount: sql`${aiceoControlStateTable.circuitFailureCount} + 1`, circuitHalfOpenAt: sql`CASE WHEN ${aiceoControlStateTable.circuitFailureCount} + 1 >= ${aiceoControlStateTable.circuitThreshold} THEN now() + (${aiceoControlStateTable.circuitCooldownMs} * interval '1 millisecond') ELSE ${aiceoControlStateTable.circuitHalfOpenAt} END`, circuitState: sql`CASE WHEN ${aiceoControlStateTable.circuitFailureCount} + 1 >= ${aiceoControlStateTable.circuitThreshold} THEN 'OPEN' ELSE ${aiceoControlStateTable.circuitState} END`, updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id));
      } else if (control.circuitState === "HALF_OPEN") {
        await tx.update(aiceoControlStateTable).set({ circuitState: "CLOSED", circuitFailureCount: 0, updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id));
      }
      await this.audit(tx, { taskId: id, correlationId: task.correlationId, runId: task.runId ?? undefined, type: result.ok && !overBudget ? "PROVIDER_SETTLED" : "PROVIDER_INCIDENT", state, actorId, details: evidence });
      return { ...task, state, evidence, budget: { ...task.budget, actualTokens, actualCalls, actualUsd } };
    });
  }

  async executeApproved(id: string, actorId: string) {
    let actualTokens = 0;
    let firstAttempt = true;
    for (;;) {
      let context;
      try {
        context = await this.claimAttempt(id, actorId, firstAttempt);
        firstAttempt = false;
      } catch (error) {
        if (firstAttempt) {
          await this.auditRejection({ taskId: id, type: "EXECUTION_REJECTED", actorId, error });
          throw fail(error);
        }
        return this.transition(id, "FAILED", actorId, { reason: safeCredentialErrorMessage(error), settled: true, productionAuthority: false });
      }
      const result = await executeGrokDevelopmentAttempt({ action: context.task.action as ApprovedGrokDevelopmentAction, resource: context.task.resource, model: context.model, timeoutMs: context.task.timeoutMs });
      actualTokens += result.tokens;
      if (result.ok || !result.retryable || !result.settled || context.task.retryCount >= context.task.maxRetries) return this.settleExecution(id, context.attemptId, actorId, result, actualTokens, context.actualCalls);
      const nextAttempt = context.task.retryCount + 1;
      await this.recordRetry(id, context.attemptId, actorId, nextAttempt, result, actualTokens, context.actualCalls);
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (nextAttempt - 1))));
    }
  }

  async transition(id: string, state: Exclude<AiceoState, "COMPLETED">, actorId: string, evidence?: Record<string, unknown>) {
    assertCredentialPersistenceSafe({ actorId, evidence }, "task-transition");
    return db.transaction(async (tx) => {
      const task = (await tx.select().from(aiceoTasksTable).where(eq(aiceoTasksTable.id, id)).for("update"))[0];
      if (!task) throw new Error("Task not found");
      if (!allowedAiceoTransition(task.state as AiceoState, state, evidence?.diagnosis === true)) throw new Error(`Invalid ARCH-001 transition ${task.state}->${state}`);
      if (state === "RUNNING") {
        const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
        const incidents = await tx.select({ id: aiceoTasksTable.id }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, INCIDENTS));
        if (!control || !control.queueActive || control.killSwitch || control.circuitState === "OPEN" || incidents.length) throw new Error("ARCH-001 run gate is closed");
        const active = await tx.select({ budget: aiceoTasksTable.budget }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"]));
        const sums = active.reduce((total, row) => ({ tokens: total.tokens + Number(row.budget.reservedTokens ?? 0), calls: total.calls + Number(row.budget.reservedCalls ?? 0), usd: total.usd + Number(row.budget.reservedUsd ?? 0) }), { tokens: 0, calls: 0, usd: 0 });
        if (sums.tokens + Number(task.budget.estimatedTokens) > control.aggregateTokenCap || sums.calls + Number(task.budget.estimatedCalls) > control.aggregateCallCap || sums.usd + Number(task.budget.estimatedUsd) > Number(control.aggregateUsdCap)) throw new Error("ARCH-001 aggregate reservation budget exceeded");
        const runId = randomUUID();
        await tx.update(aiceoTasksTable).set({ state, runId, budget: sql`jsonb_set(jsonb_set(jsonb_set(${aiceoTasksTable.budget}, '{reservedTokens}', to_jsonb((${aiceoTasksTable.budget}->>'estimatedTokens')::int)), '{reservedCalls}', to_jsonb((${aiceoTasksTable.budget}->>'estimatedCalls')::int)), '{reservedUsd}', to_jsonb((${aiceoTasksTable.budget}->>'estimatedUsd')::numeric))`, updatedAt: new Date() }).where(eq(aiceoTasksTable.id, id));
        await this.audit(tx, { taskId: id, correlationId: task.correlationId, runId, type: "STARTED", state, actorId }); return { ...task, state, runId };
      }
      await tx.update(aiceoTasksTable).set({ state, evidence: evidence ?? null, updatedAt: new Date() }).where(eq(aiceoTasksTable.id, id));
      if (INCIDENTS.includes(state as (typeof INCIDENTS)[number])) {
        const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
        if (control) await tx.update(aiceoControlStateTable).set({ queueActive: false, circuitFailureCount: sql`${aiceoControlStateTable.circuitFailureCount} + 1`, circuitHalfOpenAt: sql`CASE WHEN ${aiceoControlStateTable.circuitFailureCount} + 1 >= ${aiceoControlStateTable.circuitThreshold} THEN now() + (${aiceoControlStateTable.circuitCooldownMs} * interval '1 millisecond') ELSE ${aiceoControlStateTable.circuitHalfOpenAt} END`, circuitState: sql`CASE WHEN ${aiceoControlStateTable.circuitFailureCount} + 1 >= ${aiceoControlStateTable.circuitThreshold} THEN 'OPEN' ELSE ${aiceoControlStateTable.circuitState} END`, updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id));
      }
      await this.audit(tx, { taskId: id, correlationId: task.correlationId, runId: task.runId ?? undefined, type: "STATE_TRANSITION", state, actorId, details: evidence }); return { ...task, state, evidence };
    }).catch((error) => { throw fail(error); });
  }

  async validate(id: string, passed: boolean, validatorId: string, evidence: Record<string, unknown>) {
    assertCredentialPersistenceSafe({ validatorId, evidence }, "task-validation");
    if (!passed || !validatorId || !evidence) throw new Error("Independent validation evidence is required");
    return db.transaction(async (tx) => {
      const task = (await tx.select().from(aiceoTasksTable).where(eq(aiceoTasksTable.id, id)).for("update"))[0];
      if (!task || task.state !== "VALIDATING") throw new Error("Only VALIDATING tasks may be completed");
      const executionActors = await tx.select({ actorId: aiceoAuditEventsTable.actorId }).from(aiceoAuditEventsTable).where(and(eq(aiceoAuditEventsTable.taskId, id), inArray(aiceoAuditEventsTable.eventType, ["SUBMITTED", "APPROVED", "STARTED", "PROVIDER_ATTEMPT_STARTED"])));
      if (executionActors.some((row) => row.actorId === safe(validatorId, 180))) throw new Error("Independent validator must differ from submitter, approver, and executor");
      const budget = task.budget;
      if (Number(budget.actualTokens) > Number(budget.reservedTokens) || Number(budget.actualCalls) > Number(budget.reservedCalls) || Number(budget.actualUsd) > Number(budget.reservedUsd)) throw new Error("Actual usage exceeds reserved budget");
      await tx.update(aiceoTasksTable).set({ state: "COMPLETED", evidence: { provider: task.evidence, validation: evidence, validated: true, validatorId: safe(validatorId, 180) }, updatedAt: new Date() }).where(eq(aiceoTasksTable.id, id));
      await this.audit(tx, { taskId: id, correlationId: task.correlationId, runId: task.runId ?? undefined, type: "VALIDATED", state: "COMPLETED", actorId: validatorId, details: evidence }); return { ...task, state: "COMPLETED" as const };
    }).catch((error) => { throw fail(error); });
  }
  async cancel(id: string, actorId: string) {
    assertCredentialPersistenceSafe(actorId, "task-cancellation");
    const task = (await db.select({ state: aiceoTasksTable.state }).from(aiceoTasksTable).where(eq(aiceoTasksTable.id, id)).limit(1))[0];
    if (!task || task.state !== "QUEUED") throw new Error("Only a queued task may be cancelled; in-flight attempts must settle");
    const submitted = (await db.select({ actorId: aiceoAuditEventsTable.actorId }).from(aiceoAuditEventsTable).where(and(eq(aiceoAuditEventsTable.taskId, id), eq(aiceoAuditEventsTable.eventType, "SUBMITTED"))).limit(1))[0];
    if (submitted?.actorId !== safe(actorId, 180)) throw new Error("Only the submitting user may cancel this queued task");
    return this.transition(id, "CANCELLED", actorId);
  }

  async setKillSwitch(enabled: boolean, actorId: string) {
    assertCredentialPersistenceSafe(actorId, "control-kill-switch");
    return db.transaction(async (tx) => { const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0]; if (!control) throw new Error("AICEO control row is missing"); await tx.update(aiceoControlStateTable).set({ killSwitch: enabled, queueActive: enabled ? false : control.queueActive, updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id)); await this.audit(tx, { correlationId: randomUUID(), type: enabled ? "KILL_SWITCH_ON" : "KILL_SWITCH_OFF", actorId }); return { ...control, killSwitch: enabled, queueActive: enabled ? false : control.queueActive }; });
  }
  async acknowledgeRecovery(actorId: string) {
    assertCredentialPersistenceSafe(actorId, "control-recovery");
    return db.transaction(async (tx) => { const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0]; const incidents = await tx.select({ id: aiceoTasksTable.id }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, INCIDENTS)); if (!control || control.killSwitch || incidents.length || control.circuitState === "OPEN") throw new Error("Recovery acknowledgment requires resolved incidents, kill switch off, and circuit permission"); await tx.update(aiceoControlStateTable).set({ queueActive: true, acknowledgedAt: new Date(), acknowledgedBy: safe(actorId, 180), updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id)); await this.audit(tx, { correlationId: randomUUID(), type: "RECOVERY_ACKNOWLEDGED", actorId }); return { ...control, queueActive: true }; });
  }
  async resetCircuit(actorId: string) {
    assertCredentialPersistenceSafe(actorId, "control-circuit");
    return db.transaction(async (tx) => {
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      if (!control || control.circuitState !== "OPEN" || !control.circuitHalfOpenAt || control.circuitHalfOpenAt > new Date()) throw new Error("Circuit cooldown has not elapsed");
      await tx.update(aiceoControlStateTable).set({ circuitState: "HALF_OPEN", circuitHalfOpenAt: null, updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id));
      await this.audit(tx, { correlationId: randomUUID(), type: "CIRCUIT_HALF_OPEN", actorId });
      return { ...control, circuitState: "HALF_OPEN" };
    });
  }
  async diagnose(id: string, resolution: "BLOCKED" | "CANCELLED", actorId: string, evidence: Record<string, unknown>) { return this.transition(id, resolution, actorId, { ...evidence, diagnosis: true }); }
}
export const aiceoControlPlane = new AiceoControlPlane();
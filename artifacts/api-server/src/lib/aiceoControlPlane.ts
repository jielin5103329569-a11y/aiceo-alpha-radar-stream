import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  aiceoAuditEventsTable,
  aiceoControlStateTable,
  aiceoPolicyRegistryTable,
  aiceoSourceRegistryTable,
  aiceoTasksTable,
  db,
} from "@workspace/db";

export const AICEO_STATES = ["QUEUED", "RUNNING", "VALIDATING", "COMPLETED", "FAILED", "UNKNOWN", "STALE", "BLOCKED", "CANCELLED"] as const;
export type AiceoState = (typeof AICEO_STATES)[number];
const INCIDENTS = ["FAILED", "UNKNOWN", "STALE"] as const;
const DENIES = ["shell", "workflow", "network", "tool", "database", "radar", "alpha", "databento", "alerts", "trading", "production", "model-upgrade"];
const FOUNDATION_COUNT = 13;
const FIXED_VERSION = "ARCH-001";
const FIXED_AUTHORITY = "synthetic_contract_echo";
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
    await tx.select({ id: aiceoControlStateTable.id }).from(aiceoControlStateTable).limit(1).for("update");
    const prior = await tx.select({ hash: aiceoAuditEventsTable.eventHash }).from(aiceoAuditEventsTable).orderBy(desc(aiceoAuditEventsTable.serverTimestamp), desc(aiceoAuditEventsTable.id)).limit(1);
    const payload = { ...input.details, actorId: safe(input.actorId), type: input.type, state: input.state ?? null };
    const eventHash = digest({ eventId: randomUUID(), at: new Date().toISOString(), correlationId: input.correlationId, taskId: input.taskId ?? null, runId: input.runId ?? null, type: input.type, state: input.state ?? null, actorId: safe(input.actorId), payload, previousHash: prior[0]?.hash ?? null });
    await tx.insert(aiceoAuditEventsTable).values({ taskId: input.taskId, correlationId: input.correlationId, runId: input.runId, eventType: input.type, state: input.state, actorId: safe(input.actorId, 180), payload, previousHash: prior[0]?.hash ?? null, eventHash, serverTimestamp: new Date() });
  }

  async submit(input: { action: string; resource: string; environment?: "development" | "staging" | "production"; budget?: { estimatedTokens?: number; estimatedCalls?: number; estimatedUsd?: number }; timeoutMs?: number; maxRetries?: number; clientTimestamp?: string }, actorId: string) {
    return db.transaction(async (tx) => {
      const source = (await tx.select().from(aiceoSourceRegistryTable).where(eq(aiceoSourceRegistryTable.catalogId, "connector_catalog:xai")))[0];
      const policies = await tx.select().from(aiceoPolicyRegistryTable);
      const environment = input.environment ?? "development";
      const text = `${input.action} ${input.resource}`.toLowerCase();
      if (!source || policies.length !== FOUNDATION_COUNT) throw new Error("ARCH-001 source or frozen policy registry is incomplete");
      if (environment === "production" || DENIES.some((item) => text.includes(item))) throw new Error("ARCH-001 permission denied");
      const estimatedTokens = input.budget?.estimatedTokens ?? 128, estimatedCalls = input.budget?.estimatedCalls ?? 1, estimatedUsd = input.budget?.estimatedUsd ?? 0.01;
      if (estimatedTokens > 4096 || estimatedCalls > 4 || estimatedUsd > 0.25) throw new Error("ARCH-001 per-task development budget exceeded");
      const totals = await tx.select({ budget: aiceoTasksTable.budget }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, ["QUEUED", "RUNNING", "VALIDATING"]));
      const totalTokens = totals.reduce((sum, item) => sum + Number(item.budget.reservedTokens ?? 0), 0);
      if (totalTokens + estimatedTokens > 8192) throw new Error("ARCH-001 aggregate token budget exceeded");
      const id = randomUUID(), correlationId = randomUUID(), timestamp = new Date();
      const task = { id, correlationId, runId: null, sourceId: source.id, policyId: policies[0].id, state: "QUEUED" as const, action: safe(input.action, 120), resource: safe(input.resource, 180), permissions: { actions: ["contract.echo"], resources: ["synthetic"], explicitDenies: DENIES }, contractVersion: FIXED_VERSION, contractHash: digest({ authority: FIXED_AUTHORITY, version: FIXED_VERSION }), environment, authority: FIXED_AUTHORITY, evidence: null, budget: { estimatedTokens, reservedTokens: 0, actualTokens: 0, estimatedCalls, reservedCalls: 0, actualCalls: 0, estimatedUsd: String(estimatedUsd), reservedUsd: "0", actualUsd: "0" }, timeoutMs: Math.min(input.timeoutMs ?? 10_000, 30_000), maxRetries: Math.min(input.maxRetries ?? 1, 2), retryCount: 0, serverTimestamp: timestamp, clientTimestamp: input.clientTimestamp ? new Date(input.clientTimestamp) : null, createdAt: timestamp, updatedAt: timestamp };
      await tx.insert(aiceoTasksTable).values(task);
      await this.audit(tx, { taskId: id, correlationId, type: "SUBMITTED", state: "QUEUED", actorId, details: { action: task.action, resource: task.resource } });
      return task;
    }).catch((error) => { throw fail(error); });
  }

  async transition(id: string, state: Exclude<AiceoState, "COMPLETED">, actorId: string, evidence?: Record<string, unknown>) {
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
    if (!passed || !validatorId || !evidence) throw new Error("Independent validation evidence is required");
    return db.transaction(async (tx) => {
      const task = (await tx.select().from(aiceoTasksTable).where(eq(aiceoTasksTable.id, id)).for("update"))[0];
      if (!task || task.state !== "VALIDATING") throw new Error("Only VALIDATING tasks may be completed");
      const budget = task.budget;
      if (Number(budget.actualTokens) > Number(budget.reservedTokens) || Number(budget.actualCalls) > Number(budget.reservedCalls) || Number(budget.actualUsd) > Number(budget.reservedUsd)) throw new Error("Actual usage exceeds reserved budget");
      await tx.update(aiceoTasksTable).set({ state: "COMPLETED", evidence: { ...evidence, validated: true, validatorId: safe(validatorId, 180) }, updatedAt: new Date() }).where(eq(aiceoTasksTable.id, id));
      await this.audit(tx, { taskId: id, correlationId: task.correlationId, runId: task.runId ?? undefined, type: "VALIDATED", state: "COMPLETED", actorId: validatorId, details: evidence }); return { ...task, state: "COMPLETED" as const };
    }).catch((error) => { throw fail(error); });
  }
  async cancel(id: string, actorId: string) { return this.transition(id, "CANCELLED", actorId); }

  async setKillSwitch(enabled: boolean, actorId: string) {
    return db.transaction(async (tx) => { const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0]; if (!control) throw new Error("AICEO control row is missing"); await tx.update(aiceoControlStateTable).set({ killSwitch: enabled, queueActive: enabled ? false : control.queueActive, updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id)); await this.audit(tx, { correlationId: randomUUID(), type: enabled ? "KILL_SWITCH_ON" : "KILL_SWITCH_OFF", actorId }); return { ...control, killSwitch: enabled, queueActive: enabled ? false : control.queueActive }; });
  }
  async acknowledgeRecovery(actorId: string) {
    return db.transaction(async (tx) => { const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0]; const incidents = await tx.select({ id: aiceoTasksTable.id }).from(aiceoTasksTable).where(inArray(aiceoTasksTable.state, INCIDENTS)); if (!control || control.killSwitch || incidents.length || control.circuitState === "OPEN") throw new Error("Recovery acknowledgment requires resolved incidents, kill switch off, and circuit permission"); await tx.update(aiceoControlStateTable).set({ queueActive: true, acknowledgedAt: new Date(), acknowledgedBy: safe(actorId, 180), updatedAt: new Date() }).where(eq(aiceoControlStateTable.id, control.id)); await this.audit(tx, { correlationId: randomUUID(), type: "RECOVERY_ACKNOWLEDGED", actorId }); return { ...control, queueActive: true }; });
  }
  async resetCircuit(actorId: string) {
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
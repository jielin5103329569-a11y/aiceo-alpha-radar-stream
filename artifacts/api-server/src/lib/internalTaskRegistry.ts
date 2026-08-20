import { createHash } from "node:crypto";

export const INTERNAL_TASK_REGISTRY_SCHEMA_VERSION = 1;
export const INTERNAL_TASK_MAX_SLOTS = 1;
export const INTERNAL_TASK_DEFAULT_LEASE_TTL_MS = 30_000;
export const INTERNAL_TASK_DEFAULT_ZOMBIE_AFTER_MS = 20_000;
export const INTERNAL_TASK_MAX_LEASE_TTL_MS = 5 * 60_000;
export const INTERNAL_TASK_MAX_CHECKPOINT_BYTES = 32 * 1024;
export const INTERNAL_TASK_MAX_AUDIT_EVENTS = 100;

export type InternalTaskState =
  | "planned"
  | "waiting_for_turn"
  | "active"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "timed_out"
  | "zombie"
  | "recovering"
  | "archived";

export type InternalTaskAuditSeverity = "info" | "warning" | "critical";
export type InternalTaskGovernanceState = "healthy" | "degraded" | "blocked";

export type InternalTaskAuditEvent = {
  eventId: string;
  at: Date;
  taskKey: string | null;
  event:
    | "registry_started"
    | "registry_stopped"
    | "task_registered"
    | "duplicate_task_rejected"
    | "duplicate_implementation_blocked"
    | "claim_granted"
    | "claim_rejected"
    | "lease_heartbeat"
    | "lease_expired"
    | "lease_invalidated_on_stop"
    | "zombie_detected"
    | "lease_reclaimed"
    | "checkpoint_recorded"
    | "checkpoint_idempotent"
    | "checkpoint_rejected"
    | "task_resumed"
    | "task_completed"
    | "task_failed"
    | "dependency_blocked";
  severity: InternalTaskAuditSeverity;
  ownerId: string | null;
  leaseId: string | null;
  reason: string;
};

export type InternalTaskLease = {
  leaseId: string;
  ownerId: string;
  claimedAt: Date;
  lastHeartbeatAt: Date;
  expiresAt: Date;
  ttlMs: number;
  zombieAfterMs: number;
};

export type InternalTaskCheckpoint = {
  checkpointId: string;
  version: number;
  idempotencyKey: string;
  recordedAt: Date;
  phase: string;
  payloadDigest: string;
  sourceLeaseId: string;
  freshMarketEvidenceAllowed: false;
};

export type InternalTaskResumeCheckpoint = {
  metadata: InternalTaskCheckpoint;
  payload: unknown;
};

export type InternalTaskDefinition = {
  taskKey: string;
  title: string;
  implementationKey: string;
  ownerModule: string;
  dependsOn?: string[];
  resourceClaims?: string[];
  ttlMs?: number;
  zombieAfterMs?: number;
};

export type InternalTaskSummary = {
  taskKey: string;
  taskId: string;
  title: string;
  implementationKey: string;
  ownerModule: string;
  state: InternalTaskState;
  ownerId: string | null;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  checkpointVersion: number | null;
  checkpointRecordedAt: Date | null;
  dependencyState: "satisfied" | "missing" | "unvalidated" | "cycle";
  dependencyKeys: string[];
  resourceClaims: string[];
  lastError: string | null;
  updatedAt: Date;
};

export type InternalTaskGovernanceAlert = {
  code:
    | "task_registry_stopped"
    | "task_lease_expired"
    | "task_zombie_detected"
    | "task_dependency_broken"
    | "task_duplicate"
    | "task_checkpoint_missing"
    | "task_recovery_blocked";
  severity: InternalTaskAuditSeverity;
  taskKeys: string[];
  reason: string;
};

export type InternalTaskGovernanceSnapshot = {
  schemaVersion: number;
  registryState: InternalTaskGovernanceState;
  serviceRunning: boolean;
  processScoped: true;
  maxConcurrentSlots: number;
  registeredCount: number;
  plannedCount: number;
  activeCount: number;
  pausedCount: number;
  blockedCount: number;
  completedCount: number;
  failedCount: number;
  timedOutCount: number;
  zombieCount: number;
  recoveringCount: number;
  activeLeaseCount: number;
  expiredLeaseCount: number;
  staleHeartbeatCount: number;
  dependencyBrokenCount: number;
  duplicateTaskCount: number;
  checkpointedCount: number;
  canStartTaskKeys: string[];
  alerts: InternalTaskGovernanceAlert[];
  auditEventCount: number;
  lastAuditAt: Date | null;
  recentAudit: InternalTaskAuditEvent[];
  tasks: InternalTaskSummary[];
  reason: string;
  auditHash: string;
};

type InternalTaskRecord = {
  definition: Required<Pick<InternalTaskDefinition, "taskKey" | "title" | "implementationKey" | "ownerModule">> & {
    dependsOn: string[];
    resourceClaims: string[];
    ttlMs: number;
    zombieAfterMs: number;
  };
  taskId: string;
  state: InternalTaskState;
  ownerId: string | null;
  lease: InternalTaskLease | null;
  checkpoint: InternalTaskCheckpoint | null;
  checkpointPayloadJson: string | null;
  dependencyState: InternalTaskSummary["dependencyState"];
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function eventId(taskKey: string | null, event: string, at: Date, ordinal: number): string {
  return digest(`${taskKey ?? "registry"}:${event}:${at.toISOString()}:${ordinal}`).slice(0, 24);
}

function safeText(value: string, max = 320): string {
  return value.replace(/[\r\n]/g, " ").slice(0, max);
}

function normalizeTiming(definition: InternalTaskDefinition): {
  accepted: boolean;
  ttlMs: number;
  zombieAfterMs: number;
  reason: string | null;
} {
  const ttlMs = definition.ttlMs ?? INTERNAL_TASK_DEFAULT_LEASE_TTL_MS;
  const zombieAfterMs = definition.zombieAfterMs ?? INTERNAL_TASK_DEFAULT_ZOMBIE_AFTER_MS;
  if (!Number.isFinite(ttlMs) || !Number.isFinite(zombieAfterMs) || ttlMs <= 0 || zombieAfterMs <= 0) {
    return { accepted: false, ttlMs, zombieAfterMs, reason: "Lease TTL and zombie threshold must be finite positive milliseconds." };
  }
  if (ttlMs > INTERNAL_TASK_MAX_LEASE_TTL_MS) {
    return { accepted: false, ttlMs, zombieAfterMs, reason: `Lease TTL exceeds the ${INTERNAL_TASK_MAX_LEASE_TTL_MS}ms governance maximum.` };
  }
  if (zombieAfterMs >= ttlMs) {
    return { accepted: false, ttlMs, zombieAfterMs, reason: "Zombie threshold must be shorter than the lease TTL so an owner cannot bypass stale-heartbeat detection." };
  }
  return { accepted: true, ttlMs, zombieAfterMs, reason: null };
}

function serializeCheckpointPayload(payload: unknown): { payloadJson: string; payloadDigest: string } | null {
  try {
    const payloadJson = JSON.stringify(payload);
    if (payloadJson === undefined || Buffer.byteLength(payloadJson, "utf8") > INTERNAL_TASK_MAX_CHECKPOINT_BYTES) return null;
    return { payloadJson, payloadDigest: digest(payloadJson) };
  } catch {
    return null;
  }
}

function parseCheckpointPayload(payloadJson: string): unknown {
  return JSON.parse(payloadJson);
}

function dependencyState(
  task: InternalTaskRecord,
  tasks: Map<string, InternalTaskRecord>,
): InternalTaskSummary["dependencyState"] {
  const visiting = new Set<string>();
  const visit = (key: string): InternalTaskSummary["dependencyState"] => {
    if (visiting.has(key)) return "cycle";
    const dependency = tasks.get(key);
    if (!dependency) return "missing";
    visiting.add(key);
    const nested = dependency.definition.dependsOn
      .map((dependencyKey) => visit(dependencyKey))
      .find((state) => state === "missing" || state === "cycle");
    visiting.delete(key);
    if (nested) return nested;
    return dependency.state === "completed" ? "satisfied" : "unvalidated";
  };
  if (task.definition.dependsOn.length === 0) return "satisfied";
  for (const dependencyKey of task.definition.dependsOn) {
    const result = visit(dependencyKey);
    if (result === "missing" || result === "cycle") return result;
    if (result === "unvalidated") return "unvalidated";
  }
  return "satisfied";
}

function canStart(task: InternalTaskRecord): boolean {
  return task.state === "planned" || task.state === "recovering";
}

export class InternalTaskRegistry {
  private readonly tasks = new Map<string, InternalTaskRecord>();
  private readonly audit: InternalTaskAuditEvent[] = [];
  private serviceRunning = false;
  private monitor: NodeJS.Timeout | null = null;
  private ordinal = 0;

  start(now = new Date()): void {
    if (this.serviceRunning) return;
    this.serviceRunning = true;
    this.recordAudit(null, "registry_started", "Internal task registry started; leases are process-scoped and no prior process lease is accepted.", now, "info");
    this.monitor = setInterval(() => this.inspect(new Date()), 5_000);
    this.monitor.unref();
  }

  stop(now = new Date()): void {
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = null;
    }
    if (!this.serviceRunning) return;
    this.serviceRunning = false;
    for (const task of this.tasks.values()) {
      if (task.state !== "active" || !task.lease) continue;
      task.state = "timed_out";
      task.updatedAt = now;
      task.lastError = "Registry lifecycle stopped; the active lease was invalidated and cannot survive restart.";
      this.recordAudit(task.definition.taskKey, "lease_invalidated_on_stop", task.lastError, now, "critical", task.ownerId, task.lease.leaseId);
    }
    this.recordAudit(null, "registry_stopped", "Internal task registry stopped; active leases cannot survive this process lifecycle.", now, "warning");
  }

  register(definition: InternalTaskDefinition, now = new Date()): {
    accepted: boolean;
    task: InternalTaskSummary | null;
    reason: string;
  } {
    const existing = this.tasks.get(definition.taskKey);
    if (existing) {
      this.recordAudit(definition.taskKey, "duplicate_task_rejected", "Task identity already exists; duplicate registration was rejected idempotently.", now, "critical");
      return {
        accepted: false,
        task: this.toSummary(existing, now),
        reason: "Task identity already exists.",
      };
    }
    const timing = normalizeTiming(definition);
    if (!timing.accepted) {
      this.recordAudit(definition.taskKey, "claim_rejected", timing.reason ?? "Invalid lease timing.", now, "critical");
      return { accepted: false, task: null, reason: timing.reason ?? "Invalid lease timing." };
    }
    const duplicateImplementation = [...this.tasks.values()].find((task) => (
      task.definition.implementationKey === definition.implementationKey
      && task.state !== "archived"
    ));
    const record: InternalTaskRecord = {
      definition: {
        taskKey: definition.taskKey,
        title: definition.title,
        implementationKey: definition.implementationKey,
        ownerModule: definition.ownerModule,
        dependsOn: [...(definition.dependsOn ?? [])],
        resourceClaims: [...(definition.resourceClaims ?? [])],
        ttlMs: timing.ttlMs,
        zombieAfterMs: timing.zombieAfterMs,
      },
      taskId: `${definition.taskKey}:${digest(`${definition.taskKey}:${this.ordinal}`).slice(0, 16)}`,
      state: duplicateImplementation ? "blocked" : "planned",
      ownerId: null,
      lease: null,
      checkpoint: null,
      checkpointPayloadJson: null,
      dependencyState: "satisfied",
      lastError: duplicateImplementation
        ? `Duplicate implementationKey is already registered by ${duplicateImplementation.definition.taskKey}.`
        : null,
      createdAt: now,
      updatedAt: now,
    };
    this.ordinal += 1;
    this.tasks.set(definition.taskKey, record);
    this.recordAudit(
      definition.taskKey,
      duplicateImplementation ? "duplicate_implementation_blocked" : "task_registered",
      duplicateImplementation
        ? record.lastError ?? "Duplicate implementation was blocked."
        : "Task registered without starting execution.",
      now,
      duplicateImplementation ? "critical" : "info",
    );
    return {
      accepted: !duplicateImplementation,
      task: this.toSummary(record, now),
      reason: duplicateImplementation ? record.lastError ?? "Duplicate implementation." : "Task registered.",
    };
  }

  inspect(now = new Date()): InternalTaskGovernanceSnapshot {
    for (const task of this.tasks.values()) {
      task.dependencyState = dependencyState(task, this.tasks);
      if (!task.lease || task.state !== "active") continue;
      this.invalidateStaleLease(task, now);
    }
    return this.getSnapshot(now);
  }

  claim(taskKey: string, ownerId: string, now = new Date()): {
    accepted: boolean;
    lease: InternalTaskLease | null;
    task: InternalTaskSummary | null;
    reason: string;
  } {
    const task = this.tasks.get(taskKey);
    if (!task) return this.rejectedClaim(taskKey, "Task identity is not registered.", now);
    task.dependencyState = dependencyState(task, this.tasks);
    if (!this.serviceRunning) return this.rejectedClaim(taskKey, "Internal task registry is not running.", now);
    if (!canStart(task)) return this.rejectedClaim(taskKey, `Task state ${task.state} is not claimable.`, now);
    if (task.dependencyState !== "satisfied") {
      task.state = "blocked";
      task.updatedAt = now;
      task.lastError = `Dependencies are ${task.dependencyState}; claim refused.`;
      this.recordAudit(taskKey, "dependency_blocked", task.lastError, now, "critical");
      return this.rejectedClaim(taskKey, task.lastError, now);
    }
    if ([...this.tasks.values()].some((candidate) => (
      candidate.state === "active"
      && candidate.definition.resourceClaims.some((claim) => task.definition.resourceClaims.includes(claim))
    ))) {
      return this.rejectedClaim(taskKey, "An exclusive resource claim is already held by another active task.", now);
    }
    if ([...this.tasks.values()].filter((candidate) => candidate.state === "active").length >= INTERNAL_TASK_MAX_SLOTS) {
      return this.rejectedClaim(taskKey, "Internal execution slot capacity is full.", now);
    }
    const leaseId = `${taskKey}:${digest(`${ownerId}:${now.toISOString()}:${this.ordinal}`).slice(0, 20)}`;
    this.ordinal += 1;
    const lease: InternalTaskLease = {
      leaseId,
      ownerId,
      claimedAt: now,
      lastHeartbeatAt: now,
      expiresAt: new Date(now.getTime() + task.definition.ttlMs),
      ttlMs: task.definition.ttlMs,
      zombieAfterMs: task.definition.zombieAfterMs,
    };
    task.state = "active";
    task.ownerId = ownerId;
    task.lease = lease;
    task.updatedAt = now;
    task.lastError = null;
    this.recordAudit(taskKey, "claim_granted", "Internal task lease granted; no production service is invoked by this claim.", now, "info", ownerId, leaseId);
    return { accepted: true, lease, task: this.toSummary(task, now), reason: "Lease granted." };
  }

  heartbeat(taskKey: string, leaseId: string, ownerId: string, now = new Date()): {
    accepted: boolean;
    lease: InternalTaskLease | null;
    task: InternalTaskSummary | null;
    reason: string;
  } {
    const task = this.tasks.get(taskKey);
    if (!task || !task.lease) return this.rejectedHeartbeat(taskKey, "No active lease exists.", now);
    if (task.state !== "active" || task.lease.leaseId !== leaseId || task.lease.ownerId !== ownerId) {
      return this.rejectedHeartbeat(taskKey, "Lease identity or owner does not match the active lease.", now);
    }
    if (!this.ensureCurrentLease(task, now)) return this.rejectedHeartbeat(taskKey, "Lease is timed out or zombie; heartbeat cannot revive it.", now);
    task.lease = {
      ...task.lease,
      lastHeartbeatAt: now,
      expiresAt: new Date(now.getTime() + task.lease.ttlMs),
    };
    task.updatedAt = now;
    this.recordAudit(taskKey, "lease_heartbeat", "Lease heartbeat accepted and TTL extended.", now, "info", ownerId, leaseId);
    return { accepted: true, lease: task.lease, task: this.toSummary(task, now), reason: "Heartbeat accepted." };
  }

  reclaim(taskKey: string, operatorId: string, now = new Date()): {
    accepted: boolean;
    task: InternalTaskSummary | null;
    reason: string;
  } {
    const task = this.tasks.get(taskKey);
    if (!task) return { accepted: false, task: null, reason: "Task identity is not registered." };
    if (task.state !== "timed_out" && task.state !== "zombie") {
      return { accepted: false, task: this.toSummary(task, now), reason: "Only timed_out or zombie tasks can be reclaimed." };
    }
    const previousLeaseId = task.lease?.leaseId ?? null;
    task.lease = null;
    task.ownerId = null;
    task.state = task.checkpoint ? "recovering" : "blocked";
    task.updatedAt = now;
    task.lastError = task.checkpoint
      ? `Lease reclaimed by ${operatorId}; resume requires a new lease from the saved checkpoint.`
      : `Lease reclaimed by ${operatorId}; no checkpoint is available, so recovery is blocked.`;
    this.recordAudit(
      taskKey,
      "lease_reclaimed",
      task.lastError,
      now,
      task.checkpoint ? "warning" : "critical",
      operatorId,
      previousLeaseId,
    );
    return {
      accepted: true,
      task: this.toSummary(task, now),
      reason: task.lastError,
    };
  }

  recordCheckpoint(
    taskKey: string,
    leaseId: string,
    ownerId: string,
    input: { idempotencyKey: string; version: number; phase: string; payload: unknown },
    now = new Date(),
  ): {
    accepted: boolean;
    idempotent: boolean;
    checkpoint: InternalTaskCheckpoint | null;
    task: InternalTaskSummary | null;
    reason: string;
  } {
    const task = this.tasks.get(taskKey);
    if (!task || task.state !== "active" || !task.lease || task.lease.leaseId !== leaseId || task.lease.ownerId !== ownerId) {
      this.recordAudit(taskKey, "checkpoint_rejected", "Checkpoint requires the current valid task lease.", now, "critical", ownerId, leaseId);
      return { accepted: false, idempotent: false, checkpoint: null, task: task ? this.toSummary(task, now) : null, reason: "Current valid task lease is required." };
    }
    if (!this.ensureCurrentLease(task, now)) {
      return { accepted: false, idempotent: false, checkpoint: null, task: this.toSummary(task, now), reason: "Lease is timed out or zombie; checkpoint rejected." };
    }
    if (task.checkpoint?.idempotencyKey === input.idempotencyKey) {
      this.recordAudit(taskKey, "checkpoint_idempotent", "Duplicate checkpoint idempotency key returned the existing checkpoint.", now, "info", ownerId, leaseId);
      return { accepted: true, idempotent: true, checkpoint: task.checkpoint, task: this.toSummary(task, now), reason: "Existing checkpoint returned idempotently." };
    }
    if (task.checkpoint && input.version < task.checkpoint.version) {
      this.recordAudit(taskKey, "checkpoint_rejected", "Checkpoint version would move backwards.", now, "critical", ownerId, leaseId);
      return { accepted: false, idempotent: false, checkpoint: task.checkpoint, task: this.toSummary(task, now), reason: "Checkpoint version cannot move backwards." };
    }
    const serializedPayload = serializeCheckpointPayload(input.payload);
    if (!serializedPayload) {
      this.recordAudit(taskKey, "checkpoint_rejected", `Checkpoint payload must be JSON-serializable and at most ${INTERNAL_TASK_MAX_CHECKPOINT_BYTES} bytes.`, now, "critical", ownerId, leaseId);
      return { accepted: false, idempotent: false, checkpoint: task.checkpoint, task: this.toSummary(task, now), reason: "Checkpoint payload is not bounded JSON state." };
    }
    const checkpoint: InternalTaskCheckpoint = {
      checkpointId: `${taskKey}:checkpoint:${input.version}:${digest(input.idempotencyKey).slice(0, 12)}`,
      version: input.version,
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
      phase: safeText(input.phase, 120),
      payloadDigest: serializedPayload.payloadDigest,
      sourceLeaseId: leaseId,
      freshMarketEvidenceAllowed: false,
    };
    task.checkpoint = checkpoint;
    task.checkpointPayloadJson = serializedPayload.payloadJson;
    task.updatedAt = now;
    this.recordAudit(taskKey, "checkpoint_recorded", "Checkpoint recorded; it contains no authority to declare market data fresh.", now, "info", ownerId, leaseId);
    return { accepted: true, idempotent: false, checkpoint, task: this.toSummary(task, now), reason: "Checkpoint recorded." };
  }

  resume(taskKey: string, ownerId: string, now = new Date()): {
    accepted: boolean;
    lease: InternalTaskLease | null;
    task: InternalTaskSummary | null;
    resumeCheckpoint: InternalTaskResumeCheckpoint | null;
    reason: string;
  } {
    const task = this.tasks.get(taskKey);
    if (!task || task.state !== "recovering" || !task.checkpoint || !task.checkpointPayloadJson) {
      return { accepted: false, lease: null, task: task ? this.toSummary(task, now) : null, resumeCheckpoint: null, reason: "Only a reclaimed task with a bounded checkpoint can resume." };
    }
    const result = this.claim(taskKey, ownerId, now);
    if (result.accepted) {
      this.recordAudit(taskKey, "task_resumed", `Task resumed from checkpoint version ${task.checkpoint.version}.`, now, "warning", ownerId, result.lease?.leaseId ?? null);
    }
    return {
      ...result,
      resumeCheckpoint: result.accepted
        ? { metadata: task.checkpoint, payload: parseCheckpointPayload(task.checkpointPayloadJson) }
        : null,
    };
  }

  complete(taskKey: string, leaseId: string, ownerId: string, validationPassed: boolean, now = new Date()): boolean {
    const task = this.tasks.get(taskKey);
    if (!task || task.state !== "active" || !task.lease || task.lease.leaseId !== leaseId || task.lease.ownerId !== ownerId) return false;
    if (!this.serviceRunning || !this.ensureCurrentLease(task, now)) return false;
    task.state = validationPassed ? "completed" : "failed";
    task.ownerId = null;
    task.lease = null;
    task.updatedAt = now;
    task.lastError = validationPassed ? null : "Task cannot complete without validation evidence.";
    this.recordAudit(taskKey, validationPassed ? "task_completed" : "task_failed", task.lastError ?? "Task completed with validation.", now, validationPassed ? "info" : "critical", ownerId, leaseId);
    return validationPassed;
  }

  getSnapshot(now = new Date()): InternalTaskGovernanceSnapshot {
    for (const task of this.tasks.values()) task.dependencyState = dependencyState(task, this.tasks);
    const records = [...this.tasks.values()];
    const counts = (state: InternalTaskState) => records.filter((task) => task.state === state).length;
    const activeLeases = records.filter((task) => task.lease !== null && task.state === "active");
    const expiredLeases = records.filter((task) => task.state === "timed_out");
    const staleHeartbeats = records.filter((task) => (
      task.state === "active"
      && task.lease !== null
      && now.getTime() - task.lease.lastHeartbeatAt.getTime() >= task.lease.zombieAfterMs
    ));
    const zombieTasks = records.filter((task) => task.state === "zombie");
    const dependencyBroken = records.filter((task) => task.dependencyState !== "satisfied");
    const duplicateTasks = records.filter((task) => task.state === "blocked" && task.lastError?.includes("Duplicate implementationKey"));
    const checkpointed = records.filter((task) => task.checkpoint !== null);
    const alerts: InternalTaskGovernanceAlert[] = [];
    if (!this.serviceRunning) alerts.push({ code: "task_registry_stopped", severity: "critical", taskKeys: [], reason: "Internal task registry is not running; no lease may be accepted." });
    if (expiredLeases.length) alerts.push({ code: "task_lease_expired", severity: "critical", taskKeys: expiredLeases.map((task) => task.definition.taskKey), reason: "One or more task leases exceeded TTL and require controlled reclaim." });
    if (zombieTasks.length || staleHeartbeats.length) alerts.push({
      code: "task_zombie_detected",
      severity: "critical",
      taskKeys: [...zombieTasks, ...staleHeartbeats].map((task) => task.definition.taskKey),
      reason: "One or more task owners missed the zombie heartbeat threshold and require controlled reclaim.",
    });
    if (dependencyBroken.length) alerts.push({ code: "task_dependency_broken", severity: "critical", taskKeys: dependencyBroken.map((task) => task.definition.taskKey), reason: "One or more tasks have missing, cyclic, or unvalidated dependencies." });
    if (duplicateTasks.length) alerts.push({ code: "task_duplicate", severity: "critical", taskKeys: duplicateTasks.map((task) => task.definition.taskKey), reason: "Duplicate implementation identities are blocked from execution." });
    const state: InternalTaskGovernanceState = alerts.some((alert) => alert.severity === "critical")
      ? "blocked"
      : "healthy";
    const canStartTaskKeys = records
      .filter((task) => canStart(task) && task.dependencyState === "satisfied")
      .filter((task) => ![...records].some((candidate) => candidate.state === "active" && candidate.definition.resourceClaims.some((claim) => task.definition.resourceClaims.includes(claim))))
      .map((task) => task.definition.taskKey);
    const summaries = records.map((task) => this.toSummary(task, now));
    const lastAuditAt = this.audit.at(-1)?.at ?? null;
    const unsigned = {
      schemaVersion: INTERNAL_TASK_REGISTRY_SCHEMA_VERSION,
      registryState: state,
      serviceRunning: this.serviceRunning,
      processScoped: true as const,
      maxConcurrentSlots: INTERNAL_TASK_MAX_SLOTS,
      registeredCount: records.length,
      plannedCount: counts("planned"),
      activeCount: counts("active"),
      pausedCount: counts("paused"),
      blockedCount: counts("blocked"),
      completedCount: counts("completed"),
      failedCount: counts("failed"),
      timedOutCount: counts("timed_out"),
      zombieCount: counts("zombie"),
      recoveringCount: counts("recovering"),
      activeLeaseCount: activeLeases.length,
      expiredLeaseCount: expiredLeases.length,
      staleHeartbeatCount: staleHeartbeats.length,
      dependencyBrokenCount: dependencyBroken.length,
      duplicateTaskCount: duplicateTasks.length,
      checkpointedCount: checkpointed.length,
      canStartTaskKeys,
      alerts,
      auditEventCount: this.audit.length,
      lastAuditAt,
      recentAudit: this.audit.slice(-20),
      tasks: summaries,
      reason: state === "healthy"
        ? "Internal task registry is running. No task lease grants authority over production real-time services or market freshness."
        : "Internal task governance is blocked or degraded; fail-closed task admission is active and production real-time services are unaffected.",
    };
    return {
      ...unsigned,
      auditHash: digest(unsigned),
    };
  }

  private toSummary(task: InternalTaskRecord, now: Date): InternalTaskSummary {
    return {
      taskKey: task.definition.taskKey,
      taskId: task.taskId,
      title: task.definition.title,
      implementationKey: task.definition.implementationKey,
      ownerModule: task.definition.ownerModule,
      state: task.state,
      ownerId: task.ownerId,
      leaseId: task.lease?.leaseId ?? null,
      leaseExpiresAt: task.lease?.expiresAt ?? null,
      lastHeartbeatAt: task.lease?.lastHeartbeatAt ?? null,
      checkpointVersion: task.checkpoint?.version ?? null,
      checkpointRecordedAt: task.checkpoint?.recordedAt ?? null,
      dependencyState: task.dependencyState,
      dependencyKeys: [...task.definition.dependsOn],
      resourceClaims: [...task.definition.resourceClaims],
      lastError: task.lastError,
      updatedAt: task.updatedAt ?? now,
    };
  }

  private rejectedClaim(taskKey: string, reason: string, now: Date) {
    this.recordAudit(taskKey, "claim_rejected", reason, now, "warning");
    const task = this.tasks.get(taskKey);
    return { accepted: false, lease: null, task: task ? this.toSummary(task, now) : null, reason };
  }

  private rejectedHeartbeat(taskKey: string, reason: string, now: Date) {
    this.recordAudit(taskKey, "checkpoint_rejected", reason, now, "warning");
    const task = this.tasks.get(taskKey);
    return { accepted: false, lease: null, task: task ? this.toSummary(task, now) : null, reason };
  }

  private ensureCurrentLease(task: InternalTaskRecord, now: Date): boolean {
    if (task.state !== "active" || !task.lease) return false;
    return !this.invalidateStaleLease(task, now);
  }

  private invalidateStaleLease(task: InternalTaskRecord, now: Date): boolean {
    if (task.state !== "active" || !task.lease) return false;
    if (now.getTime() >= task.lease.expiresAt.getTime()) {
      task.state = "timed_out";
      task.updatedAt = now;
      task.lastError = "Lease TTL expired before a valid heartbeat arrived.";
      this.recordAudit(task.definition.taskKey, "lease_expired", task.lastError, now, "critical", task.ownerId, task.lease.leaseId);
      return true;
    }
    if (now.getTime() - task.lease.lastHeartbeatAt.getTime() >= task.lease.zombieAfterMs) {
      task.state = "zombie";
      task.updatedAt = now;
      task.lastError = "Lease heartbeat exceeded the zombie detection threshold.";
      this.recordAudit(task.definition.taskKey, "zombie_detected", task.lastError, now, "critical", task.ownerId, task.lease.leaseId);
      return true;
    }
    return false;
  }

  private recordAudit(
    taskKey: string | null,
    event: InternalTaskAuditEvent["event"],
    reason: string,
    at: Date,
    severity: InternalTaskAuditSeverity,
    ownerId: string | null = null,
    leaseId: string | null = null,
  ): void {
    this.audit.push({
      eventId: eventId(taskKey, event, at, this.ordinal),
      at,
      taskKey,
      event,
      severity,
      ownerId,
      leaseId,
      reason: safeText(reason),
    });
    if (this.audit.length > INTERNAL_TASK_MAX_AUDIT_EVENTS) this.audit.shift();
    this.ordinal += 1;
  }
}

export const internalTaskRegistry = new InternalTaskRegistry();
import { createHash } from "node:crypto";

import type {
  OperationsPersistence,
  PersistedOperationsWork,
} from "./autonomousOperationsStore";

export const AUTONOMOUS_OPERATIONS_SCHEMA_VERSION = 1;
export const AUTONOMOUS_OPERATIONS_INSPECTION_INTERVAL_MS = 5_000;
export const AUTONOMOUS_OPERATIONS_MAX_CONCURRENT = 1;
export const AUTONOMOUS_OPERATIONS_MAX_AUDIT_EVENTS = 200;

export type AutonomousWorkState =
  | "planned"
  | "internally_accepted"
  | "running"
  | "validating"
  | "verified"
  | "failed"
  | "blocked"
  | "blocked_external"
  | "stalled";

export type OperationsObservation = {
  process: "healthy" | "degraded" | "blocked";
  protectedFeed: "healthy" | "recovering" | "degraded";
  alertService: "healthy" | "degraded";
  internalLeases: "healthy" | "recovering" | "blocked";
  providerProbe: "ready" | "unavailable" | "not_configured";
  validationReadiness: "ready" | "constrained";
  reason: string;
};

export type AutonomousWorkResult =
  | { outcome: "verified"; reason: string; evidence: Record<string, string | number | boolean | null> }
  | { outcome: "retryable"; reason: string; evidence?: Record<string, string | number | boolean | null> }
  | { outcome: "blocked_external"; reason: string; evidence?: Record<string, string | number | boolean | null> }
  | { outcome: "failed"; reason: string; evidence?: Record<string, string | number | boolean | null> };

export type AutonomousWorkHandler = (context: {
  workId: string;
  attempt: number;
  now: Date;
  signal: AbortSignal;
  heartbeat: () => boolean;
  checkpoint: (phase: string, details: Record<string, string | number | boolean | null>) => boolean;
}) => Promise<AutonomousWorkResult> | AutonomousWorkResult;

export type AutonomousWorkDefinition = {
  workId: string;
  title: string;
  ownerModule: string;
  /** Statically declared identity; duplicate implementations cannot be admitted. */
  implementationKey: string;
  dependsOn?: string[];
  resourceClaims?: string[];
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  executionTimeoutMs?: number;
  handler: AutonomousWorkHandler;
  validate?: (
    result: Extract<AutonomousWorkResult, { outcome: "verified" }>,
    context: { workId: string; attempt: number; signal: AbortSignal },
  ) => Promise<boolean> | boolean;
};

export type ExternalEscalation = {
  escalationKey: string;
  action: "user_action_required";
  reason: string;
  observedAt: Date;
};

export type AutonomousWorkSummary = {
  workId: string;
  title: string;
  ownerModule: string;
  state: AutonomousWorkState;
  attempts: number;
  nextRunAt: Date | null;
  runId: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  checkpointPhase: string | null;
  verificationEvidenceId: string | null;
  lastError: string | null;
  dependencyState: "satisfied" | "unmet" | "missing" | "cycle";
  updatedAt: Date;
};

export type AutonomousOperationsAuditEvent = {
  eventId: string;
  at: Date;
  workId: string | null;
  event:
    | "coordinator_started"
    | "coordinator_stopped"
    | "work_planned"
    | "work_accepted_internally"
    | "work_started"
    | "work_heartbeat"
    | "checkpoint_recorded"
    | "work_validating"
    | "work_verified"
    | "work_retry_scheduled"
    | "work_failed"
    | "work_blocked"
    | "work_stalled"
    | "observation_changed"
    | "external_user_escalation";
  reason: string;
};

export type AutonomousOperationsSnapshot = {
  schemaVersion: number;
  running: boolean;
  recovered: boolean;
  observedAt: Date;
  maxConcurrent: number;
  observation: OperationsObservation | null;
  workItems: AutonomousWorkSummary[];
  externalPlatform: {
    taskBoard: "unobservable_external_boundary";
    affectsApplicationHealth: false;
    reason: string;
    userEscalations: ExternalEscalation[];
  };
  persistence: { state: "ready" | "unavailable" | "not_configured"; lastError: string | null };
  recentAudit: AutonomousOperationsAuditEvent[];
  reason: string;
  auditHash: string;
};

type WorkRecord = {
  definition: Required<Omit<AutonomousWorkDefinition, "dependsOn" | "resourceClaims" | "validate">> & {
    dependsOn: string[];
    resourceClaims: string[];
    validate: AutonomousWorkDefinition["validate"];
  };
  state: AutonomousWorkState;
  attempts: number;
  nextRunAt: Date | null;
  runId: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  checkpoint: {
    phase: string;
    attempt: number;
    details: Record<string, string | number | boolean | null>;
  } | null;
  verificationEvidence: { summary: string; details: Record<string, string | number | boolean | null> } | null;
  lastError: string | null;
  blocker: "dependency_unmet" | "external_platform" | "missing_handler" | "recovery_unverified" | null;
  createdAt: Date;
  updatedAt: Date;
};

function safeText(value: string, max = 360): string {
  return value
    .replace(/(?:sk|pk|rk|db)[-_][a-z0-9_-]{12,}/gi, "[redacted]")
    .replace(/[\r\n]/g, " ")
    .slice(0, max);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function dependencyState(
  work: WorkRecord,
  records: Map<string, WorkRecord>,
): AutonomousWorkSummary["dependencyState"] {
  const visiting = new Set<string>();
  const visit = (workId: string): AutonomousWorkSummary["dependencyState"] => {
    if (visiting.has(workId)) return "cycle";
    const dependency = records.get(workId);
    if (!dependency) return "missing";
    visiting.add(workId);
    for (const nested of dependency.definition.dependsOn) {
      const nestedState = visit(nested);
      if (nestedState !== "satisfied") {
        visiting.delete(workId);
        return nestedState;
      }
    }
    visiting.delete(workId);
    return dependency.state === "verified" ? "satisfied" : "unmet";
  };
  for (const key of work.definition.dependsOn) {
    const state = visit(key);
    if (state !== "satisfied") return state;
  }
  return "satisfied";
}

/**
 * Process-owned, static-handler queue. It intentionally has no shell, network,
 * Replit Task Board, Agent-session, or workflow control API.
 */
export class AutonomousOperationsCoordinator {
  private readonly definitions = new Map<string, AutonomousWorkDefinition>();
  private readonly records = new Map<string, WorkRecord>();
  private readonly audit: AutonomousOperationsAuditEvent[] = [];
  private readonly escalations = new Map<string, ExternalEscalation>();
  private running = false;
  private stopping = false;
  private startGeneration = 0;
  private recovered = false;
  private tickInFlight = false;
  private monitor: NodeJS.Timeout | null = null;
  private ordinal = 0;
  private observation: OperationsObservation | null = null;
  private lastObservationHash: string | null = null;
  private getObservation: (() => OperationsObservation) | null = null;
  private readonly activeExecutionRuns = new Set<string>();
  private readonly activeControllers = new Map<string, AbortController>();
  private executionSuspended = false;
  private suspensionReason: string | null = null;

  constructor(private readonly persistence: OperationsPersistence | null = null) {}

  async register(definition: AutonomousWorkDefinition, now = new Date()): Promise<{ accepted: boolean; reason: string }> {
    if (this.stopping) return { accepted: false, reason: "Coordinator shutdown is in progress; no work can be registered." };
    if (this.definitions.has(definition.workId)) return { accepted: false, reason: "Static work identity is already registered." };
    if ([...this.definitions.values()].some((item) => item.implementationKey === definition.implementationKey)) {
      return { accepted: false, reason: "Static implementation identity is already registered." };
    }
    this.definitions.set(definition.workId, definition);
    if (!this.recovered) return { accepted: true, reason: "Static handler registered for recovery-safe startup." };
    return this.admitDefinition(definition, now);
  }

  async start(options: { getObservation: () => OperationsObservation }, now = new Date()): Promise<void> {
    if (this.running || this.stopping) return;
    const generation = ++this.startGeneration;
    this.getObservation = options.getObservation;
    await this.recover(now);
    if (this.stopping || generation !== this.startGeneration) return;
    this.running = true;
    this.record(null, "coordinator_started", "Project-owned operations coordinator started. Replit Task Board state is not queried or controlled.", now);
    this.monitor = setInterval(() => {
      void this.tick(new Date());
    }, AUTONOMOUS_OPERATIONS_INSPECTION_INTERVAL_MS);
    this.monitor.unref();
    await this.tick(now);
  }

  async stop(now = new Date()): Promise<void> {
    this.stopping = true;
    this.startGeneration += 1;
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    if (!this.running) return;
    this.running = false;
    for (const controller of this.activeControllers.values()) controller.abort();
    const blockingWrites: Promise<void>[] = [];
    for (const work of this.records.values()) {
      if (work.state !== "running" && work.state !== "validating") continue;
      blockingWrites.push(this.blockUnverified(
        work,
        "Coordinator process stopped before current execution could be verified. Automatic replay is prohibited.",
        now,
      ));
    }
    this.record(null, "coordinator_stopped", "Coordinator stopped; no external platform action was attempted.", now);
    await Promise.all(blockingWrites);
  }

  async acceptInternally(workId: string, now = new Date()): Promise<{ accepted: boolean; reason: string }> {
    if (this.stopping) return { accepted: false, reason: "Coordinator shutdown is in progress; internal acceptance is withheld." };
    const work = this.records.get(workId);
    if (!work) return { accepted: false, reason: "Work identity is not registered." };
    if (work.state !== "planned" && work.state !== "blocked" && work.state !== "stalled") {
      return { accepted: false, reason: `Work state ${work.state} cannot be accepted.` };
    }
    if (work.blocker === "recovery_unverified") {
      return { accepted: false, reason: "A prior execution has no durable terminal record. Automatic re-execution is prohibited until an operator replaces it with a new, idempotent static work definition." };
    }
    const dependency = dependencyState(work, this.records);
    if (dependency !== "satisfied") {
      work.state = "blocked";
      work.blocker = "dependency_unmet";
      work.lastError = `Dependencies are ${dependency}; internal acceptance is withheld.`;
      work.updatedAt = now;
      await this.commitWork(work, "Dependency block could not be durably recorded.");
      this.record(workId, "work_blocked", work.lastError, now);
      return { accepted: false, reason: work.lastError };
    }
    work.state = "internally_accepted";
    work.blocker = null;
    work.lastError = null;
    work.nextRunAt = now;
    work.updatedAt = now;
    if (!await this.commitWork(work, "Internal acceptance could not be durably recorded.")) {
      return { accepted: false, reason: "Durable operations storage is unavailable; internal execution is withheld." };
    }
    this.record(workId, "work_accepted_internally", "Work accepted by the project-owned coordinator.", now);
    return { accepted: true, reason: "Work accepted internally." };
  }

  recordExternalUserEscalation(escalationKey: string, reason: string, now = new Date()): ExternalEscalation {
    const record: ExternalEscalation = {
      escalationKey: safeText(escalationKey, 160),
      action: "user_action_required",
      reason: safeText(reason, 360),
      observedAt: now,
    };
    this.escalations.set(record.escalationKey, record);
    this.record(null, "external_user_escalation", record.reason, now);
    return record;
  }

  heartbeat(workId: string, runId: string, now = new Date()): boolean {
    const work = this.records.get(workId);
    if (!work || work.state !== "running" || work.runId !== runId) return false;
    work.lastHeartbeatAt = now;
    work.leaseExpiresAt = new Date(now.getTime() + work.definition.executionTimeoutMs);
    work.updatedAt = now;
    void this.commitWork(work, "Heartbeat could not be durably recorded.", runId).then((saved) => {
      if (saved) this.record(workId, "work_heartbeat", "Internal execution heartbeat accepted.", now);
    });
    return true;
  }

  checkpoint(
    workId: string,
    runId: string,
    phase: string,
    details: Record<string, string | number | boolean | null>,
    now = new Date(),
  ): boolean {
    const work = this.records.get(workId);
    if (!work || work.state !== "running" || work.runId !== runId) return false;
    work.checkpoint = { phase: safeText(phase, 120), attempt: work.attempts, details };
    work.updatedAt = now;
    void this.commitWork(work, "Checkpoint could not be durably recorded.", runId).then((saved) => {
      if (saved) this.record(workId, "checkpoint_recorded", "Bounded operational checkpoint recorded; it cannot confer market freshness or Alert authority.", now);
    });
    return true;
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.running || this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      this.refreshObservation(now);
      await this.inspect(now);
      await this.runNext(now);
    } finally {
      this.tickInFlight = false;
    }
  }

  private async inspect(now = new Date()): Promise<void> {
    for (const work of this.records.values()) {
      const dependencies = dependencyState(work, this.records);
      if (work.state === "blocked" && work.blocker === "dependency_unmet" && dependencies === "satisfied") {
        work.state = "internally_accepted";
        work.blocker = null;
        work.lastError = null;
        work.nextRunAt = now;
        work.updatedAt = now;
        await this.commitWork(work, "Dependency release could not be durably recorded.");
        this.record(work.definition.workId, "work_accepted_internally", "Dependencies became verified; internal work can now run.", now);
      }
      if (
        (work.state === "running" || work.state === "validating")
        && work.lastHeartbeatAt
        && now.getTime() - work.lastHeartbeatAt.getTime() >= work.definition.executionTimeoutMs
      ) {
        await this.blockUnverified(
          work,
          "Execution heartbeat became stale before a terminal result was verified. Automatic replay is prohibited.",
          now,
        );
      }
    }
  }

  getSnapshot(now = new Date()): AutonomousOperationsSnapshot {
    const workItems = [...this.records.values()]
      .map((work) => this.summary(work))
      .sort((left, right) => left.workId.localeCompare(right.workId));
    const unsigned = {
      schemaVersion: AUTONOMOUS_OPERATIONS_SCHEMA_VERSION,
      running: this.running,
      recovered: this.recovered,
      observedAt: now,
      maxConcurrent: AUTONOMOUS_OPERATIONS_MAX_CONCURRENT,
      observation: this.observation,
      workItems,
      externalPlatform: {
        taskBoard: "unobservable_external_boundary" as const,
        affectsApplicationHealth: false as const,
        reason: "Replit Task Board, Agent sessions, Build mode, and account concurrency are outside this process. Their state cannot accept, run, or verify internal operations.",
        userEscalations: [...this.escalations.values()].sort((left, right) => left.escalationKey.localeCompare(right.escalationKey)),
      },
      persistence: this.persistence
        ? this.persistence.getHealth()
        : { state: "not_configured" as const, lastError: null },
      recentAudit: this.audit.slice(-40),
      reason: this.executionSuspended
        ? `Operations execution is suspended: ${this.suspensionReason ?? "durable persistence is uncertain"}.`
        : "Only registered static handlers with a current internal lease may run. Operations output is diagnostic only and is never consumed by market, scoring, candidate, or Alert decisions.",
    };
    return { ...unsigned, auditHash: digest(unsigned) };
  }

  private async recover(now: Date): Promise<void> {
    const persisted = this.persistence ? await this.persistence.loadWork() : [];
    if (this.persistence?.getHealth().state === "unavailable") {
      this.suspendExecution("Initial durable operations recovery could not be loaded.");
    }
    for (const item of persisted) {
      const definition = this.definitions.get(item.workId);
      if (!definition || definition.implementationKey !== item.implementationKey) {
        continue;
      }
      const record = this.toRecord(item, definition);
      if (record.state === "running" || record.state === "validating") {
        const recoveredRunId = record.runId ?? undefined;
        record.state = "blocked";
        record.runId = null;
        record.leaseExpiresAt = null;
        record.nextRunAt = null;
        record.blocker = "recovery_unverified";
        record.lastError = "Recovered with no durable terminal result for a prior execution. Automatic replay is prohibited to prevent duplicate side effects.";
        record.updatedAt = now;
        this.records.set(record.definition.workId, record);
        await this.commitWork(record, "Restart recovery state could not be durably recorded.", recoveredRunId);
        continue;
      }
      this.records.set(record.definition.workId, record);
      await this.commitWork(record, "Restart recovery state could not be durably recorded.");
    }
    for (const definition of this.definitions.values()) {
      if (!this.records.has(definition.workId)) await this.admitDefinition(definition, now);
    }
    this.recovered = true;
  }

  private async admitDefinition(definition: AutonomousWorkDefinition, now: Date): Promise<{ accepted: boolean; reason: string }> {
    if (this.records.has(definition.workId)) return { accepted: false, reason: "Work identity already exists." };
    if ([...this.records.values()].some((work) => work.definition.implementationKey === definition.implementationKey)) {
      return { accepted: false, reason: "Implementation identity already exists." };
    }
    const normalized = this.normalizeDefinition(definition);
    const record: WorkRecord = {
      definition: normalized,
      state: "planned",
      attempts: 0,
      nextRunAt: null,
      runId: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      checkpoint: null,
      verificationEvidence: null,
      lastError: null,
      blocker: null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(definition.workId, record);
    await this.commitWork(record, "Planned work could not be durably recorded.");
    this.record(definition.workId, "work_planned", "Static internal work was registered without external platform action.", now);
    return { accepted: true, reason: "Static work registered." };
  }

  private normalizeDefinition(definition: AutonomousWorkDefinition): WorkRecord["definition"] {
    return {
      ...definition,
      dependsOn: [...(definition.dependsOn ?? [])],
      resourceClaims: [...(definition.resourceClaims ?? [])],
      maxAttempts: Math.max(1, Math.min(5, definition.maxAttempts ?? 3)),
      retryBaseDelayMs: Math.max(1_000, Math.min(5 * 60_000, definition.retryBaseDelayMs ?? 5_000)),
      executionTimeoutMs: Math.max(1_000, Math.min(60_000, definition.executionTimeoutMs ?? 15_000)),
      validate: definition.validate,
    };
  }

  private toRecord(item: PersistedOperationsWork, definition: AutonomousWorkDefinition): WorkRecord {
    const allowedStates = new Set<AutonomousWorkState>([
      "planned", "internally_accepted", "running", "validating", "verified", "failed", "blocked", "blocked_external", "stalled",
    ]);
    return {
      definition: this.normalizeDefinition(definition),
      state: allowedStates.has(item.state as AutonomousWorkState) ? item.state as AutonomousWorkState : "blocked",
      attempts: item.attempts,
      nextRunAt: item.nextRunAt,
      runId: item.runId,
      leaseExpiresAt: item.leaseExpiresAt,
      lastHeartbeatAt: item.lastHeartbeatAt,
      checkpoint: item.checkpoint,
      verificationEvidence: item.verificationEvidence,
      lastError: item.lastError,
      blocker: item.state === "blocked_external"
        ? "external_platform"
        : item.state === "blocked" && item.lastError?.includes("Automatic replay is prohibited")
          ? "recovery_unverified"
          : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private refreshObservation(now: Date): void {
    if (!this.getObservation) return;
    const observation = this.getObservation();
    const observationHash = digest(observation);
    this.observation = observation;
    if (this.lastObservationHash === observationHash) return;
    this.lastObservationHash = observationHash;
    this.record(null, "observation_changed", observation.reason, now);
  }

  private async runNext(now: Date): Promise<void> {
    if (this.executionSuspended) return;
    if (this.persistence && this.persistence.getHealth().state !== "ready") return;
    if (this.activeExecutionRuns.size >= AUTONOMOUS_OPERATIONS_MAX_CONCURRENT) return;
    const active = [...this.records.values()].filter((work) => work.state === "running" || work.state === "validating");
    const work = [...this.records.values()].find((candidate) => (
      (candidate.state === "internally_accepted" || candidate.state === "stalled")
      && candidate.nextRunAt !== null
      && candidate.nextRunAt.getTime() <= now.getTime()
      && dependencyState(candidate, this.records) === "satisfied"
      && !active.some((running) => running.definition.resourceClaims.some((claim) => candidate.definition.resourceClaims.includes(claim)))
    ));
    if (!work) return;

    const proposedRunId = `${work.definition.workId}:${digest(`${now.toISOString()}:${work.attempts + 1}`).slice(0, 16)}`;
    const proposedLeaseExpiry = new Date(now.getTime() + work.definition.executionTimeoutMs);
    if (this.persistence) {
      const claim = await this.persistence.claimWork({
        workId: work.definition.workId,
        runId: proposedRunId,
        now,
        leaseExpiresAt: proposedLeaseExpiry,
      });
      if (!claim) {
        if (this.persistence.getHealth().state === "unavailable") {
          this.suspendExecution("Atomic work claim could not be confirmed.");
        }
        return;
      }
      work.state = "running";
      work.attempts = claim.attempts;
      work.runId = claim.runId;
      work.lastHeartbeatAt = claim.lastHeartbeatAt;
      work.leaseExpiresAt = claim.leaseExpiresAt;
      work.nextRunAt = null;
      work.lastError = null;
      work.updatedAt = claim.updatedAt;
    } else {
      work.state = "running";
      work.attempts += 1;
      work.runId = proposedRunId;
      work.lastHeartbeatAt = now;
      work.leaseExpiresAt = proposedLeaseExpiry;
      work.nextRunAt = null;
      work.lastError = null;
      work.updatedAt = now;
    }
    this.record(work.definition.workId, "work_started", "Registered static internal work started with a fresh lease.", now);

    const runId = work.runId;
    const controller = new AbortController();
    const handler = Promise.resolve().then(() => work.definition.handler({
      workId: work.definition.workId,
      attempt: work.attempts,
      now,
      signal: controller.signal,
      heartbeat: () => this.heartbeat(work.definition.workId, runId, new Date()),
      checkpoint: (phase, details) => this.checkpoint(work.definition.workId, runId, phase, details, new Date()),
    }));
    const handlerExecutionKey = `${runId}:handler`;
    this.activeExecutionRuns.add(handlerExecutionKey);
    this.activeControllers.set(runId, controller);
    void handler.then(
      () => {
        this.finishExecutionRun(runId, handlerExecutionKey);
      },
      () => {
        this.finishExecutionRun(runId, handlerExecutionKey);
      },
    );
    const handlerResult = await this.withTimeout(handler, work.definition.executionTimeoutMs, controller);
    if (!handlerResult.ok) {
      if (handlerResult.unsettled) {
        await this.blockUnverified(work, handlerResult.reason, now);
      } else {
        await this.scheduleRetry(work, handlerResult.reason, now);
      }
      return;
    }
    const result = handlerResult.value;
    if (work.runId !== runId || work.state !== "running") return;
    if (result.outcome === "retryable") {
      await this.scheduleRetry(work, result.reason, now);
      return;
    }
    if (result.outcome === "blocked_external") {
      work.state = "blocked_external";
      work.blocker = "external_platform";
      work.lastError = safeText(result.reason);
      work.updatedAt = now;
      if (await this.commitWork(work, "External block could not be durably recorded.", runId)) {
        this.record(work.definition.workId, "work_blocked", "External authorization/platform block recorded. The coordinator will not retry or control the external system.", now);
      }
      return;
    }
    if (result.outcome === "failed") {
      work.state = "failed";
      work.lastError = safeText(result.reason);
      work.updatedAt = now;
      if (await this.commitWork(work, "Failure outcome could not be durably recorded.", runId)) {
        this.record(work.definition.workId, "work_failed", work.lastError, now);
      }
      return;
    }
    work.state = "validating";
    work.lastHeartbeatAt = new Date();
    work.leaseExpiresAt = new Date(work.lastHeartbeatAt.getTime() + work.definition.executionTimeoutMs);
    work.updatedAt = work.lastHeartbeatAt;
    if (!await this.commitWork(work, "Validation lease could not be durably recorded.", runId)) return;
    this.record(work.definition.workId, "work_validating", "Handler completed; independent validation is required.", now);
    const validationPromise = work.definition.validate
      ? Promise.resolve().then(() => work.definition.validate!(result, {
          workId: work.definition.workId,
          attempt: work.attempts,
          signal: controller.signal,
        }))
      : Promise.resolve(true);
    const validationExecutionKey = `${runId}:validation`;
    this.activeExecutionRuns.add(validationExecutionKey);
    this.activeControllers.set(runId, controller);
    void validationPromise.then(
      () => this.finishExecutionRun(runId, validationExecutionKey),
      () => this.finishExecutionRun(runId, validationExecutionKey),
    );
    const validation = await this.withTimeout(
      validationPromise,
      work.definition.executionTimeoutMs,
      controller,
    );
    if (!validation.ok) {
      if (validation.unsettled) {
        await this.blockUnverified(work, validation.reason, now);
      } else {
        await this.scheduleRetry(work, validation.reason, now);
      }
      return;
    }
    if (work.runId !== runId || work.state !== "validating") return;
    if (!validation.value) {
      work.state = "failed";
      work.lastError = "Independent validation rejected the handler result.";
      work.updatedAt = now;
      if (await this.commitWork(work, "Validation rejection could not be durably recorded.", runId)) {
        this.record(work.definition.workId, "work_failed", work.lastError, now);
      }
      return;
    }
    work.state = "verified";
    work.verificationEvidence = { summary: safeText(result.reason, 320), details: result.evidence };
    work.updatedAt = now;
    if (await this.commitWork(work, "Verification outcome could not be durably recorded.", runId)) {
      this.record(work.definition.workId, "work_verified", "Static handler and independent validation both passed.", now);
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    controller: AbortController,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string; unsettled: boolean }> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        operation.then((value) => ({ ok: true as const, value })),
        new Promise<{ ok: false; reason: string; unsettled: true }>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({
              ok: false,
              unsettled: true,
              reason: "Registered execution exceeded its bounded timeout and received an abort signal. Automatic replay is prohibited until the work is explicitly replaced.",
            });
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      return { ok: false, unsettled: false, reason: safeText(error instanceof Error ? error.message : String(error)) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async scheduleRetry(work: WorkRecord, reason: string, now: Date): Promise<void> {
    const expectedRunId = work.runId ?? undefined;
    if (work.attempts >= work.definition.maxAttempts) {
      work.state = "failed";
      work.lastError = safeText(`${reason} Retry budget exhausted.`);
      work.updatedAt = now;
      if (await this.commitWork(work, "Retry exhaustion could not be durably recorded.", expectedRunId)) {
        this.record(work.definition.workId, "work_failed", work.lastError, now);
      }
      return;
    }
    const delay = work.definition.retryBaseDelayMs * (2 ** Math.max(0, work.attempts - 1));
    work.state = "stalled";
    work.runId = null;
    work.leaseExpiresAt = null;
    work.lastError = safeText(reason);
    work.nextRunAt = new Date(now.getTime() + delay);
    work.updatedAt = now;
    if (await this.commitWork(work, "Retry schedule could not be durably recorded.", expectedRunId)) {
      this.record(work.definition.workId, "work_retry_scheduled", `${work.lastError} Retrying after bounded backoff.`, now);
    }
  }

  private async blockUnverified(work: WorkRecord, reason: string, now: Date): Promise<void> {
    const expectedRunId = work.runId ?? undefined;
    work.state = "blocked";
    work.runId = null;
    work.leaseExpiresAt = null;
    work.nextRunAt = null;
    work.blocker = "recovery_unverified";
    work.lastError = safeText(reason);
    work.updatedAt = now;
    if (await this.commitWork(work, "Unverified execution block could not be durably recorded.", expectedRunId)) {
      this.record(work.definition.workId, "work_blocked", work.lastError, now);
    }
  }

  private finishExecutionRun(runId: string, executionKey: string): void {
    this.activeExecutionRuns.delete(executionKey);
    if (![...this.activeExecutionRuns].some((key) => key.startsWith(`${runId}:`))) {
      this.activeControllers.delete(runId);
    }
  }

  private async persistWork(work: WorkRecord, expectedRunId?: string): Promise<boolean> {
    if (!this.persistence) return true;
    const saved = await this.persistence.saveWork({
      workId: work.definition.workId,
      title: work.definition.title,
      ownerModule: work.definition.ownerModule,
      implementationKey: work.definition.implementationKey,
      state: work.state,
      dependsOn: work.definition.dependsOn,
      resourceClaims: work.definition.resourceClaims,
      attempts: work.attempts,
      maxAttempts: work.definition.maxAttempts,
      retryBaseDelayMs: work.definition.retryBaseDelayMs,
      executionTimeoutMs: work.definition.executionTimeoutMs,
      nextRunAt: work.nextRunAt,
      runId: work.runId,
      leaseExpiresAt: work.leaseExpiresAt,
      lastHeartbeatAt: work.lastHeartbeatAt,
      checkpoint: work.checkpoint,
      verificationEvidence: work.verificationEvidence,
      lastError: work.lastError,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
    }, { expectedRunId });
    return saved;
  }

  private async commitWork(work: WorkRecord, reason: string, expectedRunId = work.runId ?? undefined): Promise<boolean> {
    if (await this.persistWork(work, expectedRunId)) return true;
    work.state = "blocked";
    work.runId = null;
    work.leaseExpiresAt = null;
    work.nextRunAt = null;
    work.blocker = "recovery_unverified";
    work.lastError = safeText(`${reason} Automatic replay is prohibited until durable state is restored.`);
    work.updatedAt = new Date();
    this.suspendExecution(work.lastError);
    return false;
  }

  private suspendExecution(reason: string): void {
    this.executionSuspended = true;
    this.suspensionReason = safeText(reason);
  }

  private summary(work: WorkRecord): AutonomousWorkSummary {
    return {
      workId: work.definition.workId,
      title: work.definition.title,
      ownerModule: work.definition.ownerModule,
      state: work.state,
      attempts: work.attempts,
      nextRunAt: work.nextRunAt,
      runId: work.runId,
      leaseExpiresAt: work.leaseExpiresAt,
      lastHeartbeatAt: work.lastHeartbeatAt,
      checkpointPhase: work.checkpoint?.phase ?? null,
      verificationEvidenceId: work.verificationEvidence ? digest(work.verificationEvidence).slice(0, 24) : null,
      lastError: work.lastError,
      dependencyState: dependencyState(work, this.records),
      updatedAt: work.updatedAt,
    };
  }

  private record(workId: string | null, event: AutonomousOperationsAuditEvent["event"], reason: string, at: Date): void {
    const entry: AutonomousOperationsAuditEvent = {
      eventId: digest(`${workId ?? "coordinator"}:${event}:${at.toISOString()}:${this.ordinal}`).slice(0, 24),
      at,
      workId,
      event,
      reason: safeText(reason),
    };
    this.ordinal += 1;
    this.audit.push(entry);
    if (this.audit.length > AUTONOMOUS_OPERATIONS_MAX_AUDIT_EVENTS) this.audit.shift();
    if (!this.persistence) return;
    void this.persistence.appendAudit({
      workId,
      event,
      reason: entry.reason,
      evidence: { summary: entry.reason, details: {} },
      occurredAt: at,
    });
  }
}
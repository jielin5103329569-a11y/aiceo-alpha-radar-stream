import { createHash } from "node:crypto";

import type { BackendLifelineSnapshot } from "./backendLifeline";
import type { InternalTaskSummary } from "./internalTaskRegistry";
import { logger } from "./logger";
import {
  RuntimeIncidentStore,
  type RuntimeIncidentInput,
  type RuntimeIncidentSeverity,
  type RuntimeIncidentState,
} from "./runtimeIncidentStore";

export const RUNTIME_SUPERVISOR_SCHEMA_VERSION = 1;
export const RUNTIME_SUPERVISOR_INSPECTION_INTERVAL_MS = 10_000;
export const RUNTIME_SUPERVISOR_MAX_RECOVERY_ATTEMPTS = 3;
export const RUNTIME_SUPERVISOR_RECOVERY_BASE_DELAY_MS = 15_000;
export const RUNTIME_SUPERVISOR_PERSIST_TIMEOUT_MS = 3_000;
export const RUNTIME_SUPERVISOR_PERSIST_QUEUE_MAX = 12;
export const RUNTIME_SUPERVISOR_PERSIST_RETRY_COOLDOWN_MS = 60_000;

export type RuntimeSupervisorState = "healthy" | "degraded" | "recovering" | "blocked";
export type RuntimeSupervisorComponent =
  | "process"
  | "live_feed"
  | "alert_service"
  | "internal_execution"
  | "dashboard_delivery"
  | "persistence";

export type RuntimeSupervisorIncidentSummary = {
  incidentKey: string;
  component: RuntimeSupervisorComponent;
  reasonCode: string;
  severity: RuntimeIncidentSeverity;
  state: RuntimeIncidentState;
  firstDetectedAt: Date;
  lastObservedAt: Date;
  recoveryAttempts: number;
  nextRecoveryAt: Date | null;
  reason: string;
};

export type RuntimeSupervisorSnapshot = {
  schemaVersion: number;
  observedAt: Date;
  running: boolean;
  startedAt: Date | null;
  lastInspectionAt: Date | null;
  state: RuntimeSupervisorState;
  reason: string;
  application: {
    process: "healthy" | "degraded" | "blocked";
    liveFeed: "healthy" | "recovering" | "degraded";
    alertService: "healthy" | "degraded";
    internalExecution: "healthy" | "recovering" | "degraded" | "blocked";
    dashboardDelivery: {
      state: "observational_only";
      activeSseConnections: number;
    };
  };
  externalPlatform: {
    taskControlPlane: "unobservable";
    affectsApplicationHealth: false;
    reason: string;
  };
  persistence: {
    state: "ready" | "unavailable";
    lastPersistedAt: Date | null;
    lastErrorAt: Date | null;
    lastError: string | null;
  };
  recovery: {
    maxAttempts: number;
    activeAttempts: number;
    nextEligibleAt: Date | null;
    reason: string;
  };
  incidents: RuntimeSupervisorIncidentSummary[];
  auditHash: string;
};

export type RuntimeSupervisorInputs = {
  getLifeline: (now: Date) => BackendLifelineSnapshot;
  getDashboardDelivery: () => { activeSseConnections: number };
  reclaimInternalTask: (taskKey: string, operatorId: string, now: Date) => {
    accepted: boolean;
    task: Pick<InternalTaskSummary, "state"> | null;
    reason: string;
  };
};

export type RuntimeSupervisorOptions = {
  persistenceTimeoutMs?: number;
  persistenceQueueMax?: number;
};

type ActiveIncident = RuntimeSupervisorIncidentSummary & {
  lastPersistedAt: Date;
};

type IncidentCandidate = {
  incidentKey: string;
  component: RuntimeSupervisorComponent;
  reasonCode: string;
  severity: RuntimeIncidentSeverity;
  reason: string;
  componentState: string;
  details: Record<string, string | number | boolean | null>;
  recoverableTask: InternalTaskSummary | null;
};

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function stateFor(candidates: IncidentCandidate[], incidents: ActiveIncident[]): RuntimeSupervisorState {
  if (candidates.some((candidate) => candidate.component === "process")) return "blocked";
  if (incidents.some((incident) => incident.state === "recovering")) return "recovering";
  return candidates.length > 0 ? "degraded" : "healthy";
}

/**
 * One server-owned, bounded observer. It does not query or control the Replit
 * Task Board. It only reclaims an already expired local internal-task lease;
 * Databento owns feed recovery and AlertService remains read-only supervised.
 */
export class RuntimeSupervisor {
  private readonly store: RuntimeIncidentStore;
  private inputs: RuntimeSupervisorInputs | null = null;
  private monitor: NodeJS.Timeout | null = null;
  private running = false;
  private startedAt: Date | null = null;
  private lastInspectionAt: Date | null = null;
  private lastSnapshot: RuntimeSupervisorSnapshot | null = null;
  private readonly activeIncidents = new Map<string, ActiveIncident>();
  private readonly persistenceTimeoutMs: number;
  private readonly persistenceQueueMax: number;
  private readonly persistenceQueue: RuntimeIncidentInput[] = [];
  private persistenceWorker: Promise<void> | null = null;
  private persistenceWriteHanging = false;
  private persistenceBlockedUntil = 0;
  private inspectionInFlight = false;
  private dashboardDelivery = { activeSseConnections: 0 };
  private lastCandidates: IncidentCandidate[] = [];

  constructor(store = new RuntimeIncidentStore(), options: RuntimeSupervisorOptions = {}) {
    this.store = store;
    this.persistenceTimeoutMs = options.persistenceTimeoutMs ?? RUNTIME_SUPERVISOR_PERSIST_TIMEOUT_MS;
    this.persistenceQueueMax = options.persistenceQueueMax ?? RUNTIME_SUPERVISOR_PERSIST_QUEUE_MAX;
  }

  start(inputs: RuntimeSupervisorInputs, now = new Date()): void {
    if (this.running) return;
    this.inputs = inputs;
    this.running = true;
    this.startedAt = now;
    this.inspect(now).catch((error) => {
      logger.warn({ error }, "Initial runtime supervisor inspection failed without affecting production services");
    });
    this.monitor = setInterval(() => {
      this.inspect(new Date()).catch((error) => {
        logger.warn({ error }, "Runtime supervisor inspection failed without affecting production services");
      });
    }, RUNTIME_SUPERVISOR_INSPECTION_INTERVAL_MS);
    this.monitor.unref();
    logger.info("Runtime supervisor started as a bounded, server-owned observer");
  }

  stop(): void {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    this.running = false;
    this.inputs = null;
    logger.info("Runtime supervisor stopped");
  }

  getSnapshot(now = new Date()): RuntimeSupervisorSnapshot {
    if (this.lastSnapshot) {
      return this.buildSnapshot(now, this.lastCandidates, [...this.activeIncidents.values()]);
    }
    return this.buildSnapshot(now, [], []);
  }

  async listRecentIncidents(limit = 20) {
    return this.store.listRecent(limit);
  }

  async inspect(now = new Date()): Promise<RuntimeSupervisorSnapshot> {
    if (this.inspectionInFlight || !this.inputs) return this.getSnapshot(now);
    this.inspectionInFlight = true;
    try {
      const lifeline = this.inputs.getLifeline(now);
      this.dashboardDelivery = this.inputs.getDashboardDelivery();
      const candidates = this.findCandidates(lifeline);
      this.lastCandidates = candidates;
      const currentKeys = new Set(candidates.map((candidate) => candidate.incidentKey));

      for (const candidate of candidates) {
        await this.observeCandidate(candidate, now);
      }
      for (const [incidentKey, incident] of [...this.activeIncidents.entries()]) {
        if (currentKeys.has(incidentKey)) continue;
        const resolvedAt = now;
        this.activeIncidents.delete(incidentKey);
        this.persist({
          incidentKey,
          component: incident.component,
          reasonCode: incident.reasonCode,
          severity: incident.severity,
          state: "resolved",
          event: "resolved",
          reason: "The current read-only supervisor snapshot no longer reports this condition.",
          evidence: {
            summary: "Condition cleared without using market state as recovery proof.",
            componentState: "resolved",
            details: {},
          },
          occurredAt: resolvedAt,
        });
      }
      const incidentSummaries = [...this.activeIncidents.values()]
        .sort((left, right) => right.lastObservedAt.getTime() - left.lastObservedAt.getTime());
      this.lastInspectionAt = now;
      this.lastSnapshot = this.buildSnapshot(now, candidates, incidentSummaries);
      return this.lastSnapshot;
    } finally {
      this.inspectionInFlight = false;
    }
  }

  private findCandidates(lifeline: BackendLifelineSnapshot): IncidentCandidate[] {
    const candidates: IncidentCandidate[] = [];
    if (lifeline.owner.listenerState !== "listening") {
      candidates.push({
        incidentKey: "process:listener_not_listening",
        component: "process",
        reasonCode: "listener_not_listening",
        severity: "critical",
        reason: lifeline.owner.lastError ?? "The server listener is not in its listening lifecycle state.",
        componentState: lifeline.owner.listenerState,
        details: { listenerState: lifeline.owner.listenerState, port: lifeline.owner.port },
        recoverableTask: null,
      });
    }
    if (lifeline.transport.errorSymbols > 0) {
      candidates.push({
        incidentKey: "live_feed:transport_error",
        component: "live_feed",
        reasonCode: "transport_error",
        severity: "warning",
        reason: lifeline.transport.reason,
        componentState: lifeline.transport.state,
        details: {
          transportState: lifeline.transport.state,
          errorSymbols: lifeline.transport.errorSymbols,
          recoveryPhase: lifeline.recovery.phase,
        },
        recoverableTask: null,
      });
    }
    if (lifeline.alertDelivery.health !== "healthy") {
      candidates.push({
        incidentKey: `alert_service:${lifeline.alertDelivery.health}`,
        component: "alert_service",
        reasonCode: `alert_service_${lifeline.alertDelivery.health}`,
        severity: "warning",
        reason: lifeline.alertDelivery.reason,
        componentState: lifeline.alertDelivery.health,
        details: {
          serviceRunning: lifeline.alertDelivery.serviceRunning,
          capability: lifeline.alertDelivery.capability,
        },
        recoverableTask: null,
      });
    }
    for (const task of lifeline.internalTasks.tasks) {
      const recoveryBlocked = task.state === "blocked"
        && task.lastError?.includes("recovery is blocked") === true;
      if (task.state !== "timed_out" && task.state !== "zombie" && !recoveryBlocked) continue;
      candidates.push({
        incidentKey: `internal_execution:${task.taskKey}`,
        component: "internal_execution",
        reasonCode: recoveryBlocked
          ? "recovery_blocked"
          : task.state === "zombie"
            ? "zombie_lease"
            : "expired_lease",
        severity: "critical",
        reason: task.lastError ?? `Internal task ${task.taskKey} has an unsafe ${task.state} lease.`,
        componentState: task.state,
        details: {
          taskKey: task.taskKey,
          ownerModule: task.ownerModule,
          checkpointRecorded: task.checkpointRecordedAt !== null,
        },
        recoverableTask: recoveryBlocked ? null : task,
      });
    }
    return candidates;
  }

  private async observeCandidate(candidate: IncidentCandidate, now: Date): Promise<void> {
    const existing = this.activeIncidents.get(candidate.incidentKey);
    const incident: ActiveIncident = existing ?? {
      incidentKey: candidate.incidentKey,
      component: candidate.component,
      reasonCode: candidate.reasonCode,
      severity: candidate.severity,
      state: "open",
      firstDetectedAt: now,
      lastObservedAt: now,
      recoveryAttempts: 0,
      nextRecoveryAt: null,
      reason: candidate.reason,
      lastPersistedAt: new Date(0),
    };
    incident.lastObservedAt = now;
    incident.reasonCode = candidate.reasonCode;
    incident.reason = candidate.reason;

    if (!existing || now.getTime() - incident.lastPersistedAt.getTime() >= 60_000) {
      incident.lastPersistedAt = now;
      this.persist({
        incidentKey: incident.incidentKey,
        component: incident.component,
        reasonCode: incident.reasonCode,
        severity: incident.severity,
        state: incident.state,
        event: existing ? "observed" : "detected",
        reason: incident.reason,
        evidence: {
          summary: incident.reason,
          componentState: candidate.componentState,
          details: candidate.details,
        },
        occurredAt: now,
      });
    }

    if (candidate.recoverableTask) {
      this.attemptSafeLeaseRecovery(incident, candidate, now);
    }
    this.activeIncidents.set(incident.incidentKey, incident);
  }

  private attemptSafeLeaseRecovery(
    incident: ActiveIncident,
    candidate: IncidentCandidate,
    now: Date,
  ): void {
    if (!this.inputs || !candidate.recoverableTask) return;
    if (
      incident.recoveryAttempts >= RUNTIME_SUPERVISOR_MAX_RECOVERY_ATTEMPTS
      || (incident.nextRecoveryAt && now < incident.nextRecoveryAt)
    ) return;

    incident.recoveryAttempts += 1;
    incident.state = "recovering";
    const taskKey = candidate.recoverableTask.taskKey;
    const recovery = {
      action: "reclaim_expired_internal_lease",
      outcome: "scheduled" as const,
      reason: `Attempt ${incident.recoveryAttempts}/${RUNTIME_SUPERVISOR_MAX_RECOVERY_ATTEMPTS}: only reclaiming an already ${candidate.recoverableTask.state} local lease.`,
      attemptedAt: now.toISOString(),
    };
    this.persist({
      incidentKey: incident.incidentKey,
      component: incident.component,
      reasonCode: incident.reasonCode,
      severity: incident.severity,
      state: "recovering",
      event: "recovery_started",
      reason: recovery.reason,
      evidence: {
        summary: incident.reason,
        componentState: candidate.componentState,
        details: candidate.details,
      },
      recovery,
      occurredAt: now,
    });

    const outcome = this.inputs.reclaimInternalTask(taskKey, "runtime-supervisor", now);
    const delay = RUNTIME_SUPERVISOR_RECOVERY_BASE_DELAY_MS * (2 ** (incident.recoveryAttempts - 1));
    incident.nextRecoveryAt = new Date(now.getTime() + delay);
    const recoverySucceeded = outcome.accepted && outcome.task?.state === "recovering";
    incident.state = recoverySucceeded ? "recovering" : "open";
    const completedRecovery = {
      action: recovery.action,
      outcome: recoverySucceeded
        ? "succeeded" as const
        : outcome.accepted
          ? "failed" as const
          : "skipped" as const,
      reason: recoverySucceeded
        ? outcome.reason
        : outcome.accepted
          ? `${outcome.reason} The internal task is blocked and cannot resume without a checkpoint.`
          : outcome.reason,
      attemptedAt: now.toISOString(),
    };
    this.persist({
      incidentKey: incident.incidentKey,
      component: incident.component,
      reasonCode: incident.reasonCode,
      severity: incident.severity,
      state: incident.state,
      event: recoverySucceeded
        ? "recovery_succeeded"
        : outcome.accepted
          ? "recovery_failed"
          : "recovery_skipped",
      reason: completedRecovery.reason,
      evidence: {
        summary: incident.reason,
        componentState: candidate.componentState,
        details: candidate.details,
      },
      recovery: completedRecovery,
      occurredAt: now,
    });
  }

  private buildSnapshot(
    now: Date,
    candidates: IncidentCandidate[],
    incidents: ActiveIncident[],
  ): RuntimeSupervisorSnapshot {
    const state = stateFor(candidates, incidents);
    const persistence = this.store.getHealth();
    const nextEligibleAt = incidents
      .map((incident) => incident.nextRecoveryAt)
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    const application = {
      process: candidates.some((candidate) => candidate.component === "process")
        ? "blocked" as const
        : "healthy" as const,
      liveFeed: candidates.some((candidate) => candidate.component === "live_feed")
        ? "recovering" as const
        : "healthy" as const,
      alertService: candidates.some((candidate) => candidate.component === "alert_service")
        ? "degraded" as const
        : "healthy" as const,
      internalExecution: candidates.some((candidate) => candidate.component === "internal_execution")
        ? incidents.some((incident) => incident.component === "internal_execution" && incident.state === "recovering")
          ? "recovering" as const
          : "blocked" as const
        : "healthy" as const,
      dashboardDelivery: {
        state: "observational_only" as const,
        activeSseConnections: this.dashboardDelivery.activeSseConnections,
      },
    };
    const reason = state === "healthy"
      ? "The supervisor observes a healthy application lifecycle. Operational health remains separate from market evidence."
      : state === "recovering"
        ? "The supervisor is executing bounded local lease recovery only; fresh market events and existing fail-closed gates remain required."
        : state === "blocked"
          ? "The application listener is not safely running. This is an application lifecycle condition, not market evidence."
          : "One or more application components are constrained. The supervisor records them without changing market, scoring, or Alert state.";
    const unsigned = {
      schemaVersion: RUNTIME_SUPERVISOR_SCHEMA_VERSION,
      observedAt: now,
      running: this.running,
      startedAt: this.startedAt,
      lastInspectionAt: this.lastInspectionAt,
      state,
      reason,
      application,
      externalPlatform: {
        taskControlPlane: "unobservable" as const,
        affectsApplicationHealth: false as const,
        reason: "Replit background task-agent capacity, Planning sessions, Build gates, and Agent execution contexts are outside this application process and are never queried or treated as market or application health.",
      },
      persistence,
      recovery: {
        maxAttempts: RUNTIME_SUPERVISOR_MAX_RECOVERY_ATTEMPTS,
        activeAttempts: incidents.reduce((count, incident) => count + incident.recoveryAttempts, 0),
        nextEligibleAt,
        reason: "Only expired or zombie process-scoped internal leases may be reclaimed. Feed reconnect and AlertService lifecycle remain owned by their existing services.",
      },
      incidents: incidents.map(({ lastPersistedAt: _lastPersistedAt, ...incident }) => incident),
    };
    return { ...unsigned, auditHash: digest(unsigned) };
  }

  private persist(input: Parameters<RuntimeIncidentStore["record"]>[0]): void {
    if (this.persistenceWriteHanging || Date.now() < this.persistenceBlockedUntil) return;
    if (this.persistenceQueue.length >= this.persistenceQueueMax) {
      this.persistenceQueue.length = 0;
      this.notePersistenceFailure(new Error("Runtime supervisor audit queue reached its bounded capacity."));
      this.persistenceBlockedUntil = Date.now() + RUNTIME_SUPERVISOR_PERSIST_RETRY_COOLDOWN_MS;
      return;
    }
    this.persistenceQueue.push(input);
    if (!this.persistenceWorker) {
      this.persistenceWorker = this.drainPersistenceQueue();
    }
  }

  private async drainPersistenceQueue(): Promise<void> {
    try {
      while (
        this.persistenceQueue.length > 0
        && !this.persistenceWriteHanging
        && Date.now() >= this.persistenceBlockedUntil
      ) {
        const input = this.persistenceQueue.shift();
        if (!input) continue;
        const write = this.store.record(input);
        const outcome = await new Promise<"completed" | "timed_out" | { error: unknown }>((resolve) => {
          const timeout = setTimeout(() => resolve("timed_out"), this.persistenceTimeoutMs);
          timeout.unref();
          void write.then(
            () => {
              clearTimeout(timeout);
              resolve("completed");
            },
            (error) => {
              clearTimeout(timeout);
              resolve({ error });
            },
          );
        });
        if (outcome === "timed_out") {
          this.persistenceQueue.length = 0;
          this.persistenceWriteHanging = true;
          this.persistenceBlockedUntil = Date.now() + RUNTIME_SUPERVISOR_PERSIST_RETRY_COOLDOWN_MS;
          this.notePersistenceFailure(new Error("Runtime supervisor audit write timed out and was isolated."));
          void write.then(
            () => { this.persistenceWriteHanging = false; },
            () => { this.persistenceWriteHanging = false; },
          );
          return;
        }
        if (typeof outcome === "object" && "error" in outcome) {
          this.persistenceQueue.length = 0;
          this.persistenceBlockedUntil = Date.now() + RUNTIME_SUPERVISOR_PERSIST_RETRY_COOLDOWN_MS;
          this.notePersistenceFailure(outcome.error);
          return;
        }
        if (this.store.getHealth().state === "unavailable") {
          this.persistenceQueue.length = 0;
          this.persistenceBlockedUntil = Date.now() + RUNTIME_SUPERVISOR_PERSIST_RETRY_COOLDOWN_MS;
          return;
        }
      }
    } finally {
      this.persistenceWorker = null;
      if (
        this.persistenceQueue.length > 0
        && !this.persistenceWriteHanging
        && Date.now() >= this.persistenceBlockedUntil
      ) {
        this.persistenceWorker = this.drainPersistenceQueue();
      }
    }
  }

  private notePersistenceFailure(error: unknown): void {
    const store = this.store as RuntimeIncidentStore & { markUnavailable?: (reason: unknown) => void };
    store.markUnavailable?.(error);
    logger.warn(
      { error },
      "Runtime supervisor persistence failed without affecting application supervision",
    );
  }
}

export const runtimeSupervisor = new RuntimeSupervisor();
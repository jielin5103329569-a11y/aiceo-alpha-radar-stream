import { createHash } from "node:crypto";

import type {
  AlertServiceHealthSnapshot,
} from "./alertService";
import type { DatabentoLifelineSymbolHealth } from "./databentoLive";
import type { InternalTaskGovernanceSnapshot } from "./internalTaskRegistry";

export const BACKEND_LIFELINE_SCHEMA_VERSION = 1;
export const LIFELINE_SERVICE_NAME = "alpha-radar-api";

export type RuntimeEnvironment = "development" | "production" | "test";
export type LifelineState = "healthy" | "degraded" | "blocked";
export type ProcessLifecycleState = "starting" | "listening" | "stopping" | "stopped" | "failed";
export type LifelineRecoveryPhase =
  | "stopped"
  | "starting"
  | "reconnecting"
  | "awaiting_live_event"
  | "rebuilding_window"
  | "running";

export type BackendLifelineSnapshot = {
  schemaVersion: number;
  observedAt: Date;
  overall: {
    state: LifelineState;
    reason: string;
  };
  owner: {
    serviceName: string;
    ownerId: string;
    processId: number;
    environment: RuntimeEnvironment;
    port: number | null;
    listenerState: ProcessLifecycleState;
    claimedAt: Date | null;
    listeningAt: Date | null;
    stoppedAt: Date | null;
    duplicateStartAttempts: number;
    lastError: string | null;
  };
  transport: {
    state: "offline" | "connecting" | "connected" | "streaming" | "error" | "mixed";
    configuredSymbols: number;
    streamingSymbols: number;
    errorSymbols: number;
    reason: string;
  };
  heartbeat: {
    freshSymbols: number;
    staleSymbols: number;
    lastAt: Date | null;
    reason: string;
  };
  marketEvents: {
    freshSymbols: number;
    staleSymbols: number;
    missingSymbols: number;
    reason: string;
  };
  scanners: {
    scheduledSymbols: number;
    delayedSymbols: number;
    inactiveSymbols: number;
    reason: string;
  };
  recovery: {
    phase: LifelineRecoveryPhase;
    rebuildingSymbols: number;
    reason: string;
  };
  alertDelivery: {
    serviceRunning: boolean;
    capability: "available" | "unavailable";
    deliveriesAttempted: number;
    deliveriesSucceeded: number;
    deliveriesSkipped: number;
    deliveriesFailed: number;
    reason: string;
  };
  persistenceBoundary: {
    alertRecords: "database";
    userSubscriptions: "database";
    deliveryAudit: "database";
    marketWindow: "memory_rebuilt_after_restart";
    scannerState: "memory_rebuilt_after_restart";
    shadowLearning: "sidecar_not_on_lifeline";
    reason: string;
  };
  internalTasks: InternalTaskGovernanceSnapshot;
  symbols: DatabentoLifelineSymbolHealth[];
  auditHash: string;
};

type LifelineOwner = {
  ownerId: string;
  processId: number;
  environment: RuntimeEnvironment;
  port: number;
  claimedAt: Date;
  listeningAt: Date | null;
  stoppedAt: Date | null;
  listenerState: ProcessLifecycleState;
  duplicateStartAttempts: number;
  lastError: string | null;
};

function runtimeEnvironment(): RuntimeEnvironment {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "development";
}

function redactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:db|pk|sk)-[a-z0-9_-]{12,}/gi, "[redacted]")
    .slice(0, 320);
}

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

function auditHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export type LifelineOwnerClaim = {
  accepted: boolean;
  ownerId: string;
  reason: string;
};

/**
 * Owns the in-process lifecycle. Cross-process duplicate listeners are
 * rejected by the operating system's port binding; this guard handles
 * accidental duplicate bootstrap calls before they reach listen().
 */
export class BackendLifelineOwner {
  private owner: LifelineOwner | null = null;

  claim(port: number, now = new Date()): LifelineOwnerClaim {
    if (this.owner !== null) {
      this.owner.duplicateStartAttempts += 1;
      return {
        accepted: false,
        ownerId: this.owner.ownerId,
        reason: `Backend lifecycle is already owned by ${this.owner.ownerId}; duplicate start refused.`,
      };
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error(`Invalid backend listener port: ${port}`);
    }
    const environment = runtimeEnvironment();
    const ownerId = `${LIFELINE_SERVICE_NAME}:${environment}:${process.pid}`;
    this.owner = {
      ownerId,
      processId: process.pid,
      environment,
      port,
      claimedAt: now,
      listeningAt: null,
      stoppedAt: null,
      listenerState: "starting",
      duplicateStartAttempts: 0,
      lastError: null,
    };
    return {
      accepted: true,
      ownerId,
      reason: "Backend lifecycle ownership claimed by the server process.",
    };
  }

  markListening(now = new Date()): void {
    if (!this.owner) return;
    this.owner.listenerState = "listening";
    this.owner.listeningAt = now;
    this.owner.lastError = null;
  }

  markStopping(now = new Date()): void {
    if (!this.owner) return;
    this.owner.listenerState = "stopping";
    this.owner.stoppedAt = now;
  }

  markStopped(now = new Date()): void {
    if (!this.owner) return;
    this.owner.listenerState = "stopped";
    this.owner.stoppedAt = now;
  }

  markFailed(error: unknown): void {
    if (!this.owner) return;
    this.owner.listenerState = "failed";
    this.owner.lastError = redactError(error);
  }

  getOwner(): BackendLifelineSnapshot["owner"] {
    if (!this.owner) {
      return {
        serviceName: LIFELINE_SERVICE_NAME,
        ownerId: "unclaimed",
        processId: process.pid,
        environment: runtimeEnvironment(),
        port: null,
        listenerState: "stopped",
        claimedAt: null,
        listeningAt: null,
        stoppedAt: null,
        duplicateStartAttempts: 0,
        lastError: null,
      };
    }
    return {
      serviceName: LIFELINE_SERVICE_NAME,
      ...this.owner,
    };
  }
}

function summarizeTransport(symbols: DatabentoLifelineSymbolHealth[]): BackendLifelineSnapshot["transport"] {
  const streamingSymbols = symbols.filter((symbol) => symbol.transportState === "streaming").length;
  const errorSymbols = symbols.filter((symbol) => symbol.transportState === "error").length;
  const states = new Set(symbols.map((symbol) => symbol.transportState));
  const state = states.size === 0
    ? "offline"
    : states.size === 1
      ? symbols[0].transportState
      : "mixed";
  return {
    state,
    configuredSymbols: symbols.filter((symbol) => symbol.connectionState !== "not_configured").length,
    streamingSymbols,
    errorSymbols,
    reason: errorSymbols > 0
      ? `${errorSymbols} Databento bridge(s) report an error; bounded recovery remains active where configured.`
      : streamingSymbols === symbols.length && symbols.length > 0
        ? "Every protected Databento bridge reports streaming transport."
        : "Transport is not uniformly streaming; this is separate from market-event freshness.",
  };
}

export function buildBackendLifelineSnapshot(input: {
  now: Date;
  owner: BackendLifelineSnapshot["owner"];
  symbols: DatabentoLifelineSymbolHealth[];
  alert: AlertServiceHealthSnapshot;
  internalTasks?: InternalTaskGovernanceSnapshot;
}): BackendLifelineSnapshot {
  const symbols = input.symbols;
  const alert = input.alert;
  const internalTasks = input.internalTasks ?? emptyInternalTaskSnapshot();
  const transport = summarizeTransport(symbols);
  const freshHeartbeats = symbols.filter((symbol) => symbol.heartbeatFresh);
  const staleHeartbeats = symbols.filter((symbol) => !symbol.heartbeatFresh);
  const freshEvents = symbols.filter((symbol) => symbol.marketEventFresh);
  const staleEvents = symbols.filter((symbol) => symbol.lastMarketEventAt !== null && !symbol.marketEventFresh);
  const missingEvents = symbols.filter((symbol) => symbol.lastMarketEventAt === null);
  const scheduled = symbols.filter((symbol) => symbol.schedulerState === "scheduled");
  const delayed = symbols.filter((symbol) => symbol.schedulerState === "delayed");
  const inactive = symbols.filter((symbol) => symbol.schedulerState === "inactive");
  const rebuilding = symbols.filter((symbol) => (
    symbol.recoveryPhase === "reconnecting"
    || symbol.recoveryPhase === "awaiting_live_event"
    || symbol.recoveryPhase === "rebuilding_window"
  ));
  const recoveryPhase: LifelineRecoveryPhase =
    input.owner.listenerState !== "listening"
      ? input.owner.listenerState === "starting"
        ? "starting"
        : "stopped"
      : symbols.some((symbol) => symbol.recoveryPhase === "reconnecting")
        ? "reconnecting"
        : symbols.some((symbol) => symbol.recoveryPhase === "rebuilding_window")
          ? "rebuilding_window"
          : symbols.some((symbol) => symbol.recoveryPhase === "awaiting_live_event")
            ? "awaiting_live_event"
            : symbols.length > 0 && symbols.every((symbol) => symbol.recoveryPhase === "running")
              ? "running"
              : "starting";
  const capability: BackendLifelineSnapshot["alertDelivery"]["capability"] = alert.vapid.available
    ? "available"
    : "unavailable";
  const blocked = input.owner.listenerState === "failed"
    || input.owner.listenerState === "stopped"
    || input.owner.duplicateStartAttempts > 0;
  const degraded = !blocked && (
    transport.errorSymbols > 0
    || staleHeartbeats.length > 0
    || staleEvents.length > 0
    || missingEvents.length > 0
    || delayed.length > 0
    || !alert.running
    || capability === "unavailable"
    || internalTasks.registryState !== "healthy"
  );
  const state: LifelineState = blocked ? "blocked" : degraded ? "degraded" : "healthy";
  const reason = blocked
    ? input.owner.lastError ?? "Backend listener is not in a safe running state."
    : degraded
      ? "The backend process is observable, but at least one transport, event, scanner, recovery, or alert-delivery capability is constrained. No constrained signal is promoted to market evidence."
      : "Backend listener, Databento transport, heartbeat, market events, scanners, and alert service are healthy.";
  const unsigned = {
    schemaVersion: BACKEND_LIFELINE_SCHEMA_VERSION,
    observedAt: input.now,
    overall: { state, reason },
    owner: input.owner,
    transport,
    heartbeat: {
      freshSymbols: freshHeartbeats.length,
      staleSymbols: staleHeartbeats.length,
      lastAt: freshHeartbeats.map((symbol) => symbol.heartbeatAt).filter((value): value is Date => value !== null)
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      reason: staleHeartbeats.length > 0
        ? "Heartbeat freshness is reported separately from market-event freshness."
        : "Heartbeat timestamps are within the bounded transport-health window.",
    },
    marketEvents: {
      freshSymbols: freshEvents.length,
      staleSymbols: staleEvents.length,
      missingSymbols: missingEvents.length,
      reason: missingEvents.length > 0
        ? "Some protected symbols have no verified market event; heartbeat and transport cannot substitute for it."
        : staleEvents.length > 0
          ? "Some last verified market events aged out; fresh input is required."
          : "Verified market events are fresh for every protected symbol.",
    },
    scanners: {
      scheduledSymbols: scheduled.length,
      delayedSymbols: delayed.length,
      inactiveSymbols: inactive.length,
      reason: delayed.length > 0
        ? "Overdue schedulers are visible and remain alert-ineligible."
        : "Scheduler ownership is reported independently from market evidence.",
    },
    recovery: {
      phase: recoveryPhase,
      rebuildingSymbols: rebuilding.length,
      reason: rebuilding.length > 0
        ? "Recovery requires new verified market events and a rebuilt window; prior observations are not resumed as fresh."
        : "No symbol currently reports an active recovery rebuild.",
    },
    alertDelivery: {
      serviceRunning: alert.running,
      capability,
      deliveriesAttempted: alert.deliveriesAttempted,
      deliveriesSucceeded: alert.deliveriesSucceeded,
      deliveriesSkipped: alert.deliveriesSkipped,
      deliveriesFailed: alert.deliveriesFailed,
      reason: !alert.running
        ? "AlertService is not running; production notification processing is unavailable."
        : capability === "unavailable"
          ? `AlertService is running, but Web Push capability is unavailable: ${alert.vapid.available ? "provider capability is not configured" : alert.vapid.reason}.`
          : "AlertService is server-owned and delivery remains subject to its existing fail-closed gates.",
    },
    persistenceBoundary: {
      alertRecords: "database" as const,
      userSubscriptions: "database" as const,
      deliveryAudit: "database" as const,
      marketWindow: "memory_rebuilt_after_restart" as const,
      scannerState: "memory_rebuilt_after_restart" as const,
      shadowLearning: "sidecar_not_on_lifeline" as const,
      reason: "Durable alert/subscription/audit records are separate from transient market windows and scanner state, which must rebuild after restart.",
    },
    internalTasks,
    symbols,
  };
  return { ...unsigned, auditHash: auditHash(unsigned) };
}

export class BackendLifeline {
  readonly owner = new BackendLifelineOwner();

  getSnapshot(input: {
    now?: Date;
    symbols: DatabentoLifelineSymbolHealth[];
    alert: AlertServiceHealthSnapshot;
    internalTasks: InternalTaskGovernanceSnapshot;
  }): BackendLifelineSnapshot {
    const now = input.now ?? new Date();
    return buildBackendLifelineSnapshot({
      now,
      owner: this.owner.getOwner(),
      symbols: input.symbols,
      alert: input.alert,
      internalTasks: input.internalTasks,
    });
  }
}

export const backendLifeline = new BackendLifeline();

function emptyInternalTaskSnapshot(): InternalTaskGovernanceSnapshot {
  const unsigned = {
    schemaVersion: 1,
    registryState: "degraded" as const,
    serviceRunning: false,
    processScoped: true as const,
    maxConcurrentSlots: 1,
    registeredCount: 0,
    plannedCount: 0,
    activeCount: 0,
    pausedCount: 0,
    blockedCount: 0,
    completedCount: 0,
    failedCount: 0,
    timedOutCount: 0,
    zombieCount: 0,
    recoveringCount: 0,
    activeLeaseCount: 0,
    expiredLeaseCount: 0,
    staleHeartbeatCount: 0,
    dependencyBrokenCount: 0,
    duplicateTaskCount: 0,
    checkpointedCount: 0,
    canStartTaskKeys: [],
    alerts: [],
    auditEventCount: 0,
    lastAuditAt: null,
    recentAudit: [],
    tasks: [],
    reason: "Internal task registry is not connected.",
  };
  return { ...unsigned, auditHash: digestSnapshot(unsigned) };
}

function digestSnapshot(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
import { createHash } from "node:crypto";
import type {
  InternalTaskGovernanceAlert,
  InternalTaskGovernanceSnapshot,
  InternalTaskState,
} from "./internalTaskRegistry";

/**
 * Engineering governance is deliberately separate from market data, Alpha
 * scoring, AlertMonitor, and Shadow Learning. It evaluates declared internal
 * work only; it never reads or mutates the Replit Task Board or agent leases.
 */
export const ENGINEERING_GOVERNANCE_SCHEMA_VERSION = 1;
export const MAX_INTERNAL_EXECUTION_SLOTS = 1;
export const WAITING_FOR_TURN_ALERT_AFTER_MS = 24 * 60 * 60 * 1_000;

export type EngineeringModuleId =
  | "market_ingestion"
  | "data_governance"
  | "feature_structure"
  | "stage_models"
  | "decision_alerting"
  | "background_learning"
  | "audit_persistence"
  | "network_infrastructure";

export type GovernanceHealthState = "healthy" | "degraded" | "blocked";
export type GovernanceAlertSeverity = "info" | "warning" | "critical";
export type ModuleBoundary = {
  id: EngineeringModuleId;
  label: string;
  owns: string[];
  mustNotOwn: string[];
};

export type InternalTaskRecord = {
  key: string;
  title: string;
  state: InternalTaskState;
  implementationKey: string;
  ownerModule: EngineeringModuleId;
  dependsOn: string[];
  resourceClaims: string[];
  waitingSince: Date | null;
  validationPassed: boolean;
  checkpointRecorded: boolean;
  duplicateOf: string | null;
};

export type GovernanceAlert = {
  code:
    | "duplicate_implementation"
    | "active_slot_capacity"
    | "waiting_for_turn_stale"
    | "resource_conflict"
    | "dependency_missing"
    | "dependency_unmet"
    | "dependency_cycle"
    | "failed_without_checkpoint"
    | "completed_without_validation"
    | "task_registry_unavailable"
    | "scanner_backpressure"
    | "task_lease_expired"
    | "task_zombie_detected"
    | "task_dependency_broken"
    | "task_duplicate"
    | "task_registry_stopped"
    | "task_checkpoint_missing"
    | "task_recovery_blocked";
  severity: GovernanceAlertSeverity;
  taskKeys: string[];
  reason: string;
};

export type TaskQueueAssessment = {
  state: GovernanceHealthState;
  activeSlots: number;
  maximumSlots: number;
  alerts: GovernanceAlert[];
  canStartTaskKeys: string[];
};

export type ChangePreflightInput = {
  title: string;
  targetModule: EngineeringModuleId | null;
  implementationKey: string;
  implementationRoute: "reuse" | "new" | "defer";
  knownExistingCapability: string | null;
  dataSources: string[];
  realtimeImpact: "none" | "read_only" | "background" | "critical_path";
  backgroundBudget: {
    maxConcurrent: number | null;
    queueCap: number | null;
    retryCap: number | null;
  };
  dependencies: Array<{ key: string; state: InternalTaskState; validationPassed: boolean }>;
  validationPlan: Array<"type_contract" | "targeted_regression" | "api_or_browser" | "runtime_health">;
  rollbackBoundaries: EngineeringModuleId[];
};

export type ChangePreflight = {
  schemaVersion: number;
  title: string;
  implementationKey: string;
  admissible: boolean;
  checks: Array<{
    id: string;
    state: "pass" | "block";
    reason: string;
  }>;
  auditHash: string;
};

export type EngineeringGovernanceSnapshot = {
  schemaVersion: number;
  generatedAt: Date;
  healthScore: number;
  state: GovernanceHealthState;
  platformBoundary: {
    replitTaskBoardTouched: false;
    internalExecutionLeaseState: "deferred_to_backend_lifeline" | "active";
    reason: string;
  };
  executionOrder: Array<{
    id: string;
    label: string;
    state: "ready" | "blocked";
    reason: string;
  }>;
  moduleBoundaries: ModuleBoundary[];
  taskQueue: TaskQueueAssessment;
  taskExecution: InternalTaskGovernanceSnapshot;
  runtime: {
    protectedScannerCount: number;
    delayedScannerCount: number;
    duplicateSymbolCount: number;
    backgroundResourcePolicy: string;
  };
  alerts: GovernanceAlert[];
  recommendations: string[];
  auditHash: string;
};

export const ALPHA_RADAR_MODULE_BOUNDARIES: ModuleBoundary[] = [
  {
    id: "market_ingestion",
    label: "Market ingestion",
    owns: ["Databento transport", "raw event acceptance", "rolling observations"],
    mustNotOwn: ["Signal scoring", "Alert delivery", "Shadow promotion"],
  },
  {
    id: "data_governance",
    label: "Data governance",
    owns: ["read-only evidence provenance", "freshness and availability projection"],
    mustNotOwn: ["Score mutation", "Alert authorization", "task execution control"],
  },
  {
    id: "feature_structure",
    label: "Feature and structure",
    owns: ["feature calculation", "market structure context"],
    mustNotOwn: ["Network recovery", "notification delivery", "background persistence"],
  },
  {
    id: "stage_models",
    label: "Three-stage models",
    owns: ["pre-breakout", "true-breakout", "post-breakout state interpretation"],
    mustNotOwn: ["raw subscription ownership", "Task Board management"],
  },
  {
    id: "decision_alerting",
    label: "Decision and alerting",
    owns: ["fail-closed AlertMonitor gates", "deduplication", "delivery policy"],
    mustNotOwn: ["Score calculation", "Shadow experiment promotion"],
  },
  {
    id: "background_learning",
    label: "Background learning",
    owns: ["sidecar-only Shadow observation", "archive-backed evaluation"],
    mustNotOwn: ["live scan cadence", "production scores", "Alert gates"],
  },
  {
    id: "audit_persistence",
    label: "Audit and persistence",
    owns: ["immutable validation and audit records"],
    mustNotOwn: ["live decision availability", "market-event truth"],
  },
  {
    id: "network_infrastructure",
    label: "Network infrastructure",
    owns: ["managed workflow identity", "bounded retry and connection lifecycle"],
    mustNotOwn: ["trading strategy", "Alert eligibility"],
  },
];

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function taskCanStart(task: InternalTaskRecord, byKey: Map<string, InternalTaskRecord>): boolean {
  return (
    task.state === "planned"
    && task.dependsOn.every((dependencyKey) => {
      const dependency = byKey.get(dependencyKey);
      return dependency?.state === "completed" && dependency.validationPassed;
    })
  );
}

function hasDependencyCycle(tasks: InternalTaskRecord[]): boolean {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const cycle = (byKey.get(key)?.dependsOn ?? []).some((dependency) => (
      byKey.has(dependency) && visit(dependency)
    ));
    visiting.delete(key);
    visited.add(key);
    return cycle;
  };
  return tasks.some((task) => visit(task.key));
}

/**
 * Validates declared application-internal work. This intentionally has no
 * action methods: the P0 backend-lifeline task will own leases, heartbeats,
 * pause/release, checkpoints, and recovery execution.
 */
export function assessInternalTaskQueue(
  tasks: InternalTaskRecord[],
  now: Date,
  maximumSlots = MAX_INTERNAL_EXECUTION_SLOTS,
): TaskQueueAssessment {
  const alerts: GovernanceAlert[] = [];
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const active = tasks.filter((task) => task.state === "active");
  if (active.length > maximumSlots) {
    alerts.push({
      code: "active_slot_capacity",
      severity: "critical",
      taskKeys: active.map((task) => task.key),
      reason: `Declared active work uses ${active.length} slots; the governed limit is ${maximumSlots}.`,
    });
  }
  const implementations = new Map<string, InternalTaskRecord[]>();
  tasks.forEach((task) => {
    if (task.state === "archived" || task.duplicateOf) return;
    implementations.set(task.implementationKey, [...(implementations.get(task.implementationKey) ?? []), task]);
  });
  implementations.forEach((sameImplementation, implementationKey) => {
    if (sameImplementation.length > 1) {
      alerts.push({
        code: "duplicate_implementation",
        severity: "critical",
        taskKeys: sameImplementation.map((task) => task.key),
        reason: `Multiple internal tasks declare the same implementation entry "${implementationKey}". Merge or archive duplicates before work starts.`,
      });
    }
  });
  tasks.forEach((task) => {
    const missing = task.dependsOn.filter((dependency) => !byKey.has(dependency));
    if (missing.length) {
      alerts.push({
        code: "dependency_missing",
        severity: "critical",
        taskKeys: [task.key],
        reason: `Task depends on unregistered work: ${missing.join(", ")}.`,
      });
    }
    const unmet = task.dependsOn.filter((dependency) => {
      const record = byKey.get(dependency);
      return record && (record.state !== "completed" || !record.validationPassed);
    });
    if (task.state === "active" && unmet.length) {
      alerts.push({
        code: "dependency_unmet",
        severity: "critical",
        taskKeys: [task.key, ...unmet],
        reason: "An active task has dependencies without completed validation.",
      });
    }
    if (
      task.state === "waiting_for_turn"
      && task.waitingSince
      && now.getTime() - task.waitingSince.getTime() > WAITING_FOR_TURN_ALERT_AFTER_MS
    ) {
      alerts.push({
        code: "waiting_for_turn_stale",
        severity: "warning",
        taskKeys: [task.key],
        reason: "Task has waited longer than the governed review threshold and requires a dependency or priority review.",
      });
    }
    if (task.state === "failed" && !task.checkpointRecorded) {
      alerts.push({
        code: "failed_without_checkpoint",
        severity: "critical",
        taskKeys: [task.key],
        reason: "A failed task has no declared checkpoint; do not resume dependent work until recovery evidence exists.",
      });
    }
    if (task.state === "completed" && !task.validationPassed) {
      alerts.push({
        code: "completed_without_validation",
        severity: "critical",
        taskKeys: [task.key],
        reason: "A completed task lacks validation evidence and cannot satisfy dependencies.",
      });
    }
  });
  const claims = new Map<string, InternalTaskRecord[]>();
  active.forEach((task) => task.resourceClaims.forEach((claim) => {
    claims.set(claim, [...(claims.get(claim) ?? []), task]);
  }));
  claims.forEach((claimants, claim) => {
    if (claimants.length > 1) {
      alerts.push({
        code: "resource_conflict",
        severity: "critical",
        taskKeys: claimants.map((task) => task.key),
        reason: `More than one active task claims the exclusive resource "${claim}".`,
      });
    }
  });
  if (hasDependencyCycle(tasks)) {
    alerts.push({
      code: "dependency_cycle",
      severity: "critical",
      taskKeys: tasks.map((task) => task.key),
      reason: "The declared dependency graph contains a cycle.",
    });
  }
  const state: GovernanceHealthState = alerts.some((alert) => alert.severity === "critical")
    ? "blocked"
    : alerts.some((alert) => alert.severity === "warning")
      ? "degraded"
      : "healthy";
  return {
    state,
    activeSlots: active.length,
    maximumSlots,
    alerts,
    canStartTaskKeys: tasks.filter((task) => taskCanStart(task, byKey)).map((task) => task.key),
  };
}

export function evaluateChangePreflight(input: ChangePreflightInput): ChangePreflight {
  const checks: ChangePreflight["checks"] = [];
  checks.push({
    id: "module_boundary",
    state: input.targetModule ? "pass" : "block",
    reason: input.targetModule
      ? `Change belongs to the ${input.targetModule} module.`
      : "Every change requires one accountable existing module.",
  });
  checks.push({
    id: "duplicate_capability",
    state: input.implementationRoute === "new" && input.knownExistingCapability ? "block" : "pass",
    reason: input.implementationRoute === "new" && input.knownExistingCapability
      ? `Existing capability identified: ${input.knownExistingCapability}. Reuse or explicitly supersede it instead of adding a parallel implementation.`
      : "No unaddressed duplicate implementation was declared.",
  });
  const dependencyBlocked = input.dependencies.some((dependency) => (
    dependency.state !== "completed" || !dependency.validationPassed
  ));
  checks.push({
    id: "dependency_order",
    state: dependencyBlocked ? "block" : "pass",
    reason: dependencyBlocked
      ? "Every dependency must be completed and validated before implementation starts."
      : "Declared dependencies have completed validation.",
  });
  const boundedBackground = input.realtimeImpact !== "background"
    || (
      (input.backgroundBudget.maxConcurrent ?? 0) > 0
      && (input.backgroundBudget.queueCap ?? 0) > 0
      && (input.backgroundBudget.retryCap ?? 0) > 0
    );
  checks.push({
    id: "resource_budget",
    state: boundedBackground ? "pass" : "block",
    reason: boundedBackground
      ? "The declared work does not introduce an unbounded background workload."
      : "Background work must declare positive concurrency, queue, and retry bounds.",
  });
  const requiredValidation = ["type_contract", "targeted_regression", "runtime_health"];
  const hasValidation = requiredValidation.every((item) => input.validationPlan.includes(item as ChangePreflightInput["validationPlan"][number]));
  checks.push({
    id: "validation_plan",
    state: hasValidation ? "pass" : "block",
    reason: hasValidation
      ? "Type/contract, targeted regression, and runtime-health validation are declared."
      : "The required verification scope is incomplete.",
  });
  const rollbackReady = input.targetModule !== null && input.rollbackBoundaries.includes(input.targetModule);
  checks.push({
    id: "rollback_boundary",
    state: rollbackReady ? "pass" : "block",
    reason: rollbackReady
      ? "The owning module has an independent rollback boundary."
      : "The owning module must be listed as independently reversible.",
  });
  const unsigned = {
    schemaVersion: ENGINEERING_GOVERNANCE_SCHEMA_VERSION,
    title: input.title,
    implementationKey: input.implementationKey,
    admissible: checks.every((check) => check.state === "pass"),
    checks,
  };
  return { ...unsigned, auditHash: hash(unsigned) };
}

export function buildEngineeringGovernanceSnapshot(input: {
  now: Date;
  protectedScanners: Array<{ symbol: string; schedulerState: "inactive" | "scheduled" | "delayed" }>;
  internalTasks?: InternalTaskRecord[];
  internalTaskHealth?: InternalTaskGovernanceSnapshot;
}): EngineeringGovernanceSnapshot {
  const queueConfigured = input.internalTasks !== undefined || input.internalTaskHealth !== undefined;
  const taskHealth = input.internalTaskHealth ?? emptyTaskHealth(input.now);
  const taskQueue = queueConfigured
    ? input.internalTaskHealth
      ? {
          state: input.internalTaskHealth.registryState,
          activeSlots: input.internalTaskHealth.activeCount,
          maximumSlots: input.internalTaskHealth.maxConcurrentSlots,
          alerts: input.internalTaskHealth.alerts.map(mapTaskAlert),
          canStartTaskKeys: input.internalTaskHealth.canStartTaskKeys,
        }
      : assessInternalTaskQueue(input.internalTasks ?? [], input.now)
    : {
        state: "degraded" as GovernanceHealthState,
        activeSlots: 0,
        maximumSlots: MAX_INTERNAL_EXECUTION_SLOTS,
        alerts: [{
          code: "task_registry_unavailable" as const,
          severity: "warning" as const,
          taskKeys: [],
          reason: "Application-internal task registry is not connected yet. P0 backend lifeline owns the runtime lease/heartbeat integration.",
        }],
        canStartTaskKeys: [],
      };
  const delayed = input.protectedScanners.filter((scanner) => scanner.schedulerState === "delayed");
  const symbols = input.protectedScanners.map((scanner) => scanner.symbol.trim().toUpperCase());
  const duplicateSymbolCount = symbols.length - new Set(symbols).size;
  const runtimeAlerts: GovernanceAlert[] = [
    ...(delayed.length > 0 ? [{
      code: "scanner_backpressure" as const,
      severity: "warning" as const,
      taskKeys: [],
      reason: `${delayed.length} protected scanner(s) report a delayed scheduler and require capacity review without changing live scan behavior.`,
    }] : []),
  ];
  const alerts = [...taskQueue.alerts, ...runtimeAlerts];
  const criticals = alerts.filter((alert) => alert.severity === "critical").length;
  const warnings = alerts.filter((alert) => alert.severity === "warning").length;
  const healthScore = Math.max(0, 100 - criticals * 35 - warnings * 12 - duplicateSymbolCount * 20);
  const state: GovernanceHealthState = criticals > 0
    ? "blocked"
    : warnings > 0
      ? "degraded"
      : "healthy";
  const executionOrder = [
    {
      id: "backend_lifeline",
      label: "Backend lifeline and recovery",
      state: taskHealth.registryState === "blocked" ? "blocked" as const : "ready" as const,
      reason: taskHealth.registryState === "blocked"
        ? "Internal task execution governance is fail-closed because lease, dependency, or checkpoint health is blocked."
        : "Server-owned runtime lease, heartbeat, checkpoint, reclaim, and recovery governance is available without controlling production radar.",
    },
    {
      id: "data_governance",
      label: "Unified data governance",
      state: "ready" as const,
      reason: "Read-only raw-to-decision governance projection is available.",
    },
    {
      id: "evaluation_and_replay",
      label: "Low-frequency evaluation and replay",
      state: "blocked" as const,
      reason: "Admit only after the backend lifeline has supplied runtime execution evidence.",
    },
  ];
  const recommendations = [
    "Run evaluateChangePreflight before starting a new internal implementation.",
    ...(input.internalTaskHealth
      ? ["Keep internal task execution isolated from production radar; a task lease never grants market freshness or Alert authority."]
      : ["Attach the P0 backend-lifeline internal registry before treating task queue health as fully observable."]),
    ...(delayed.length ? ["Investigate delayed scanners through their existing bounded scheduler/recovery owner; do not add parallel subscriptions or retry loops."] : []),
  ];
  const unsigned = {
    schemaVersion: ENGINEERING_GOVERNANCE_SCHEMA_VERSION,
    generatedAt: input.now,
    healthScore,
    state,
    platformBoundary: {
      replitTaskBoardTouched: false as const,
      internalExecutionLeaseState: input.internalTaskHealth ? "active" as const : "deferred_to_backend_lifeline" as const,
      reason: input.internalTaskHealth
        ? "Internal task leases are process-scoped to Alpha Radar and never read, write, pause, release, or imitate Replit Task Board or agent lease state."
        : "This framework never reads, writes, pauses, releases, or imitates Replit Task Board or agent lease state.",
    },
    executionOrder,
    moduleBoundaries: ALPHA_RADAR_MODULE_BOUNDARIES,
    taskQueue,
    taskExecution: taskHealth,
    runtime: {
      protectedScannerCount: input.protectedScanners.length,
      delayedScannerCount: delayed.length,
      duplicateSymbolCount,
      backgroundResourcePolicy: "Shadow learning, archive, and low-frequency evaluation remain sidecar-only and must use bounded queues without changing live scan cadence or Alert delivery.",
    },
    alerts,
    recommendations,
  };
  return { ...unsigned, auditHash: hash(unsigned) };
}

function mapTaskAlert(alert: InternalTaskGovernanceAlert): GovernanceAlert {
  return {
    code: alert.code,
    severity: alert.severity,
    taskKeys: alert.taskKeys,
    reason: alert.reason,
  };
}

function emptyTaskHealth(now: Date): InternalTaskGovernanceSnapshot {
  const unsigned = {
    schemaVersion: 1,
    registryState: "degraded" as const,
    serviceRunning: false,
    processScoped: true as const,
    maxConcurrentSlots: MAX_INTERNAL_EXECUTION_SLOTS,
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
  return {
    ...unsigned,
    auditHash: hash({ ...unsigned, now: now.toISOString() }),
  };
}
import { createHash, randomUUID } from "node:crypto";

import type { RuntimeDiagnosticPayload } from "@workspace/db";

import type { BackendLifelineSnapshot } from "./backendLifeline";
import type { EngineeringGovernanceSnapshot } from "./engineeringGovernance";
import {
  sanitizeDiagnosticPayload,
  sanitizeDiagnosticRecord,
  sanitizeDiagnosticText,
} from "./diagnosticSanitization";
import { logger } from "./logger";
import {
  runtimeIncidentStore,
  type DiagnosticPersistenceInput,
  type RuntimeIncidentStoreHealth,
} from "./runtimeIncidentStore";
import type { RuntimeSupervisorSnapshot } from "./runtimeSupervisor";

export const DIAGNOSTICS_CENTER_SCHEMA_VERSION = 1;
export const DIAGNOSTICS_EVENT_LIMIT = 120;
export const DIAGNOSTICS_REFRESH_INTERVAL_MS = 15_000;
export const DIAGNOSTICS_PERSIST_QUEUE_MAX = 24;
export const DIAGNOSTICS_PERSIST_TIMEOUT_MS = 3_000;

export type DiagnosticCategory =
  | "infrastructure"
  | "application"
  | "data"
  | "configuration"
  | "permission_subscription"
  | "governance"
  | "performance";
export type DiagnosticPriority = "P0" | "P1" | "P2" | "P3";
export type DiagnosticDisposition =
  | "code_defect"
  | "configuration"
  | "permission_subscription"
  | "data_unavailable"
  | "governance_enforced"
  | "expected_rejection"
  | "recovery_event"
  | "infrastructure_fault"
  | "unknown";
export type DiagnosticHealth = "healthy" | "degraded" | "blocked" | "unknown";
export type DiagnosticFreshness = "fresh" | "stale" | "missing" | "unknown";
export type DiagnosticVerificationState = "passed" | "failed" | "waiting" | "skipped";

export type DiagnosticEvidence = {
  source: string;
  summary: string;
  facts: Record<string, string | number | boolean | null>;
  collectedAt: Date;
};

export type DiagnosticModuleHealth = {
  id: string;
  label: string;
  category: DiagnosticCategory;
  state: DiagnosticHealth;
  freshness: DiagnosticFreshness;
  disposition: DiagnosticDisposition;
  impactScope: string;
  reason: string;
  evidence: DiagnosticEvidence;
};

export type DiagnosticValidation = {
  id: string;
  label: string;
  state: DiagnosticVerificationState;
  reason: string;
  checkedAt: Date;
};

export type DiagnosticReport = {
  id: string;
  moduleId: string;
  category: DiagnosticCategory;
  priority: DiagnosticPriority;
  disposition: DiagnosticDisposition;
  status: "active" | "resolved";
  symptom: string;
  rootCause: string | null;
  candidateRootCauses: string[];
  impactScope: string;
  recommendedFix: string;
  verification: DiagnosticValidation;
  remainingRisk: string;
  evidence: DiagnosticEvidence[];
  firstObservedAt: Date;
  lastObservedAt: Date;
  origin: "live" | "restored";
};

export type DiagnosticEvent = {
  id: string;
  kind: "detected" | "observed" | "recovery";
  occurredAt: Date;
  reportId: string;
  moduleId: string;
  category: DiagnosticCategory;
  priority: DiagnosticPriority;
  disposition: DiagnosticDisposition;
  summary: string;
  evidence: DiagnosticEvidence;
  origin: "live" | "restored";
};

export type DiagnosticKnowledgeEntry = {
  id: string;
  title: string;
  status: "resolved" | "reference";
  summary: string;
  lesson: string;
  verification: string;
  remainingRisk: string;
  categories: DiagnosticCategory[];
  relatedReportIds: string[];
};

export type DiagnosticsSnapshot = {
  schemaVersion: number;
  generatedAt: Date;
  overall: {
    state: DiagnosticHealth;
    score: number;
    reason: string;
  };
  modules: DiagnosticModuleHealth[];
  activeAlerts: DiagnosticReport[];
  knownIssues: DiagnosticReport[];
  recentEvents: DiagnosticEvent[];
  healthTimeline: DiagnosticEvent[];
  knowledgeBase: DiagnosticKnowledgeEntry[];
  validations: DiagnosticValidation[];
  futureEngines: {
    selfHealing: "read_only_suggestions_only";
    predictiveDiagnostics: "context_available_no_prediction";
    learningEngine: "context_available_no_production_authority";
    reason: string;
  };
  persistence: {
    state: "restoring" | "ready" | "empty" | "unavailable" | "corrupted";
    reason: string;
    restoredAt: Date | null;
    restoredReports: DiagnosticReport[];
    restoredEvents: DiagnosticEvent[];
  };
  auditHash: string;
};

export type DiagnosticsInputs = {
  lifeline: BackendLifelineSnapshot;
  supervisor: RuntimeSupervisorSnapshot;
  engineeringGovernance: EngineeringGovernanceSnapshot;
  now?: Date;
};

export type DiagnosticsPersistence = {
  getHealth(): RuntimeIncidentStoreHealth;
  recordDiagnostic(input: DiagnosticPersistenceInput): Promise<void>;
  listRecentDiagnostics(limit?: number): Promise<{
    incidents: Array<{ diagnosticPayload: RuntimeDiagnosticPayload | null }>;
    events: Array<{ diagnosticPayload: RuntimeDiagnosticPayload | null }>;
  }>;
};

type IssueCandidate = Omit<DiagnosticReport, "id" | "status" | "firstObservedAt" | "lastObservedAt" | "origin">;
type ActiveIssue = DiagnosticReport;

function safeText(value: string, max = 420): string {
  return sanitizeDiagnosticText(value, max);
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

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function evidence(
  source: string,
  summary: string,
  facts: DiagnosticEvidence["facts"],
  now: Date,
): DiagnosticEvidence {
  return {
    source,
    summary: safeText(summary),
    facts: sanitizeDiagnosticRecord(facts),
    collectedAt: now,
  };
}

function priorityFor(state: DiagnosticHealth, disposition: DiagnosticDisposition): DiagnosticPriority {
  if (state === "blocked") return "P0";
  if (disposition === "infrastructure_fault" || disposition === "code_defect") return "P1";
  if (state === "degraded") return "P2";
  return "P3";
}

function recommendationFor(disposition: DiagnosticDisposition): string {
  switch (disposition) {
    case "configuration":
      return "Review the declared server configuration and restart only through the managed workflow after correcting it.";
    case "permission_subscription":
      return "Confirm the external entitlement or subscription with its provider; do not add fallback credentials or bypass the capability gate.";
    case "data_unavailable":
      return "Wait for independently verified source data or complete the provider recovery path; cached, heartbeat, and reference data cannot substitute.";
    case "governance_enforced":
      return "Review the declared governance boundary and its evidence. Change the policy only through an approved engineering change, not as incident recovery.";
    case "expected_rejection":
      return "No software repair is indicated. Preserve the refusal and collect the missing authorized evidence if the work should proceed.";
    case "recovery_event":
      return "Allow the existing bounded recovery to complete, then require a new validation observation before marking the condition resolved.";
    case "infrastructure_fault":
      return "Inspect the managed process, listener ownership, and platform-level runtime evidence before changing application behavior.";
    case "code_defect":
      return "Reproduce with the attached evidence, make a bounded code correction, and run the declared verification checks before closure.";
    default:
      return "Collect a fresh, independent observation before assigning a software root cause.";
  }
}

function verificationFor(
  id: string,
  label: string,
  module: Pick<DiagnosticModuleHealth, "state" | "disposition" | "reason">,
  now: Date,
): DiagnosticValidation {
  const constrained = module.disposition === "permission_subscription"
    || module.disposition === "data_unavailable"
    || module.disposition === "governance_enforced"
    || module.disposition === "expected_rejection";
  return {
    id,
    label,
    state: module.state === "healthy"
      ? "passed"
      : constrained
        ? module.disposition === "expected_rejection" ? "skipped" : "waiting"
        : "failed",
    reason: module.state === "healthy"
      ? "A current independent health observation satisfies this diagnostic check."
      : module.reason,
    checkedAt: now,
  };
}

function dataFreshness(lifeline: BackendLifelineSnapshot): DiagnosticFreshness {
  if (lifeline.marketEvents.freshSymbols > 0 && lifeline.marketEvents.staleSymbols === 0 && lifeline.marketEvents.missingSymbols === 0) {
    return "fresh";
  }
  if (lifeline.marketEvents.staleSymbols > 0) return "stale";
  if (lifeline.marketEvents.missingSymbols > 0) return "missing";
  return "unknown";
}

function moduleHealth(input: DiagnosticsInputs, now: Date): DiagnosticModuleHealth[] {
  const { lifeline, supervisor, engineeringGovernance } = input;
  const listenerHealthy = lifeline.owner.listenerState === "listening";
  const marketFreshness = dataFreshness(lifeline);
  const marketState: DiagnosticHealth = lifeline.transport.errorSymbols > 0
    ? "degraded"
    : marketFreshness === "fresh"
      ? "healthy"
      : "degraded";
  const alertCapabilityUnavailable = lifeline.alertDelivery.capability === "unavailable";
  const alertState: DiagnosticHealth = !lifeline.alertDelivery.serviceRunning
    ? "blocked"
    : lifeline.alertDelivery.health === "healthy" && !alertCapabilityUnavailable
      ? "healthy"
      : "degraded";
  const referenceState: DiagnosticHealth = lifeline.marketUniverse.state === "healthy"
    ? "healthy"
    : lifeline.marketUniverse.state === "blocked"
      ? "blocked"
      : "degraded";
  const executionState: DiagnosticHealth = lifeline.internalTasks.registryState === "healthy"
    ? "healthy"
    : lifeline.internalTasks.registryState === "blocked"
      ? "blocked"
      : "degraded";
  const governanceState: DiagnosticHealth = engineeringGovernance.state === "healthy"
    ? "healthy"
    : engineeringGovernance.state === "blocked"
      ? "blocked"
      : "degraded";
  const supervisorState: DiagnosticHealth = supervisor.state === "healthy"
    ? "healthy"
    : supervisor.state === "blocked"
      ? "blocked"
      : "degraded";
  const performanceState: DiagnosticHealth = supervisor.application.dashboardDelivery.activeSseConnections > 250
    ? "degraded"
    : "healthy";

  return [
    {
      id: "provider_configuration",
      label: "Provider configuration",
      category: "configuration",
      state: lifeline.transport.configuredSymbols > 0 ? "healthy" : "blocked",
      freshness: lifeline.transport.configuredSymbols > 0 ? "fresh" : "missing",
      disposition: lifeline.transport.configuredSymbols > 0 ? "unknown" : "configuration",
      impactScope: lifeline.transport.configuredSymbols > 0
        ? "At least one protected provider connection is configured."
        : "Live market ingestion cannot begin until the server-owned provider configuration is supplied.",
      reason: lifeline.transport.configuredSymbols > 0
        ? "Protected provider configuration is present."
        : "No protected provider connection is configured in the running server.",
      evidence: evidence("backend_lifeline", lifeline.transport.reason, {
        configuredSymbols: lifeline.transport.configuredSymbols,
        transportState: lifeline.transport.state,
      }, now),
    },
    {
      id: "api_listener",
      label: "API listener",
      category: "infrastructure",
      state: listenerHealthy ? "healthy" : "blocked",
      freshness: listenerHealthy ? "fresh" : "missing",
      disposition: listenerHealthy ? "unknown" : "infrastructure_fault",
      impactScope: listenerHealthy ? "Diagnostic API and dashboard delivery are available." : "The API process cannot safely serve dashboard or diagnostic requests.",
      reason: listenerHealthy
        ? "The server-owned listener reports the listening lifecycle state."
        : lifeline.owner.lastError ?? "The server listener is not in its listening lifecycle state.",
      evidence: evidence("backend_lifeline", lifeline.owner.lastError ?? lifeline.overall.reason, {
        listenerState: lifeline.owner.listenerState,
        port: lifeline.owner.port,
        duplicateStartAttempts: lifeline.owner.duplicateStartAttempts,
      }, now),
    },
    {
      id: "market_data",
      label: "Verified market data",
      category: "data",
      state: marketState,
      freshness: marketFreshness,
      disposition: marketState === "healthy" ? "unknown" : "data_unavailable",
      impactScope: marketState === "healthy"
        ? "Verified input is available to existing fail-closed market gates."
        : "Market scoring and alerts remain fail-closed until new verified source events arrive.",
      reason: marketState === "healthy"
        ? "Transport and verified market-event observations are current."
        : lifeline.transport.errorSymbols > 0
          ? lifeline.transport.reason
          : lifeline.marketEvents.reason,
      evidence: evidence("backend_lifeline", lifeline.marketEvents.reason, {
        transportState: lifeline.transport.state,
        errorSymbols: lifeline.transport.errorSymbols,
        freshSymbols: lifeline.marketEvents.freshSymbols,
        staleSymbols: lifeline.marketEvents.staleSymbols,
        missingSymbols: lifeline.marketEvents.missingSymbols,
      }, now),
    },
    {
      id: "alert_delivery",
      label: "Alert delivery capability",
      category: alertCapabilityUnavailable ? "permission_subscription" : "application",
      state: alertState,
      freshness: lifeline.alertDelivery.health === "healthy" ? "fresh" : "stale",
      disposition: alertCapabilityUnavailable
        ? "permission_subscription"
        : !lifeline.alertDelivery.serviceRunning
          ? "infrastructure_fault"
          : alertState === "healthy" ? "unknown" : "recovery_event",
      impactScope: alertState === "healthy"
        ? "Alert delivery is independently observable; existing alert gates remain unchanged."
        : "Notifications may be unavailable. This does not alter market evidence or create alert authority.",
      reason: lifeline.alertDelivery.reason,
      evidence: evidence("backend_lifeline", lifeline.alertDelivery.reason, {
        serviceRunning: lifeline.alertDelivery.serviceRunning,
        health: lifeline.alertDelivery.health,
        capability: lifeline.alertDelivery.capability,
        deliveriesFailed: lifeline.alertDelivery.deliveriesFailed,
      }, now),
    },
    {
      id: "market_reference",
      label: "Reference and classification data",
      category: "data",
      state: referenceState,
      freshness: lifeline.marketUniverse.freshness === "fresh"
        ? "fresh"
        : lifeline.marketUniverse.freshness === "stale"
          ? "stale"
          : "missing",
      disposition: referenceState === "healthy"
        ? "unknown"
        : lifeline.marketUniverse.dataQuality === "unavailable"
          ? "data_unavailable"
          : "expected_rejection",
      impactScope: referenceState === "healthy"
        ? "Authorized reference data is available for lifecycle and classification checks."
        : "Discovery or classification remains withheld; unverified reference records cannot become market candidates.",
      reason: lifeline.marketUniverse.reason,
      evidence: evidence("market_universe_lifeline", lifeline.marketUniverse.reason, {
        state: lifeline.marketUniverse.state,
        freshness: lifeline.marketUniverse.freshness,
        dataQuality: lifeline.marketUniverse.dataQuality,
        serviceRunning: lifeline.marketUniverse.serviceRunning,
      }, now),
    },
    {
      id: "internal_execution",
      label: "Internal execution governance",
      category: "governance",
      state: executionState,
      freshness: lifeline.internalTasks.lastAuditAt ? "fresh" : "missing",
      disposition: executionState === "healthy" ? "unknown" : "governance_enforced",
      impactScope: executionState === "healthy"
        ? "Bounded internal operations are observable and remain separate from market authority."
        : "Internal work is constrained or blocked; live radar, scoring, and Alerts are intentionally unaffected.",
      reason: lifeline.internalTasks.reason,
      evidence: evidence("internal_task_registry", lifeline.internalTasks.reason, {
        registryState: lifeline.internalTasks.registryState,
        timedOutCount: lifeline.internalTasks.timedOutCount,
        zombieCount: lifeline.internalTasks.zombieCount,
        blockedCount: lifeline.internalTasks.blockedCount,
      }, now),
    },
    {
      id: "engineering_governance",
      label: "Engineering governance",
      category: "governance",
      state: governanceState,
      freshness: "fresh",
      disposition: governanceState === "healthy" ? "unknown" : "governance_enforced",
      impactScope: governanceState === "healthy"
        ? "Declared engineering boundaries are observable."
        : "A declared safety boundary is constraining work; this is not evidence of a market or code defect.",
      reason: engineeringGovernance.recommendations[0] ?? "Engineering governance is available.",
      evidence: evidence("engineering_governance", engineeringGovernance.recommendations[0] ?? "Engineering governance is available.", {
        state: engineeringGovernance.state,
        healthScore: engineeringGovernance.healthScore,
        alertCount: engineeringGovernance.alerts.length,
      }, now),
    },
    {
      id: "runtime_supervision",
      label: "Runtime supervision",
      category: "application",
      state: supervisorState,
      freshness: supervisor.lastInspectionAt ? "fresh" : "missing",
      disposition: supervisor.state === "recovering"
        ? "recovery_event"
        : supervisorState === "healthy" ? "unknown" : "infrastructure_fault",
      impactScope: supervisorState === "healthy"
        ? "Read-only supervision is current."
        : "Operational supervision reports a constrained component; this does not replace service-specific evidence.",
      reason: supervisor.reason,
      evidence: evidence("runtime_supervisor", supervisor.reason, {
        state: supervisor.state,
        incidentCount: supervisor.incidents.length,
        activeRecoveryAttempts: supervisor.recovery.activeAttempts,
        persistenceState: supervisor.persistence.state,
      }, now),
    },
    {
      id: "dashboard_performance",
      label: "Dashboard delivery capacity",
      category: "performance",
      state: performanceState,
      freshness: "fresh",
      disposition: performanceState === "healthy" ? "unknown" : "infrastructure_fault",
      impactScope: performanceState === "healthy"
        ? "Dashboard observer count is within the V1 diagnostic threshold."
        : "Elevated SSE observer count may affect dashboard delivery; market and alert paths remain independent.",
      reason: performanceState === "healthy"
        ? "Observed SSE connection count is within the V1 diagnostic threshold."
        : "Observed SSE connection count exceeds the V1 diagnostic threshold.",
      evidence: evidence("runtime_supervisor", "Dashboard delivery is observational only.", {
        activeSseConnections: supervisor.application.dashboardDelivery.activeSseConnections,
        threshold: 250,
      }, now),
    },
  ];
}

function reportCandidate(module: DiagnosticModuleHealth, now: Date): IssueCandidate {
  const rootCause = module.disposition === "code_defect" || module.disposition === "infrastructure_fault"
    ? module.reason
    : null;
  const candidates = rootCause
    ? []
    : [module.disposition === "unknown"
      ? "Evidence is not sufficient to assign a root cause."
      : module.reason];
  const validation = verificationFor(
    `${module.id}_recheck`,
    `Recheck ${module.label}`,
    module,
    now,
  );
  return {
    moduleId: module.id,
    category: module.category,
    priority: priorityFor(module.state, module.disposition),
    disposition: module.disposition,
    symptom: module.reason,
    rootCause,
    candidateRootCauses: candidates,
    impactScope: module.impactScope,
    recommendedFix: recommendationFor(module.disposition),
    verification: validation,
    remainingRisk: module.disposition === "data_unavailable"
      ? "No market or alert readiness can be inferred until fresh verified source evidence arrives."
      : module.disposition === "permission_subscription"
        ? "The capability remains unavailable until the external entitlement is independently confirmed."
        : module.disposition === "governance_enforced" || module.disposition === "expected_rejection"
          ? "The safety boundary remains intentionally in force until approved evidence or policy changes."
          : "Re-evaluate with a new independent health observation after the recommended action.",
    evidence: [module.evidence],
  };
}

function knownKnowledge(): DiagnosticKnowledgeEntry[] {
  return [
    {
      id: "dashboard-transport-epoch-recovery",
      title: "Dashboard transport recovery uses epoch and revision",
      status: "resolved",
      summary: "A server restart can reset local revisions while delayed stream messages remain in flight.",
      lesson: "Socket open is not proof of current server state. REST must authoritatively confirm a new epoch before old stream data is retired.",
      verification: "Regression coverage checks cross-epoch REST recovery, delayed SSE, and null market-event time.",
      remainingRisk: "Future transports must use the same shared snapshot ordering rule.",
      categories: ["infrastructure", "application"],
      relatedReportIds: [],
    },
    {
      id: "governance-and-subscription-are-not-code-bugs",
      title: "External constraints require explicit attribution",
      status: "reference",
      summary: "A missing provider capability, source entitlement, or governance refusal can block work without being a software defect.",
      lesson: "Preserve fail-closed behavior and classify the condition before proposing a code repair.",
      verification: "Diagnostic reports expose disposition, evidence, and validation state separately.",
      remainingRisk: "An external provider may remain unavailable even when application health is otherwise normal.",
      categories: ["permission_subscription", "governance", "data", "configuration"],
      relatedReportIds: [],
    },
  ];
}

function validEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFactRecord(value: unknown): value is Record<string, string | number | boolean | null> {
  return isPlainRecord(value)
    && Object.entries(value).every(([key, item]) => (
      key.length <= 64
      && (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null)
    ));
}

function restorePayload(payload: RuntimeDiagnosticPayload): { report: DiagnosticReport; event: DiagnosticEvent } | null {
  const report = payload?.report;
  const persistedEvent = payload?.event;
  if (
    !report
    || !persistedEvent
    || payload.schemaVersion !== 1
    || typeof report.id !== "string"
    || typeof report.moduleId !== "string"
    || !validEnum(report.category, ["infrastructure", "application", "data", "configuration", "permission_subscription", "governance", "performance"] as const)
    || !validEnum(report.priority, ["P0", "P1", "P2", "P3"] as const)
    || !validEnum(report.disposition, ["code_defect", "configuration", "permission_subscription", "data_unavailable", "governance_enforced", "expected_rejection", "recovery_event", "infrastructure_fault", "unknown"] as const)
    || !validEnum(report.status, ["active", "resolved"] as const)
    || !validEnum(report.validation?.state, ["passed", "failed", "waiting", "skipped"] as const)
    || !validEnum(persistedEvent.kind, ["detected", "observed", "recovery"] as const)
    || typeof report.symptom !== "string"
    || (report.rootCause !== null && typeof report.rootCause !== "string")
    || typeof report.impactScope !== "string"
    || typeof report.recommendedFix !== "string"
    || typeof report.remainingRisk !== "string"
    || typeof report.validation.id !== "string"
    || typeof report.validation.label !== "string"
    || typeof report.validation.reason !== "string"
    || typeof persistedEvent.id !== "string"
    || typeof persistedEvent.summary !== "string"
    || !parseDate(report.firstObservedAt)
    || !parseDate(report.lastObservedAt)
    || !parseDate(report.validation.checkedAt)
    || !parseDate(persistedEvent.occurredAt)
    || !Array.isArray(report.candidateRootCauses)
    || report.candidateRootCauses.some((item) => typeof item !== "string")
    || !Array.isArray(report.evidence)
    || report.evidence.some((item) => !isPlainRecord(item)
      || typeof item.source !== "string"
      || typeof item.summary !== "string"
      || !isFactRecord(item.facts)
      || !parseDate(item.collectedAt))
  ) return null;

  const evidenceItems: DiagnosticEvidence[] = report.evidence.map((item) => ({
    source: safeText(item.source, 96),
    summary: safeText(item.summary),
    facts: sanitizeDiagnosticRecord(item.facts),
    collectedAt: parseDate(item.collectedAt)!,
  }));
  const restoredReport: DiagnosticReport = {
    id: safeText(report.id, 160),
    moduleId: safeText(report.moduleId, 96),
    category: report.category,
    priority: report.priority,
    disposition: report.disposition,
    status: report.status,
    symptom: safeText(report.symptom ?? ""),
    rootCause: report.rootCause === null ? null : typeof report.rootCause === "string" ? safeText(report.rootCause) : null,
    candidateRootCauses: report.candidateRootCauses.filter((item): item is string => typeof item === "string").map((item) => safeText(item)),
    impactScope: safeText(report.impactScope ?? ""),
    recommendedFix: safeText(report.recommendedFix ?? ""),
    verification: {
      id: safeText(report.validation.id ?? "", 128),
      label: safeText(report.validation.label ?? ""),
      state: report.validation.state,
      reason: safeText(report.validation.reason ?? ""),
      checkedAt: parseDate(report.validation.checkedAt)!,
    },
    remainingRisk: safeText(report.remainingRisk ?? ""),
    evidence: evidenceItems,
    firstObservedAt: parseDate(report.firstObservedAt)!,
    lastObservedAt: parseDate(report.lastObservedAt)!,
    origin: "restored",
  };
  return {
    report: restoredReport,
    event: {
      id: safeText(persistedEvent.id, 160),
      kind: persistedEvent.kind,
      occurredAt: parseDate(persistedEvent.occurredAt)!,
      reportId: restoredReport.id,
      moduleId: restoredReport.moduleId,
      category: restoredReport.category,
      priority: restoredReport.priority,
      disposition: persistedEvent.kind === "recovery" ? "recovery_event" : restoredReport.disposition,
      summary: safeText(persistedEvent.summary),
      evidence: evidenceItems[0] ?? evidence("diagnostics_restore", "Persisted diagnostic event did not retain evidence.", {}, new Date()),
      origin: "restored",
    },
  };
}

/**
 * Shared, read-only diagnostic projection. It is intentionally process-bounded
 * in V1: loss of diagnostic history after restart is visible, and never allowed
 * to influence market freshness, scores, candidate eligibility, or Alerts.
 */
export class DiagnosticsCenter {
  private getInputs: (() => DiagnosticsInputs) | null = null;
  private monitor: NodeJS.Timeout | null = null;
  private readonly active = new Map<string, ActiveIssue>();
  private readonly events: DiagnosticEvent[] = [];
  private readonly restoredReports: DiagnosticReport[] = [];
  private readonly restoredEvents: DiagnosticEvent[] = [];
  private restoreState: "restoring" | "ready" | "empty" | "unavailable" | "corrupted" = "restoring";
  private restoreReason = "Persistent diagnostic evidence has not been checked yet.";
  private restoredAt: Date | null = null;
  private restoreInFlight: Promise<void> | null = null;
  private readonly persistenceQueue: Array<{ report: DiagnosticReport; event: DiagnosticEvent }> = [];
  private persistenceWorker: Promise<void> | null = null;
  private latest: DiagnosticsSnapshot | null = null;

  constructor(private readonly persistence: DiagnosticsPersistence = runtimeIncidentStore) {}

  start(getInputs: () => DiagnosticsInputs): void {
    if (this.monitor) return;
    this.getInputs = getInputs;
    void this.restore().finally(() => this.refresh());
    this.monitor = setInterval(() => this.refresh(), DIAGNOSTICS_REFRESH_INTERVAL_MS);
    this.monitor.unref();
    logger.info({ diagnostics: { intervalMs: DIAGNOSTICS_REFRESH_INTERVAL_MS } }, "Diagnostics Center started as a read-only observer");
  }

  async stop(): Promise<void> {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    this.getInputs = null;
    await this.flushPersistence();
  }

  getSnapshot(inputs?: DiagnosticsInputs): DiagnosticsSnapshot {
    if (inputs) return this.assess(inputs);
    if (!this.latest && this.getInputs) this.refresh();
    return this.latest ?? this.emptySnapshot(new Date());
  }

  private refresh(): void {
    if (!this.getInputs) return;
    try {
      this.latest = this.assess(this.getInputs());
    } catch (error) {
      const now = new Date();
      const failure = safeText(error instanceof Error ? error.message : String(error));
      logger.warn({ diagnostics: { error: failure } }, "Diagnostics Center refresh failed without affecting Alpha Radar services");
      this.latest = this.emptySnapshot(now, failure);
    }
  }

  async restore(): Promise<void> {
    if (this.restoreInFlight) return this.restoreInFlight;
    this.restoreState = "restoring";
    this.restoreReason = "Loading bounded diagnostic evidence from the shared operational store.";
    this.restoreInFlight = (async () => {
      try {
        const persisted = await this.persistence.listRecentDiagnostics(DIAGNOSTICS_EVENT_LIMIT);
        const reports = persisted.incidents
          .map((record) => record.diagnosticPayload ? restorePayload(record.diagnosticPayload) : null);
        const events = persisted.events
          .map((record) => record.diagnosticPayload ? restorePayload(record.diagnosticPayload) : null);
        const malformed = reports.some((item) => item === null) || events.some((item) => item === null);
        this.restoredReports.splice(0, this.restoredReports.length, ...reports.flatMap((item) => item ? [item.report] : []));
        this.restoredEvents.splice(0, this.restoredEvents.length, ...events.flatMap((item) => item ? [item.event] : []));
        this.restoredAt = new Date();
        this.restoreState = malformed ? "corrupted" : this.restoredReports.length || this.restoredEvents.length ? "ready" : "empty";
        this.restoreReason = malformed
          ? "Some persisted diagnostic records were rejected as incomplete or corrupt. Valid historical evidence remains read-only and live services are unaffected."
          : this.restoreState === "empty"
            ? "No prior diagnostic evidence is available in the shared operational store."
            : "Historical diagnostic evidence was restored from the shared operational store and is labeled separately from live observations.";
        logger.info({
          diagnostics: {
            restoredReports: this.restoredReports.length,
            restoredEvents: this.restoredEvents.length,
            restoreState: this.restoreState,
          },
        }, "Diagnostics Center restored historical evidence");
      } catch (error) {
        const failure = safeText(error instanceof Error ? error.message : String(error));
        this.restoreState = "unavailable";
        this.restoreReason = "Persistent diagnostic evidence is unavailable. Live Alpha Radar and Diagnostics Center observations remain isolated and continue without restoration.";
        this.restoredAt = new Date();
        logger.warn({ diagnostics: { error: failure } }, "Diagnostics Center persistence restore failed without affecting Alpha Radar services");
      } finally {
        this.restoreInFlight = null;
      }
    })();
    return this.restoreInFlight;
  }

  private assess(inputs: DiagnosticsInputs): DiagnosticsSnapshot {
    const now = inputs.now ?? new Date();
    const modules = moduleHealth(inputs, now);
    const candidates = modules
      .filter((module) => module.state !== "healthy")
      .map((module) => reportCandidate(module, now));
    const activeKeys = new Set(candidates.map((candidate) => candidate.moduleId));

    for (const candidate of candidates) {
      const existing = this.active.get(candidate.moduleId);
      const report: ActiveIssue = existing
        ? {
            ...existing,
            ...candidate,
            status: "active",
            lastObservedAt: now,
            origin: "live",
          }
        : {
            ...candidate,
            id: `diagnostic:${candidate.moduleId}`,
            status: "active",
            firstObservedAt: now,
            lastObservedAt: now,
            origin: "live",
          };
      if (!existing) {
        this.recordEvent("detected", report, now);
      } else if (this.reportFingerprint(existing) !== this.reportFingerprint(report)) {
        this.recordEvent("observed", report, now);
      }
      this.active.set(candidate.moduleId, report);
    }

    for (const [moduleId, report] of [...this.active.entries()]) {
      if (activeKeys.has(moduleId)) continue;
      const resolved: DiagnosticReport = {
        ...report,
        status: "resolved",
        lastObservedAt: now,
        verification: {
          id: `${report.moduleId}_recheck`,
          label: `Recheck ${report.moduleId}`,
          state: "passed",
          reason: "A fresh independent health observation no longer reports the condition.",
          checkedAt: now,
        },
        remainingRisk: "Continue normal bounded observation; no market or Alert state was used as recovery proof.",
        origin: "live",
      };
      this.recordEvent("recovery", resolved, now);
      this.active.delete(moduleId);
    }

    const activeAlerts = [...this.active.values()]
      .filter((report) => report.priority === "P0" || report.priority === "P1")
      .sort((left, right) => left.priority.localeCompare(right.priority));
    const knownIssues = [...this.active.values()]
      .sort((left, right) => left.priority.localeCompare(right.priority));
    const validations = modules.map((module) => verificationFor(
      `${module.id}_health`,
      `Validate ${module.label}`,
      module,
      now,
    ));
    const blocked = modules.filter((module) => module.state === "blocked").length;
    const degraded = modules.filter((module) => module.state === "degraded").length;
    const score = Math.max(0, 100 - blocked * 35 - degraded * 12);
    const state: DiagnosticHealth = blocked > 0 ? "blocked" : degraded > 0 ? "degraded" : "healthy";
    const unsigned = {
      schemaVersion: DIAGNOSTICS_CENTER_SCHEMA_VERSION,
      generatedAt: now,
      overall: {
        state,
        score,
        reason: state === "healthy"
          ? "Every registered Diagnostics Center module reports a current healthy observation."
          : "One or more modules are constrained. Attribution is evidence-based and does not alter market or Alert authority.",
      },
      modules,
      activeAlerts,
      knownIssues,
      recentEvents: this.events.slice(0, 20),
      healthTimeline: this.events.slice(0, 60),
      knowledgeBase: knownKnowledge(),
      validations,
      futureEngines: {
        selfHealing: "read_only_suggestions_only" as const,
        predictiveDiagnostics: "context_available_no_prediction" as const,
        learningEngine: "context_available_no_production_authority" as const,
        reason: "V1 exposes evidence and recommendations only. No future engine can change configuration, permissions, governance, market data, scores, or Alerts through this interface.",
      },
      persistence: this.persistenceSummary(),
    };
    return { ...unsigned, auditHash: digest(unsigned) };
  }

  private recordEvent(kind: DiagnosticEvent["kind"], report: DiagnosticReport, now: Date): void {
    const event: DiagnosticEvent = {
      id: randomUUID(),
      kind,
      occurredAt: now,
      reportId: report.id,
      moduleId: report.moduleId,
      category: report.category,
      priority: report.priority,
      disposition: kind === "recovery" ? "recovery_event" : report.disposition,
      summary: kind === "recovery"
        ? `Recovered: ${safeText(report.symptom)}`
        : safeText(report.symptom),
      evidence: report.evidence[0],
      origin: "live",
    };
    this.events.unshift(event);
    if (this.events.length > DIAGNOSTICS_EVENT_LIMIT) this.events.length = DIAGNOSTICS_EVENT_LIMIT;
    logger.info({
      diagnostics: {
        kind: event.kind,
        reportId: event.reportId,
        moduleId: event.moduleId,
        category: event.category,
        priority: event.priority,
        disposition: event.disposition,
        evidence: event.evidence,
      },
    }, "Diagnostic event recorded");
    this.enqueuePersistence(report, event);
  }

  private enqueuePersistence(report: DiagnosticReport, event: DiagnosticEvent): void {
    if (this.persistenceQueue.length >= DIAGNOSTICS_PERSIST_QUEUE_MAX) {
      this.persistenceQueue.length = 0;
      this.restoreState = "unavailable";
      this.restoreReason = "Diagnostic persistence queue reached its bounded capacity. Live observations remain available and Alpha Radar is unaffected.";
      logger.warn("Diagnostics Center persistence queue reached bounded capacity; live services remain isolated");
      return;
    }
    this.persistenceQueue.push({ report, event });
    if (!this.persistenceWorker) this.persistenceWorker = this.drainPersistenceQueue();
  }

  private async drainPersistenceQueue(): Promise<void> {
    try {
      while (this.persistenceQueue.length) {
        const entry = this.persistenceQueue.shift();
        if (!entry) continue;
        const write = this.persistence.recordDiagnostic(this.persistenceInput(entry.report, entry.event));
        const outcome = await new Promise<"completed" | "timed_out" | { error: unknown }>((resolve) => {
          const timeout = setTimeout(() => resolve("timed_out"), DIAGNOSTICS_PERSIST_TIMEOUT_MS);
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
        if (outcome === "completed" && this.persistence.getHealth().state === "ready") continue;
        this.persistenceQueue.length = 0;
        this.restoreState = "unavailable";
        this.restoreReason = "Diagnostic persistence is unavailable. Live observations continue without using storage as a runtime dependency.";
        logger.warn({
          diagnostics: {
            error: outcome === "timed_out"
              ? "Diagnostic persistence write timed out."
              : typeof outcome === "object" && "error" in outcome
                ? safeText(outcome.error instanceof Error ? outcome.error.message : String(outcome.error))
                : this.persistence.getHealth().lastError,
          },
        }, "Diagnostics Center persistence write failed without affecting Alpha Radar services");
        return;
      }
    } finally {
      this.persistenceWorker = null;
      if (this.persistenceQueue.length) this.persistenceWorker = this.drainPersistenceQueue();
    }
  }

  private persistenceInput(report: DiagnosticReport, event: DiagnosticEvent): DiagnosticPersistenceInput {
    const payload: RuntimeDiagnosticPayload = {
      schemaVersion: 1,
      report: {
        id: report.id,
        moduleId: report.moduleId,
        category: report.category,
        priority: report.priority,
        disposition: report.disposition,
        status: report.status,
        symptom: report.symptom,
        rootCause: report.rootCause,
        candidateRootCauses: report.candidateRootCauses,
        impactScope: report.impactScope,
        recommendedFix: report.recommendedFix,
        validation: {
          id: report.verification.id,
          label: report.verification.label,
          state: report.verification.state,
          reason: report.verification.reason,
          checkedAt: report.verification.checkedAt.toISOString(),
        },
        remainingRisk: report.remainingRisk,
        evidence: report.evidence.map((item) => ({
          source: item.source,
          summary: item.summary,
          facts: item.facts,
          collectedAt: item.collectedAt.toISOString(),
        })),
        firstObservedAt: report.firstObservedAt.toISOString(),
        lastObservedAt: report.lastObservedAt.toISOString(),
      },
      event: {
        id: event.id,
        kind: event.kind,
        occurredAt: event.occurredAt.toISOString(),
        summary: event.summary,
      },
    };
    return {
      incidentKey: `diagnostic:${report.moduleId}`,
      state: report.status === "resolved" ? "resolved" : "open",
      event: event.kind === "recovery" ? "resolved" : event.kind,
      severity: report.priority === "P0" || report.priority === "P1" ? "critical" : "warning",
      reason: report.symptom,
      evidence: {
        summary: event.summary,
        componentState: report.status,
        details: {
          category: report.category,
          priority: report.priority,
          disposition: report.disposition,
          validationState: report.verification.state,
        },
      },
      payload: sanitizeDiagnosticPayload(payload),
      occurredAt: event.occurredAt,
    };
  }

  private persistenceSummary(): DiagnosticsSnapshot["persistence"] {
    const health = this.persistence.getHealth();
    const state = health.state === "unavailable"
      ? "unavailable" as const
      : this.restoreState;
    const reason = health.state === "unavailable"
      ? "Shared operational persistence is unavailable. Historical evidence may be incomplete, while live Alpha Radar and Diagnostics Center observations remain isolated."
      : this.restoreReason;
    return {
      state,
      reason,
      restoredAt: this.restoredAt,
      restoredReports: this.restoredReports.slice(0, DIAGNOSTICS_EVENT_LIMIT),
      restoredEvents: this.restoredEvents.slice(0, DIAGNOSTICS_EVENT_LIMIT),
    };
  }

  private reportFingerprint(report: DiagnosticReport): string {
    return JSON.stringify({
      category: report.category,
      priority: report.priority,
      disposition: report.disposition,
      symptom: report.symptom,
      rootCause: report.rootCause,
      candidateRootCauses: report.candidateRootCauses,
      impactScope: report.impactScope,
      recommendedFix: report.recommendedFix,
      verification: {
        state: report.verification.state,
        reason: report.verification.reason,
      },
      remainingRisk: report.remainingRisk,
      evidence: report.evidence.map((item) => ({
        source: item.source,
        summary: item.summary,
        facts: item.facts,
      })),
    });
  }

  private async flushPersistence(): Promise<void> {
    if (!this.persistenceWorker && this.persistenceQueue.length) this.persistenceWorker = this.drainPersistenceQueue();
    if (!this.persistenceWorker) return;
    await Promise.race([
      this.persistenceWorker,
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, DIAGNOSTICS_PERSIST_TIMEOUT_MS);
        timeout.unref();
      }),
    ]);
  }

  private emptySnapshot(now: Date, error?: string): DiagnosticsSnapshot {
    const diagnosticModule: DiagnosticModuleHealth = {
      id: "diagnostics_center",
      label: "Diagnostics Center",
      category: "application",
      state: error ? "degraded" : "unknown",
      freshness: "missing",
      disposition: error ? "infrastructure_fault" : "unknown",
      impactScope: "Diagnostic reporting is unavailable. Alpha Radar market, scoring, and Alert paths remain isolated.",
      reason: error ?? "Diagnostics Center has not received its first registered observation.",
      evidence: evidence("diagnostics_center", error ?? "No registered observation.", {}, now),
    };
    const unsigned = {
      schemaVersion: DIAGNOSTICS_CENTER_SCHEMA_VERSION,
      generatedAt: now,
      overall: {
        state: diagnosticModule.state,
        score: 0,
        reason: diagnosticModule.reason,
      },
      modules: [diagnosticModule],
      activeAlerts: [],
      knownIssues: [],
      recentEvents: this.events.slice(0, 20),
      healthTimeline: this.events.slice(0, 60),
      knowledgeBase: knownKnowledge(),
      validations: [verificationFor("diagnostics_center_health", "Validate Diagnostics Center", diagnosticModule, now)],
      futureEngines: {
        selfHealing: "read_only_suggestions_only" as const,
        predictiveDiagnostics: "context_available_no_prediction" as const,
        learningEngine: "context_available_no_production_authority" as const,
        reason: "The interface remains read-only even when no current diagnostic observation is available.",
      },
      persistence: this.persistenceSummary(),
    };
    return { ...unsigned, auditHash: digest(unsigned) };
  }
}

export const diagnosticsCenter = new DiagnosticsCenter();
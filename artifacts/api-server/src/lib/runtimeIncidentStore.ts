import {
  db,
  runtimeSupervisorAuditTable,
  runtimeSupervisorIncidentsTable,
  type RuntimeDiagnosticPayload,
  type RuntimeSupervisorEvidence,
  type RuntimeSupervisorRecoveryAudit,
} from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

import { logger } from "./logger";

export type RuntimeIncidentState = "open" | "recovering" | "resolved";
export type RuntimeIncidentSeverity = "warning" | "critical";
export type RuntimeIncidentEvent =
  | "detected"
  | "observed"
  | "recovery_started"
  | "recovery_succeeded"
  | "recovery_failed"
  | "recovery_skipped"
  | "resolved";

export type RuntimeIncidentInput = {
  incidentKey: string;
  component: string;
  reasonCode: string;
  severity: RuntimeIncidentSeverity;
  state: RuntimeIncidentState;
  event: RuntimeIncidentEvent;
  reason: string;
  evidence: RuntimeSupervisorEvidence;
  recovery?: RuntimeSupervisorRecoveryAudit | null;
  occurredAt?: Date;
};

export type RuntimeIncidentStoreHealth = {
  state: "ready" | "unavailable";
  lastPersistedAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
};

export type DiagnosticPersistenceInput = {
  incidentKey: string;
  state: "open" | "resolved";
  event: "detected" | "observed" | "resolved";
  severity: RuntimeIncidentSeverity;
  reason: string;
  evidence: RuntimeSupervisorEvidence;
  payload: RuntimeDiagnosticPayload;
  occurredAt?: Date;
};

function safeText(value: string, max: number): string {
  return value.replace(/[\r\n]/g, " ").slice(0, max);
}

function normalizeEvidence(evidence: RuntimeSupervisorEvidence): RuntimeSupervisorEvidence {
  return {
    summary: safeText(evidence.summary, 320),
    componentState: safeText(evidence.componentState, 80),
    details: Object.fromEntries(
      Object.entries(evidence.details)
        .slice(0, 16)
        .map(([key, value]) => [safeText(key, 64), typeof value === "string" ? safeText(value, 320) : value]),
    ),
  };
}

/**
 * Database-backed, non-blocking operational audit store. Storage failure is
 * itself observable but never changes the running market or alert workflow.
 */
export class RuntimeIncidentStore {
  private lastPersistedAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastError: string | null = null;

  getHealth(): RuntimeIncidentStoreHealth {
    return {
      state: this.lastError ? "unavailable" : "ready",
      lastPersistedAt: this.lastPersistedAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  markUnavailable(error: unknown): void {
    this.lastErrorAt = new Date();
    this.lastError = safeText(error instanceof Error ? error.message : String(error), 320);
    logger.warn(
      { error: this.lastError },
      "Runtime supervisor incident persistence is unavailable; market and alert workflows remain isolated",
    );
  }

  async record(input: RuntimeIncidentInput): Promise<void> {
    const occurredAt = input.occurredAt ?? new Date();
    const incidentKey = safeText(input.incidentKey, 160);
    const component = safeText(input.component, 64);
    const reasonCode = safeText(input.reasonCode, 96);
    const reason = safeText(input.reason, 500);
    const evidence = normalizeEvidence(input.evidence);
    const incrementsOccurrence = input.event === "detected" || input.event === "observed";

    try {
      await db
        .insert(runtimeSupervisorIncidentsTable)
        .values({
          incidentKey,
          component,
          reasonCode,
          severity: input.severity,
          state: input.state,
          source: "runtime",
          firstDetectedAt: occurredAt,
          lastObservedAt: occurredAt,
          resolvedAt: input.state === "resolved" ? occurredAt : null,
          occurrenceCount: 1,
          evidence,
          lastRecovery: input.recovery ?? null,
          diagnosticPayload: null,
          updatedAt: occurredAt,
        })
        .onConflictDoUpdate({
          target: runtimeSupervisorIncidentsTable.incidentKey,
          set: {
            component,
            reasonCode,
            severity: input.severity,
            state: input.state,
            source: "runtime",
            lastObservedAt: occurredAt,
            resolvedAt: input.state === "resolved" ? occurredAt : null,
            occurrenceCount: incrementsOccurrence
              ? sql`${runtimeSupervisorIncidentsTable.occurrenceCount} + 1`
              : runtimeSupervisorIncidentsTable.occurrenceCount,
            evidence,
            lastRecovery: input.recovery ?? null,
            diagnosticPayload: null,
            updatedAt: occurredAt,
          },
        });
      await db.insert(runtimeSupervisorAuditTable).values({
        incidentKey,
        component,
        reasonCode,
        event: input.event,
        severity: input.severity,
        source: "runtime",
        reason,
        evidence,
        recovery: input.recovery ?? null,
        diagnosticPayload: null,
        occurredAt,
      });
      this.lastPersistedAt = occurredAt;
      this.lastErrorAt = null;
      this.lastError = null;
    } catch (error) {
      this.markUnavailable(error);
    }
  }

  async recordDiagnostic(input: DiagnosticPersistenceInput): Promise<void> {
    const occurredAt = input.occurredAt ?? new Date();
    const incidentKey = safeText(input.incidentKey, 160);
    const reason = safeText(input.reason, 500);
    const evidence = normalizeEvidence(input.evidence);
    try {
      await db
        .insert(runtimeSupervisorIncidentsTable)
        .values({
          incidentKey,
          component: "diagnostics",
          reasonCode: safeText(input.payload.report.moduleId, 96),
          severity: input.severity,
          state: input.state,
          source: "diagnostics",
          firstDetectedAt: occurredAt,
          lastObservedAt: occurredAt,
          resolvedAt: input.state === "resolved" ? occurredAt : null,
          occurrenceCount: 1,
          evidence,
          lastRecovery: null,
          diagnosticPayload: input.payload,
          updatedAt: occurredAt,
        })
        .onConflictDoUpdate({
          target: runtimeSupervisorIncidentsTable.incidentKey,
          set: {
            component: "diagnostics",
            reasonCode: safeText(input.payload.report.moduleId, 96),
            severity: input.severity,
            state: input.state,
            source: "diagnostics",
            lastObservedAt: occurredAt,
            resolvedAt: input.state === "resolved" ? occurredAt : null,
            occurrenceCount: sql`${runtimeSupervisorIncidentsTable.occurrenceCount} + 1`,
            evidence,
            lastRecovery: null,
            diagnosticPayload: input.payload,
            updatedAt: occurredAt,
          },
        });
      await db.insert(runtimeSupervisorAuditTable).values({
        incidentKey,
        component: "diagnostics",
        reasonCode: safeText(input.payload.report.moduleId, 96),
        event: input.event,
        severity: input.severity,
        source: "diagnostics",
        reason,
        evidence,
        recovery: null,
        diagnosticPayload: input.payload,
        occurredAt,
      });
      this.lastPersistedAt = occurredAt;
      this.lastErrorAt = null;
      this.lastError = null;
    } catch (error) {
      this.markUnavailable(error);
    }
  }

  async listRecent(limit = 20) {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return db
      .select()
      .from(runtimeSupervisorIncidentsTable)
      .orderBy(desc(runtimeSupervisorIncidentsTable.lastObservedAt))
      .limit(boundedLimit);
  }

  async getByKey(incidentKey: string) {
    const [incident] = await db
      .select()
      .from(runtimeSupervisorIncidentsTable)
      .where(eq(runtimeSupervisorIncidentsTable.incidentKey, incidentKey))
      .limit(1);
    return incident ?? null;
  }

  async listRecentDiagnostics(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const [incidents, events] = await Promise.all([
      db
        .select()
        .from(runtimeSupervisorIncidentsTable)
        .where(eq(runtimeSupervisorIncidentsTable.source, "diagnostics"))
        .orderBy(desc(runtimeSupervisorIncidentsTable.lastObservedAt))
        .limit(boundedLimit),
      db
        .select()
        .from(runtimeSupervisorAuditTable)
        .where(eq(runtimeSupervisorAuditTable.source, "diagnostics"))
        .orderBy(desc(runtimeSupervisorAuditTable.occurredAt))
        .limit(boundedLimit),
    ]);
    return { incidents, events };
  }
}

/** Shared database boundary for runtime supervision and Diagnostics Center. */
export const runtimeIncidentStore = new RuntimeIncidentStore();
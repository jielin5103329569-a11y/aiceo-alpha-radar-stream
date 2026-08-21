import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Operational incidents are intentionally outside the Alpha Radar decision
 * path. They describe service supervision only and must never supply market
 * freshness, a score, candidate eligibility, or Alert authority.
 */
export type RuntimeSupervisorEvidence = {
  summary: string;
  componentState: string;
  details: Record<string, string | number | boolean | null>;
};

export type RuntimeSupervisorRecoveryAudit = {
  action: string;
  outcome: "scheduled" | "succeeded" | "failed" | "skipped";
  reason: string;
  attemptedAt: string;
};

/**
 * Versioned, diagnostic-only payload attached to the existing operational
 * incident/audit records. It is never joined into Alpha Radar data paths.
 */
export type RuntimeDiagnosticPayload = {
  schemaVersion: 1;
  report: {
    id: string;
    moduleId: string;
    category: string;
    priority: string;
    disposition: string;
    status: "active" | "resolved";
    symptom: string;
    rootCause: string | null;
    candidateRootCauses: string[];
    impactScope: string;
    recommendedFix: string;
    validation: {
      id: string;
      label: string;
      state: string;
      reason: string;
      checkedAt: string;
    };
    remainingRisk: string;
    evidence: Array<{
      source: string;
      summary: string;
      facts: Record<string, string | number | boolean | null>;
      collectedAt: string;
    }>;
    firstObservedAt: string;
    lastObservedAt: string;
  };
  event: {
    id: string;
    kind: "detected" | "observed" | "recovery";
    occurredAt: string;
    summary: string;
  };
};

export const runtimeSupervisorIncidentsTable = pgTable(
  "runtime_supervisor_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable component/reason identity; repeated observations update one incident. */
    incidentKey: varchar("incident_key", { length: 160 }).notNull(),
    component: varchar("component", { length: 64 }).notNull(),
    reasonCode: varchar("reason_code", { length: 96 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull(),
    /** "open" | "recovering" | "resolved" */
    state: varchar("state", { length: 16 }).notNull(),
    /** "runtime" | "diagnostics"; isolates shared persistence consumers. */
    source: varchar("source", { length: 32 }).notNull().default("runtime"),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    evidence: jsonb("evidence").$type<RuntimeSupervisorEvidence>().notNull(),
    lastRecovery: jsonb("last_recovery").$type<RuntimeSupervisorRecoveryAudit | null>(),
    diagnosticPayload: jsonb("diagnostic_payload").$type<RuntimeDiagnosticPayload | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("runtime_supervisor_incident_key_unique").on(table.incidentKey),
    index("runtime_supervisor_incidents_state_observed_idx").on(table.state, table.lastObservedAt),
    index("runtime_supervisor_incidents_component_observed_idx").on(table.component, table.lastObservedAt),
    index("runtime_supervisor_incidents_source_observed_idx").on(table.source, table.lastObservedAt),
  ],
);

/**
 * Append-only evidence of incident transitions and supervisor decisions.
 * This remains a diagnostic record; it is never joined into live radar data.
 */
export const runtimeSupervisorAuditTable = pgTable(
  "runtime_supervisor_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentKey: varchar("incident_key", { length: 160 }).notNull(),
    component: varchar("component", { length: 64 }).notNull(),
    reasonCode: varchar("reason_code", { length: 96 }).notNull(),
    event: varchar("event", { length: 40 }).notNull(),
    /** "runtime" | "diagnostics"; isolates shared persistence consumers. */
    source: varchar("source", { length: 32 }).notNull().default("runtime"),
    severity: varchar("severity", { length: 16 }).notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").$type<RuntimeSupervisorEvidence>().notNull(),
    recovery: jsonb("recovery").$type<RuntimeSupervisorRecoveryAudit | null>(),
    diagnosticPayload: jsonb("diagnostic_payload").$type<RuntimeDiagnosticPayload | null>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("runtime_supervisor_audit_incident_occurred_idx").on(table.incidentKey, table.occurredAt),
    index("runtime_supervisor_audit_occurred_idx").on(table.occurredAt),
    index("runtime_supervisor_audit_source_occurred_idx").on(table.source, table.occurredAt),
  ],
);

export const insertRuntimeSupervisorIncidentSchema = createInsertSchema(runtimeSupervisorIncidentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRuntimeSupervisorAuditSchema = createInsertSchema(runtimeSupervisorAuditTable).omit({
  id: true,
  createdAt: true,
});

export type RuntimeSupervisorIncident = typeof runtimeSupervisorIncidentsTable.$inferSelect;
export type RuntimeSupervisorAuditEvent = typeof runtimeSupervisorAuditTable.$inferSelect;
export type InsertRuntimeSupervisorIncident = z.infer<typeof insertRuntimeSupervisorIncidentSchema>;
export type InsertRuntimeSupervisorAudit = z.infer<typeof insertRuntimeSupervisorAuditSchema>;
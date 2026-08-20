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

/**
 * Operational queue state is intentionally isolated from Alpha Radar market,
 * scoring, candidate, and Alert decision data.
 */
export type AutonomousOperationCheckpoint = {
  phase: string;
  attempt: number;
  details: Record<string, string | number | boolean | null>;
};

export type AutonomousOperationEvidence = {
  summary: string;
  details: Record<string, string | number | boolean | null>;
};

export const autonomousOperationsWorkItemsTable = pgTable(
  "autonomous_operations_work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workKey: varchar("work_key", { length: 160 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    ownerModule: varchar("owner_module", { length: 120 }).notNull(),
    implementationKey: varchar("implementation_key", { length: 160 }).notNull(),
    state: varchar("state", { length: 32 }).notNull(),
    dependsOn: jsonb("depends_on").$type<string[]>().notNull(),
    resourceClaims: jsonb("resource_claims").$type<string[]>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    retryBaseDelayMs: integer("retry_base_delay_ms").notNull(),
    executionTimeoutMs: integer("execution_timeout_ms").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    runId: varchar("run_id", { length: 200 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    checkpoint: jsonb("checkpoint").$type<AutonomousOperationCheckpoint | null>(),
    verificationEvidence: jsonb("verification_evidence").$type<AutonomousOperationEvidence | null>(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("autonomous_operations_work_key_unique").on(table.workKey),
    uniqueIndex("autonomous_operations_implementation_key_unique").on(table.implementationKey),
    index("autonomous_operations_work_state_next_run_idx").on(table.state, table.nextRunAt),
  ],
);

/** Append-only operator evidence; it is never read by market or Alert code. */
export const autonomousOperationsAuditTable = pgTable(
  "autonomous_operations_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workKey: varchar("work_key", { length: 160 }),
    event: varchar("event", { length: 48 }).notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").$type<AutonomousOperationEvidence>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("autonomous_operations_audit_work_occurred_idx").on(table.workKey, table.occurredAt),
    index("autonomous_operations_audit_occurred_idx").on(table.occurredAt),
  ],
);
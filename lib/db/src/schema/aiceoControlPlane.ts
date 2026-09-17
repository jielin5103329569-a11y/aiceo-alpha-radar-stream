import {
  boolean,
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
import { sql } from "drizzle-orm";

/** ARCH-001's provider-neutral, non-executing control-plane vocabulary. */
export const AICEO_TASK_STATES = [
  "QUEUED", "RUNNING", "VALIDATING", "COMPLETED", "FAILED",
  "UNKNOWN", "STALE", "BLOCKED", "CANCELLED",
] as const;
export type AiceoTaskState = (typeof AICEO_TASK_STATES)[number];

export type AiceoPermissions = {
  actions: string[];
  resources: string[];
  explicitDenies: string[];
};

export type AiceoBudget = {
  estimatedTokens: number;
  reservedTokens: number;
  actualTokens: number;
  estimatedCalls: number;
  reservedCalls: number;
  actualCalls: number;
  estimatedUsd: string;
  reservedUsd: string;
  actualUsd: string;
};

export type AiceoOwnerProtectionRedLine =
  | "financial_and_physical_assets"
  | "legal_liability"
  | "aiceo_system_integrity";

export const aiceoSourceRegistryTable = pgTable("aiceo_source_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  catalogId: varchar("catalog_id", { length: 180 }).notNull(),
  provider: varchar("provider", { length: 80 }).notNull(),
  model: varchar("model", { length: 120 }),
  configured: boolean("configured").notNull().default(false),
  connected: boolean("connected").notNull().default(false),
  tested: boolean("tested").notNull().default(false),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_source_catalog_id_unique").on(table.catalogId),
]);

export const aiceoPolicyRegistryTable = pgTable("aiceo_policy_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  foundationId: varchar("foundation_id", { length: 32 }).notNull(),
  version: varchar("version", { length: 80 }).notNull(),
  policyHash: varchar("policy_hash", { length: 128 }).notNull(),
  policyText: text("policy_text").notNull(),
  frozen: boolean("frozen").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_policy_foundation_version_unique").on(table.foundationId, table.version),
  uniqueIndex("aiceo_policy_foundation_hash_unique").on(table.foundationId, table.policyHash),
]);

export const aiceoControlStateTable = pgTable("aiceo_control_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  queueActive: boolean("queue_active").notNull().default(false),
  killSwitch: boolean("kill_switch").notNull().default(false),
  circuitState: varchar("circuit_state", { length: 16 }).notNull().default("CLOSED"),
  circuitFailureCount: integer("circuit_failure_count").notNull().default(0),
  circuitThreshold: integer("circuit_threshold").notNull().default(3),
  circuitCooldownMs: integer("circuit_cooldown_ms").notNull().default(60_000),
  circuitHalfOpenAt: timestamp("circuit_half_open_at", { withTimezone: true }),
  aggregateTokenCap: integer("aggregate_token_cap").notNull().default(8192),
  aggregateCallCap: integer("aggregate_call_cap").notNull().default(8),
  aggregateUsdCap: varchar("aggregate_usd_cap", { length: 32 }).notNull().default("0.50"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: varchar("acknowledged_by", { length: 180 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, () => [
  uniqueIndex("aiceo_control_state_singleton_unique").on(sql`(true)`),
]);

export const aiceoTasksTable = pgTable("aiceo_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  correlationId: uuid("correlation_id").notNull(),
  runId: uuid("run_id"),
  sourceId: uuid("source_id"),
  policyId: uuid("policy_id"),
  state: varchar("state", { length: 16 }).notNull(),
  action: varchar("action", { length: 120 }).notNull(),
  resource: varchar("resource", { length: 180 }).notNull(),
  permissions: jsonb("permissions").$type<AiceoPermissions>().notNull(),
  contractVersion: varchar("contract_version", { length: 80 }).notNull(),
  contractHash: varchar("contract_hash", { length: 128 }).notNull(),
  environment: varchar("environment", { length: 24 }).notNull(),
  authority: varchar("authority", { length: 120 }).notNull(),
  governanceClassification: varchar("governance_classification", { length: 40 }).notNull(),
  ownerProtectionRedLines: jsonb("owner_protection_red_lines").$type<AiceoOwnerProtectionRedLine[]>().notNull(),
  ownerGovernanceApprovedAt: timestamp("owner_governance_approved_at", { withTimezone: true }),
  ownerGovernanceApprovedBy: varchar("owner_governance_approved_by", { length: 180 }),
  ownerGovernanceApprovalHash: varchar("owner_governance_approval_hash", { length: 128 }),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  budget: jsonb("budget").$type<AiceoBudget>().notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  maxRetries: integer("max_retries").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  providerAttemptId: uuid("provider_attempt_id"),
  providerAttemptDeadlineAt: timestamp("provider_attempt_deadline_at", { withTimezone: true }),
  providerTimestamp: timestamp("provider_timestamp", { withTimezone: true }),
  clientTimestamp: timestamp("client_timestamp", { withTimezone: true }),
  serverTimestamp: timestamp("server_timestamp", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("aiceo_tasks_state_updated_idx").on(table.state, table.updatedAt),
  index("aiceo_tasks_correlation_idx").on(table.correlationId),
  index("aiceo_tasks_provider_attempt_deadline_idx")
    .on(table.providerAttemptDeadlineAt)
    .where(sql`${table.state} = 'RUNNING' and ${table.providerAttemptId} is not null`),
  // The database is the authority for the one-active-task invariant.
  uniqueIndex("aiceo_tasks_one_active_unique")
    .on(sql`(true)`)
    .where(sql`${table.state} in ('RUNNING', 'VALIDATING')`),
]);

export const aiceoAuditEventsTable = pgTable("aiceo_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id"),
  correlationId: uuid("correlation_id").notNull(),
  runId: uuid("run_id"),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  state: varchar("state", { length: 16 }),
  actorId: varchar("actor_id", { length: 180 }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  previousHash: varchar("previous_hash", { length: 128 }),
  eventHash: varchar("event_hash", { length: 128 }).notNull(),
  clientTimestamp: timestamp("client_timestamp", { withTimezone: true }),
  serverTimestamp: timestamp("server_timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_audit_event_hash_unique").on(table.eventHash),
  index("aiceo_audit_task_server_time_idx").on(table.taskId, table.serverTimestamp),
]);
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

export const AICEO_CONTINUITY_STATES = [
  "RUNNING", "PAUSED", "FAILED", "COMPLETED", "OWNER_GATE",
] as const;
export type AiceoContinuityState = (typeof AICEO_CONTINUITY_STATES)[number];

export const aiceoContinuityProjectsTable = pgTable("aiceo_continuity_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectKey: varchar("project_key", { length: 120 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  purpose: text("purpose").notNull(),
  authority: varchar("authority", { length: 120 }).notNull().default("grok_restricted_development"),
  environment: varchar("environment", { length: 24 }).notNull().default("development"),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("aiceo_continuity_project_key_unique").on(table.projectKey)]);

export const aiceoContinuityStateTable = pgTable("aiceo_continuity_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  state: varchar("state", { length: 20 }).notNull(),
  currentState: jsonb("current_state").$type<Record<string, unknown>>().notNull(),
  decisionRuleRegistry: jsonb("decision_rule_registry").$type<Record<string, unknown>[]>().notNull(),
  entityRegistry: jsonb("entity_registry").$type<Record<string, unknown>[]>().notNull(),
  aliasDictionary: jsonb("alias_dictionary").$type<Record<string, unknown>>().notNull(),
  evidencePointers: jsonb("evidence_pointers").$type<Record<string, unknown>[]>().notNull(),
  resumeNode: jsonb("resume_node").$type<Record<string, unknown>>().notNull(),
  failureReason: text("failure_reason"),
  recoveryStrategy: text("recovery_strategy"),
  ownerGateReason: text("owner_gate_reason"),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  supervisorVersion: varchar("supervisor_version", { length: 80 }).notNull().default("CONTINUITY-001"),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_continuity_project_state_unique").on(table.projectId),
  index("aiceo_continuity_state_heartbeat_idx").on(table.state, table.heartbeatAt),
  uniqueIndex("aiceo_continuity_one_running_unique").on(sql`(true)`).where(sql`${table.state} = 'RUNNING'`),
]);

export const aiceoContinuityEventsTable = pgTable("aiceo_continuity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  state: varchar("state", { length: 20 }).notNull(),
  actorId: varchar("actor_id", { length: 180 }).notNull(),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  previousHash: varchar("previous_hash", { length: 128 }),
  eventHash: varchar("event_hash", { length: 128 }).notNull(),
  serverTimestamp: timestamp("server_timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_continuity_event_hash_unique").on(table.eventHash),
  index("aiceo_continuity_event_project_time_idx").on(table.projectId, table.serverTimestamp),
]);

export const aiceoCollaborationIssuesTable = pgTable("aiceo_collaboration_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  summary: text("summary").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().notNull(),
  rootCause: text("root_cause"),
  desiredBehavior: text("desired_behavior"),
  status: varchar("status", { length: 32 }).notNull().default("CAPTURED"),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 180 }).notNull(),
}, (table) => [index("aiceo_collaboration_issue_status_idx").on(table.status, table.lastObservedAt)]);

export const aiceoCollaborationRulesTable = pgTable("aiceo_collaboration_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  issueId: uuid("issue_id").notNull(),
  ruleKey: varchar("rule_key", { length: 120 }).notNull(),
  version: integer("version").notNull(),
  ruleText: text("rule_text").notNull(),
  source: text("source").notNull(),
  reason: text("reason").notNull(),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
  classification: varchar("classification", { length: 32 }).notNull(),
  conflictCheck: jsonb("conflict_check").$type<Record<string, unknown>>().notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  validationResult: jsonb("validation_result").$type<Record<string, unknown>>(),
  supersedesRuleId: uuid("supersedes_rule_id"),
  rollbackOfRuleId: uuid("rollback_of_rule_id"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  createdBy: varchar("created_by", { length: 180 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_collaboration_rule_version_unique").on(table.projectId, table.ruleKey, table.version),
  index("aiceo_collaboration_rule_status_idx").on(table.status, table.createdAt),
]);

export const aiceoIntentConfirmationsTable = pgTable("aiceo_intent_confirmations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  confirmationKey: varchar("confirmation_key", { length: 180 }).notNull(),
  ownerActorId: varchar("owner_actor_id", { length: 180 }).notNull(),
  continuityRevision: integer("continuity_revision").notNull(),
  ownerExpression: text("owner_expression").notNull(),
  interpretedIntent: text("interpreted_intent").notNull(),
  actionTarget: text("action_target").notNull(),
  contextHash: varchar("context_hash", { length: 128 }).notNull(),
  intentHash: varchar("intent_hash", { length: 128 }).notNull(),
  executionBindingHash: varchar("execution_binding_hash", { length: 128 }).notNull(),
  riskLevel: varchar("risk_level", { length: 24 }).notNull(),
  reasonableInterpretations: jsonb("reasonable_interpretations").$type<Record<string, unknown>[]>().notNull(),
  status: varchar("status", { length: 24 }).notNull().default("CONFIRMED"),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_intent_confirmation_key_unique").on(table.projectId, table.confirmationKey),
  index("aiceo_intent_confirmation_revision_idx").on(table.projectId, table.continuityRevision, table.createdAt),
]);

export const aiceoExecutionContractsTable = pgTable("aiceo_execution_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
  ownerIntent: text("owner_intent").notNull(),
  brainActorId: varchar("brain_actor_id", { length: 180 }).notNull(),
  continuityRevision: integer("continuity_revision").notNull(),
  contextHash: varchar("context_hash", { length: 128 }).notNull(),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
  objective: text("objective").notNull(),
  allowedCapabilities: jsonb("allowed_capabilities").$type<string[]>().notNull(),
  deniedCapabilities: jsonb("denied_capabilities").$type<string[]>().notNull(),
  authorityBoundaries: jsonb("authority_boundaries").$type<Record<string, unknown>>().notNull(),
  frozenRules: jsonb("frozen_rules").$type<Record<string, unknown>[]>().notNull(),
  completionDefinition: jsonb("completion_definition").$type<Record<string, unknown>>().notNull(),
  evidenceRequirements: jsonb("evidence_requirements").$type<Record<string, unknown>[]>().notNull(),
  executionPolicy: jsonb("execution_policy").$type<Record<string, unknown>>().notNull(),
  resumeNode: jsonb("resume_node").$type<Record<string, unknown>>().notNull(),
  escalationConditions: jsonb("escalation_conditions").$type<Record<string, unknown>[]>().notNull(),
  ownerAttentionBudget: jsonb("owner_attention_budget").$type<Record<string, unknown>>().notNull(),
  intentConfirmationId: uuid("intent_confirmation_id"),
  maxDelegationDepth: integer("max_delegation_depth").notNull().default(1),
  status: varchar("status", { length: 32 }).notNull().default("ISSUED"),
  contractVersion: varchar("contract_version", { length: 80 }).notNull().default("BRAIN-AGENT-001"),
  contractHash: varchar("contract_hash", { length: 128 }).notNull(),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_execution_contract_idempotency_unique").on(table.projectId, table.idempotencyKey),
  uniqueIndex("aiceo_execution_contract_intent_confirmation_unique").on(table.intentConfirmationId),
  index("aiceo_execution_contract_status_idx").on(table.status, table.createdAt),
]);

export const aiceoAgentRunsTable = pgTable("aiceo_agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
  agentType: varchar("agent_type", { length: 40 }).notNull(),
  agentActorId: varchar("agent_actor_id", { length: 180 }).notNull(),
  parentRunId: uuid("parent_run_id"),
  delegationDepth: integer("delegation_depth").notNull().default(0),
  inheritedAuthority: varchar("inherited_authority", { length: 120 }).notNull(),
  contextHash: varchar("context_hash", { length: 128 }).notNull(),
  state: varchar("state", { length: 32 }).notNull(),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull(),
  observedScope: jsonb("observed_scope").$type<string[]>().notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  evidence: jsonb("evidence").$type<Record<string, unknown>[]>(),
  blocker: text("blocker"),
  intentResolutionConfirmationId: uuid("intent_resolution_confirmation_id"),
  retryCount: integer("retry_count").notNull().default(0),
  usedCalls: integer("used_calls").notNull().default(0),
  usedCostMicrousd: integer("used_cost_microusd").notNull().default(0),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_agent_run_idempotency_unique").on(table.contractId, table.idempotencyKey),
  uniqueIndex("aiceo_agent_run_intent_resolution_confirmation_unique").on(table.intentResolutionConfirmationId),
  uniqueIndex("aiceo_agent_one_running_unique").on(sql`(true)`).where(sql`${table.state} = 'RUNNING'`),
  index("aiceo_agent_run_deadline_idx").on(table.state, table.deadlineAt),
]);

export const aiceoAgentVerificationsTable = pgTable("aiceo_agent_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  validatorActorId: varchar("validator_actor_id", { length: 180 }).notNull(),
  passed: boolean("passed").notNull(),
  compliance: jsonb("compliance").$type<Record<string, boolean>>().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull(),
  resultHash: varchar("result_hash", { length: 128 }).notNull(),
  finalStatus: varchar("final_status", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("aiceo_agent_verification_run_unique").on(table.runId)]);
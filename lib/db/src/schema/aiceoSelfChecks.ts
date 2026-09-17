import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const AICEO_SELF_CHECK_SCOPES = ["local", "chain", "global"] as const;
export const AICEO_SELF_CHECK_STATUSES = ["healthy", "degraded", "failed", "unknown"] as const;
export type AiceoSelfCheckScope = (typeof AICEO_SELF_CHECK_SCOPES)[number];
export type AiceoSelfCheckStatus = (typeof AICEO_SELF_CHECK_STATUSES)[number];

export const aiceoSelfCheckReportsTable = pgTable("aiceo_self_check_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  runId: uuid("run_id").notNull(),
  scope: varchar("scope", { length: 16 }).$type<AiceoSelfCheckScope>().notNull(),
  chainKey: varchar("chain_key", { length: 120 }).notNull(),
  moduleKey: varchar("module_key", { length: 120 }),
  contractVersion: varchar("contract_version", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).$type<AiceoSelfCheckStatus>().notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  dimensions: jsonb("dimensions").$type<Record<string, AiceoSelfCheckStatus>>().notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  anomalies: jsonb("anomalies").$type<string[]>().notNull(),
  evidenceLineage: jsonb("evidence_lineage").$type<Record<string, unknown>[]>().notNull(),
  childReportIds: uuid("child_report_ids").array().notNull(),
  faultDomains: jsonb("fault_domains").$type<string[]>().notNull(),
  escalation: varchar("escalation", { length: 16 }).notNull(),
  diagnosticDepth: varchar("diagnostic_depth", { length: 16 }).notNull(),
  escalationReason: text("escalation_reason"),
  rawPayloadIncluded: boolean("raw_payload_included").notNull().default(false),
  appendSequence: bigint("append_sequence", { mode: "number" }).notNull(),
  previousHash: varchar("previous_hash", { length: 128 }),
  reportHash: varchar("report_hash", { length: 128 }).notNull(),
  independentValidation: boolean("independent_validation").notNull().default(false),
  closureAuthority: boolean("closure_authority").notNull().default(false),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_self_check_project_sequence_unique").on(table.projectId, table.appendSequence),
  index("aiceo_self_check_health_idx").on(table.projectId, table.scope, table.chainKey, table.checkedAt),
]);

export const aiceoSelfCheckChainContractsTable = pgTable("aiceo_self_check_chain_contracts", {
  chainKey: varchar("chain_key", { length: 120 }).primaryKey(),
  contractVersion: varchar("contract_version", { length: 32 }).notNull(),
  requiredModuleKeys: varchar("required_module_keys", { length: 120 }).array().notNull(),
  active: boolean("active").notNull().default(true),
  productionAuthority: boolean("production_authority").notNull().default(false),
});
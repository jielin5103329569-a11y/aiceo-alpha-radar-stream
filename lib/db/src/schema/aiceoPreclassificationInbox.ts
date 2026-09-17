import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const AICEO_FUTURE_MEMORY_SPACES = [
  "decision_memory", "knowledge_memory", "experience_learning_memory",
  "collaboration_memory", "project_roadmap_memory",
] as const;
export type AiceoFutureMemorySpace = (typeof AICEO_FUTURE_MEMORY_SPACES)[number];

export const aiceoPreclassificationMemoryInboxTable = pgTable("aiceo_preclassification_memory_inbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  seedBatchKey: varchar("seed_batch_key", { length: 120 }).notNull(),
  stableKey: varchar("stable_key", { length: 160 }).notNull(),
  rawSemantics: text("raw_semantics").notNull(),
  sourceType: varchar("source_type", { length: 40 }).notNull(),
  sourceContext: jsonb("source_context").$type<Record<string, unknown>>().notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  futureClassificationHints: varchar("future_classification_hints", { length: 80 }).array().$type<AiceoFutureMemorySpace[]>().notNull(),
  valueTier: varchar("value_tier", { length: 16 }).notNull(),
  epistemicState: varchar("epistemic_state", { length: 48 }).notNull(),
  lifecycle: varchar("lifecycle", { length: 64 }).notNull(),
  migrationRequirements: jsonb("migration_requirements").$type<Record<string, boolean>>().notNull(),
  sourceDigest: varchar("source_digest", { length: 64 }).notNull(),
  appendSequence: bigint("append_sequence", { mode: "number" }).notNull(),
  previousHash: varchar("previous_hash", { length: 64 }),
  recordHash: varchar("record_hash", { length: 64 }).notNull(),
  operationalInput: boolean("operational_input").notNull().default(false),
  retrievalAuthority: boolean("retrieval_authority").notNull().default(false),
  promotionAuthority: boolean("promotion_authority").notNull().default(false),
  governanceAuthority: boolean("governance_authority").notNull().default(false),
  productionAuthority: boolean("production_authority").notNull().default(false),
  preserveSourceContextTimeSnapshot: boolean("preserve_source_context_time_snapshot").notNull().default(true),
  migrationContractHash: varchar("migration_contract_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_preclassification_inbox_project_key_unique").on(table.projectId, table.stableKey),
  uniqueIndex("aiceo_preclassification_inbox_project_sequence_unique").on(table.projectId, table.appendSequence),
  index("aiceo_preclassification_inbox_batch_idx").on(table.projectId, table.seedBatchKey, table.appendSequence),
]);

export const aiceoPreclassificationSeedManifestTable = pgTable("aiceo_preclassification_seed_manifest", {
  seedBatchKey: varchar("seed_batch_key", { length: 120 }).notNull(),
  stableKey: varchar("stable_key", { length: 160 }).notNull(),
  rawSemanticsDigest: varchar("raw_semantics_digest", { length: 64 }).notNull(),
  productionAuthority: boolean("production_authority").notNull().default(false),
});
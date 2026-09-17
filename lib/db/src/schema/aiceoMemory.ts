import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const AICEO_MEMORY_LAYERS = ["working", "episodic", "semantic", "procedural", "governance"] as const;
export const AICEO_MEMORY_TYPES = ["observation", "fact", "interpretation", "hypothesis", "decision", "rule"] as const;
export const AICEO_COGNITIVE_STATES = AICEO_MEMORY_TYPES;
export const AICEO_TRUTH_LEVELS = ["unverified", "supported", "verified", "owner_asserted"] as const;
export const AICEO_AUTHORITY_LEVELS = ["ordinary_agent", "external_source", "brain", "owner", "governance"] as const;
export const AICEO_MEMORY_LIFECYCLES = ["candidate", "promoted", "superseded", "expired", "rejected"] as const;
export const AICEO_THOUGHT_NODE_KINDS = [
  "motivation", "context", "observation", "interpretation", "belief", "hypothesis",
  "principle", "decision", "action", "outcome", "reflection", "updated_belief", "next_decision",
] as const;
export type AiceoThoughtNodeKind = (typeof AICEO_THOUGHT_NODE_KINDS)[number];
export type AiceoMemoryType = (typeof AICEO_MEMORY_TYPES)[number];
export type AiceoMemoryLayer = (typeof AICEO_MEMORY_LAYERS)[number];

export type AiceoEvidenceLineage = {
  sourceId: string;
  sourceType: string;
  evidenceHash: string;
  observedAt: string;
  validFrom?: string;
  validUntil?: string;
};

export const aiceoMemoryCandidatesTable = pgTable("aiceo_memory_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  content: text("content").notNull(),
  memoryLayer: varchar("memory_layer", { length: 24 }).notNull(),
  memoryType: varchar("memory_type", { length: 24 }).notNull(),
  cognitiveState: varchar("cognitive_state", { length: 24 }).notNull(),
  truthLevel: varchar("truth_level", { length: 24 }).notNull().default("unverified"),
  authorityLevel: varchar("authority_level", { length: 24 }).notNull(),
  sourceActorId: varchar("source_actor_id", { length: 180 }).notNull(),
  evidenceLineage: jsonb("evidence_lineage").$type<AiceoEvidenceLineage[]>().notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  lifecycle: varchar("lifecycle", { length: 24 }).notNull().default("candidate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("aiceo_memory_candidate_project_idx").on(table.projectId, table.createdAt),
]);

export const aiceoPromotedMemoriesTable = pgTable("aiceo_promoted_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull(),
  candidateProjectId: uuid("candidate_project_id").notNull(),
  projectId: uuid("project_id").notNull(),
  content: text("content").notNull(),
  memoryLayer: varchar("memory_layer", { length: 24 }).notNull(),
  memoryType: varchar("memory_type", { length: 24 }).notNull(),
  cognitiveState: varchar("cognitive_state", { length: 24 }).notNull(),
  truthLevel: varchar("truth_level", { length: 24 }).notNull(),
  authorityLevel: varchar("authority_level", { length: 24 }).notNull(),
  evidenceLineage: jsonb("evidence_lineage").$type<AiceoEvidenceLineage[]>().notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  promotedBy: varchar("promoted_by", { length: 180 }).notNull(),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_promoted_memory_candidate_unique").on(table.candidateId),
  index("aiceo_promoted_memory_project_idx").on(table.projectId, table.createdAt),
]);

export const aiceoMemoryEventsTable = pgTable("aiceo_memory_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  candidateId: uuid("candidate_id"),
  promotedMemoryId: uuid("promoted_memory_id"),
  eventType: varchar("event_type", { length: 40 }).notNull(),
  actorId: varchar("actor_id", { length: 180 }).notNull(),
  actorAuthority: varchar("actor_authority", { length: 24 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  previousHash: varchar("previous_hash", { length: 128 }),
  eventHash: varchar("event_hash", { length: 128 }).notNull(),
  appendSequence: bigint("append_sequence", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_memory_event_hash_unique").on(table.eventHash),
  uniqueIndex("aiceo_memory_event_project_sequence_unique").on(table.projectId, table.appendSequence),
  index("aiceo_memory_event_project_idx").on(table.projectId, table.createdAt),
]);

export const aiceoThoughtNodesTable = pgTable("aiceo_thought_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphId: uuid("graph_id").notNull(),
  projectId: uuid("project_id").notNull(),
  memoryCandidateId: uuid("memory_candidate_id").notNull(),
  nodeKind: varchar("node_kind", { length: 32 }).$type<AiceoThoughtNodeKind>().notNull(),
  epistemicState: varchar("epistemic_state", { length: 32 }).notNull(),
  parentNodeId: uuid("parent_node_id"),
  relationFromParent: varchar("relation_from_parent", { length: 32 }),
  supersedesNodeId: uuid("supersedes_node_id"),
  intendedResult: text("intended_result"),
  outcomeValidation: jsonb("outcome_validation").$type<Record<string, unknown>>().notNull(),
  counterfactuals: jsonb("counterfactuals").$type<Record<string, unknown>[]>().notNull(),
  appendSequence: bigint("append_sequence", { mode: "number" }).notNull(),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_thought_node_candidate_unique").on(table.memoryCandidateId),
  uniqueIndex("aiceo_thought_node_graph_sequence_unique").on(table.graphId, table.appendSequence),
  index("aiceo_thought_node_project_graph_idx").on(table.projectId, table.graphId, table.appendSequence),
]);

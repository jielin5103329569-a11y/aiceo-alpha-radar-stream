import { bigint, boolean, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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
  unique("aiceo_memory_candidate_id_project_unique").on(table.id, table.projectId),
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
  foreignKey({
    columns: [table.candidateId, table.candidateProjectId],
    foreignColumns: [aiceoMemoryCandidatesTable.id, aiceoMemoryCandidatesTable.projectId],
    name: "aiceo_promoted_memory_candidate_project_fk",
  }).onDelete("restrict"),
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

export const aiceoRetrievalRequestsTable = pgTable("aiceo_retrieval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
  requestedBy: varchar("requested_by", { length: 180 }).notNull(),
  requesterRole: varchar("requester_role", { length: 32 }).notNull(),
  purpose: varchar("purpose", { length: 40 }).notNull(),
  task: text("task").notNull(),
  intent: text("intent").notNull(),
  entities: jsonb("entities").$type<string[]>().notNull(),
  query: text("query").notNull(),
  requestedLayers: varchar("requested_layers", { length: 24 }).array().notNull(),
  requestedTypes: varchar("requested_types", { length: 24 }).array().notNull(),
  maxItems: bigint("max_items", { mode: "number" }).notNull(),
  maxBytes: bigint("max_bytes", { mode: "number" }).notNull(),
  scanLimit: bigint("scan_limit", { mode: "number" }).notNull(),
  persistentRevision: bigint("persistent_revision", { mode: "number" }).notNull(),
  persistentStateHash: varchar("persistent_state_hash", { length: 64 }).notNull(),
  verifiedResumeNode: jsonb("verified_resume_node").$type<Record<string, unknown>>().notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  requestHmac: varchar("request_hmac", { length: 64 }).notNull(),
  grantSnapshot: jsonb("grant_snapshot").$type<Record<string, unknown>>().notNull(),
  grantHmac: varchar("grant_hmac", { length: 64 }).notNull(),
  appendSequence: bigint("append_sequence", { mode: "number" }).notNull(),
  previousHash: varchar("previous_hash", { length: 64 }),
  requestEventHash: varchar("request_event_hash", { length: 64 }).notNull(),
  operationalInput: boolean("operational_input").notNull().default(false),
  stateOverrideAccepted: boolean("state_override_accepted").notNull().default(false),
  grantsAuthority: boolean("grants_authority").notNull().default(false),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_retrieval_request_project_idempotency_unique").on(table.projectId, table.idempotencyKey),
  uniqueIndex("aiceo_retrieval_request_project_sequence_unique").on(table.projectId, table.appendSequence),
  uniqueIndex("aiceo_retrieval_request_event_hash_unique").on(table.requestEventHash),
  index("aiceo_retrieval_request_project_time_idx").on(table.projectId, table.createdAt),
]);

export const aiceoRetrievalDecisionsTable = pgTable("aiceo_retrieval_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  projectId: uuid("project_id").notNull(),
  candidateId: uuid("candidate_id"),
  thoughtNodeId: uuid("thought_node_id"),
  decision: varchar("decision", { length: 16 }).notNull(),
  reasonCode: varchar("reason_code", { length: 64 }).notNull(),
  score: bigint("score", { mode: "number" }),
  scoreComponents: jsonb("score_components").$type<Record<string, number>>().notNull(),
  contentDigest: varchar("content_digest", { length: 64 }),
  evidenceDigest: varchar("evidence_digest", { length: 64 }),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  candidateSnapshot: jsonb("candidate_snapshot").$type<Record<string, unknown>>(),
  rankPosition: bigint("rank_position", { mode: "number" }),
  bytesConsumed: bigint("bytes_consumed", { mode: "number" }).notNull(),
  appendSequence: bigint("append_sequence", { mode: "number" }).notNull(),
  previousHash: varchar("previous_hash", { length: 64 }),
  decisionHash: varchar("decision_hash", { length: 64 }).notNull(),
  decisionHmac: varchar("decision_hmac", { length: 64 }).notNull(),
  operationalInput: boolean("operational_input").notNull().default(false),
  grantsAuthority: boolean("grants_authority").notNull().default(false),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_retrieval_decision_request_candidate_unique").on(table.requestId, table.candidateId),
  uniqueIndex("aiceo_retrieval_decision_request_sequence_unique").on(table.requestId, table.appendSequence),
  uniqueIndex("aiceo_retrieval_decision_hash_unique").on(table.decisionHash),
  index("aiceo_retrieval_decision_request_idx").on(table.requestId, table.appendSequence),
]);

export const aiceoRetrievalRunsTable = pgTable("aiceo_retrieval_runs", {
  requestId: uuid("request_id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  includedCount: bigint("included_count", { mode: "number" }).notNull(),
  excludedCount: bigint("excluded_count", { mode: "number" }).notNull(),
  scannedCount: bigint("scanned_count", { mode: "number" }).notNull(),
  consumedBytes: bigint("consumed_bytes", { mode: "number" }).notNull(),
  budget: jsonb("budget").$type<Record<string, number>>().notNull(),
  selectedCandidateIds: jsonb("selected_candidate_ids").$type<string[]>().notNull(),
  resultHash: varchar("result_hash", { length: 64 }).notNull(),
  responseHmac: varchar("response_hmac", { length: 64 }).notNull(),
  contextCompilerStatus: varchar("context_compiler_status", { length: 24 }).notNull().default("DEFERRED"),
  stateOverrideAccepted: boolean("state_override_accepted").notNull().default(false),
  grantsAuthority: boolean("grants_authority").notNull().default(false),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_retrieval_run_result_hash_unique").on(table.resultHash),
  index("aiceo_retrieval_run_project_time_idx").on(table.projectId, table.createdAt),
]);

export const aiceoRetrievalValidatorAttestationsTable = pgTable("aiceo_retrieval_validator_attestations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  validatorId: varchar("validator_id", { length: 180 }).notNull(),
  validatorRole: varchar("validator_role", { length: 32 }).notNull(),
  implementationActorId: varchar("implementation_actor_id", { length: 180 }).notNull(),
  acceptedRevision: bigint("accepted_revision", { mode: "number" }).notNull(),
  result: varchar("result", { length: 24 }).notNull(),
  evidenceDigest: varchar("evidence_digest", { length: 64 }).notNull(),
  attestationHmac: varchar("attestation_hmac", { length: 64 }).notNull(),
  operationalInput: boolean("operational_input").notNull().default(false),
  grantsAuthority: boolean("grants_authority").notNull().default(false),
  productionAuthority: boolean("production_authority").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("aiceo_retrieval_validator_attestation_revision_unique")
    .on(table.projectId, table.acceptedRevision),
  index("aiceo_retrieval_validator_attestation_project_idx")
    .on(table.projectId, table.acceptedRevision),
]);

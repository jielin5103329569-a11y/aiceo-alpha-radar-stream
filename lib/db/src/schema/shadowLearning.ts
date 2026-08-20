import {
  boolean,
  doublePrecision,
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

export const shadowLearningTriggersTable = pgTable(
  "shadow_learning_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: text("event_key").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    recordHash: text("record_hash").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    scanWindow: text("scan_window").notNull(),
    scanProfile: text("scan_profile").notNull(),
    modelVersion: text("model_version").notNull(),
    candidateSource: text("candidate_source").notNull(),
    signalType: text("signal_type").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    sector: text("sector"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    triggerPrice: doublePrecision("trigger_price").notNull(),
    direction: text("direction").notNull(),
    state: text("state").notNull(),
    shadowScore: doublePrecision("shadow_score").notNull(),
    status: text("status").notNull(),
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    freshnessSnapshot: jsonb("freshness_snapshot").notNull(),
    inputSummary: jsonb("input_summary").notNull(),
    cohortKey: text("cohort_key").notNull(),
    cohortEligibilitySnapshot: jsonb("cohort_eligibility_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shadow_learning_triggers_event_key_unique").on(table.eventKey),
    index("shadow_learning_triggers_query_idx").on(
      table.strategyVersion,
      table.signalType,
      table.occurredAt,
    ),
    index("shadow_learning_triggers_symbol_idx").on(table.symbol, table.occurredAt),
    index("shadow_learning_triggers_cohort_idx").on(table.cohortKey),
  ],
);

export const shadowLearningPriceObservationsTable = pgTable(
  "shadow_learning_price_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    observationKey: text("observation_key").notNull(),
    recordHash: text("record_hash").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    price: doublePrecision("price").notNull(),
    source: text("source").notNull(),
    freshness: text("freshness").notNull(),
    contextSnapshot: jsonb("context_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shadow_learning_price_observations_key_unique").on(table.observationKey),
    index("shadow_learning_price_observations_symbol_idx").on(table.symbol, table.observedAt),
  ],
);

export const shadowLearningOutcomesTable = pgTable(
  "shadow_learning_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outcomeKey: text("outcome_key").notNull(),
    recordHash: text("record_hash").notNull(),
    triggerId: uuid("trigger_id")
      .notNull()
      .references(() => shadowLearningTriggersTable.id),
    horizonDays: integer("horizon_days").notNull(),
    checkpointStatus: text("checkpoint_status").notNull(),
    targetAt: timestamp("target_at", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    observedPrice: doublePrecision("observed_price"),
    rawReturnPercent: doublePrecision("raw_return_percent"),
    favorableReturnPercent: doublePrecision("favorable_return_percent"),
    maxDrawdownPercent: doublePrecision("max_drawdown_percent"),
    hit: boolean("hit"),
    leadTimeMinutes: doublePrecision("lead_time_minutes"),
    stageOutcome: jsonb("stage_outcome"),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shadow_learning_outcomes_key_unique").on(table.outcomeKey),
    index("shadow_learning_outcomes_trigger_horizon_idx").on(table.triggerId, table.horizonDays),
    index("shadow_learning_outcomes_pending_idx").on(
      table.checkpointStatus,
      table.targetAt,
    ),
  ],
);
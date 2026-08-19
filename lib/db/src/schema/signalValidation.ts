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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type SignalEvidenceSnapshot = {
  key: string;
  label: string;
  satisfied: boolean;
  detail: string;
};

export type SignalFreshnessSnapshot = {
  marketFeedState: string;
  dataQuality: string;
  scoreState: string;
  momentum: string;
  volume: string;
  orderFlow: string;
  spread: string;
};

export const radarSignalEventsTable = pgTable(
  "radar_signal_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: text("event_key").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    recordHash: text("record_hash").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    fromState: text("from_state").notNull(),
    state: text("state").notNull(),
    confirmationStatus: text("confirmation_status").notNull(),
    signalType: text("signal_type").notNull(),
    direction: text("direction").notNull(),
    triggerPrice: doublePrecision("trigger_price").notNull(),
    alphaScore: doublePrecision("alpha_score"),
    signalScore: doublePrecision("signal_score"),
    confidence: doublePrecision("confidence").notNull(),
    volumeValue: doublePrecision("volume_value"),
    volumeScore: doublePrecision("volume_score"),
    velocity30s: doublePrecision("velocity_30s"),
    velocity60s: doublePrecision("velocity_60s"),
    momentumAcceleration: doublePrecision("momentum_acceleration"),
    volumeAcceleration: doublePrecision("volume_acceleration"),
    orderFlowShift: doublePrecision("order_flow_shift"),
    spreadTightening: doublePrecision("spread_tightening"),
    sector: text("sector"),
    sectorConfirmation: text("sector_confirmation").notNull(),
    sectorConfirmationReason: text("sector_confirmation_reason").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    evidenceSummary: jsonb("evidence_summary").$type<SignalEvidenceSnapshot[]>().notNull(),
    satisfiedEvidence: jsonb("satisfied_evidence").$type<string[]>().notNull(),
    missingEvidence: jsonb("missing_evidence").$type<string[]>().notNull(),
    dataFresh: boolean("data_fresh").notNull(),
    freshness: jsonb("freshness").$type<SignalFreshnessSnapshot>().notNull(),
    source: text("source").notNull(),
    catalystStatus: text("catalyst_status").notNull().default("unavailable"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("radar_signal_events_event_key_unique").on(table.eventKey),
    index("radar_signal_events_symbol_occurred_idx").on(table.symbol, table.occurredAt),
    index("radar_signal_events_state_occurred_idx").on(table.state, table.occurredAt),
  ],
);

export const radarSignalPriceObservationsTable = pgTable(
  "radar_signal_price_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    observationKey: text("observation_key").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    price: doublePrecision("price").notNull(),
    source: text("source").notNull(),
    freshness: text("freshness").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("radar_signal_price_observations_key_unique").on(table.observationKey),
    index("radar_signal_price_symbol_observed_idx").on(table.symbol, table.observedAt),
  ],
);

export const radarSignalOutcomeEventsTable = pgTable(
  "radar_signal_outcome_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outcomeKey: text("outcome_key").notNull(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => radarSignalEventsTable.id),
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
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("radar_signal_outcome_events_key_unique").on(table.outcomeKey),
    index("radar_signal_outcomes_signal_horizon_idx").on(table.signalId, table.horizonDays),
    index("radar_signal_outcomes_pending_target_idx").on(
      table.checkpointStatus,
      table.targetAt,
    ),
  ],
);

export const insertRadarSignalEventSchema = createInsertSchema(radarSignalEventsTable).omit({
  id: true,
  createdAt: true,
});
export const insertRadarSignalPriceObservationSchema = createInsertSchema(
  radarSignalPriceObservationsTable,
).omit({ id: true, createdAt: true });
export const insertRadarSignalOutcomeEventSchema = createInsertSchema(
  radarSignalOutcomeEventsTable,
).omit({ id: true, createdAt: true });

export type InsertRadarSignalEvent = z.infer<typeof insertRadarSignalEventSchema>;
export type RadarSignalEvent = typeof radarSignalEventsTable.$inferSelect;
export type InsertRadarSignalPriceObservation = z.infer<
  typeof insertRadarSignalPriceObservationSchema
>;
export type RadarSignalPriceObservation =
  typeof radarSignalPriceObservationsTable.$inferSelect;
export type InsertRadarSignalOutcomeEvent = z.infer<
  typeof insertRadarSignalOutcomeEventSchema
>;
export type RadarSignalOutcomeEvent = typeof radarSignalOutcomeEventsTable.$inferSelect;
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const RESEARCH_SIDECAR_LANES = ["alex_moonvest", "serenity"] as const;
export const RESEARCH_SIDECAR_IDENTITY_STATES = ["overseas_reference", "us_watch"] as const;
export const RESEARCH_SIDECAR_RESONANCE_BASES = ["us_ticker", "industry_chain"] as const;

type ResearchEvidenceValue = string | string[] | boolean | number | null;
export type ResearchTickerIdentity = {
  exchange: string;
  lifecycleStatus: string;
  securityType: string;
  identitySourceReference: string;
  verificationAccessDate: string;
};

/**
 * Immutable, research-only observations. This table is deliberately not connected
 * to Alpha Radar, ranking, alerts, or any production scanner.
 */
export const researchObservationEventsTable = pgTable(
  "research_observation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: text("event_key").notNull(),
    recordVersion: integer("record_version").notNull().default(1),
    recordHash: text("record_hash").notNull(),
    sourceLane: text("source_lane").notNull(),
    source: text("source").notNull(),
    researchOnlyLabel: text("research_only_label").notNull(),
    ticker: text("ticker"),
    tickerIdentity: jsonb("ticker_identity").$type<ResearchTickerIdentity>().notNull(),
    tickerIdentityState: text("ticker_identity_state").notNull(),
    usTickerAdmission: text("us_ticker_admission").notNull(),
    usTickerIdentityEvidence: text("us_ticker_identity_evidence").notNull(),
    viewpoint: text("viewpoint").notNull(),
    thesis: text("thesis").notNull(),
    valuationReversalBasis: text("valuation_reversal_basis").notNull(),
    financials: text("financials").notNull(),
    buybacks: text("buybacks").notNull(),
    cashBalanceSheet: text("cash_balance_sheet").notNull(),
    catalysts: text("catalysts").notNull(),
    risks: text("risks").notNull(),
    outcomes: text("outcomes").notNull(),
    industryChainTags: jsonb("industry_chain_tags").$type<string[]>().notNull(),
    canonicalIndustryChainKey: text("canonical_industry_chain_key").notNull(),
    observedDate: text("observed_date").notNull(),
    confidence: text("confidence").notNull(),
    sourceReference: text("source_reference").notNull(),
    evidence: jsonb("evidence").$type<Record<string, ResearchEvidenceValue>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("research_observation_events_event_key_unique").on(table.eventKey),
    uniqueIndex("research_observation_events_record_hash_unique").on(table.recordHash),
    index("research_observation_events_lane_observed_idx").on(table.sourceLane, table.observedDate),
    index("research_observation_events_ticker_idx").on(table.ticker, table.tickerIdentityState),
    index("research_observation_events_chain_idx").on(table.canonicalIndustryChainKey),
  ],
);

/** A derived, append-only pairwise resonance. Raw observations are never updated. */
export const researchResonanceTable = pgTable(
  "research_resonance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resonanceKey: text("resonance_key").notNull(),
    recordVersion: integer("record_version").notNull().default(1),
    recordHash: text("record_hash").notNull(),
    leftObservationId: uuid("left_observation_id").notNull(),
    rightObservationId: uuid("right_observation_id").notNull(),
    sourceLanes: jsonb("source_lanes").$type<string[]>().notNull(),
    resonanceBasis: text("resonance_basis").notNull(),
    admittedUsTicker: text("admitted_us_ticker"),
    canonicalIndustryChainKey: text("canonical_industry_chain_key"),
    derivedAt: timestamp("derived_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("research_resonance_key_unique").on(table.resonanceKey),
    uniqueIndex("research_resonance_hash_unique").on(table.recordHash),
    index("research_resonance_derived_at_idx").on(table.derivedAt),
    index("research_resonance_basis_idx").on(table.resonanceBasis),
  ],
);

export const insertResearchObservationEventSchema = createInsertSchema(
  researchObservationEventsTable,
).omit({ id: true });
export const insertResearchResonanceSchema = createInsertSchema(researchResonanceTable).omit({
  id: true,
});

export type InsertResearchObservationEvent = z.infer<typeof insertResearchObservationEventSchema>;
export type ResearchObservationEvent = typeof researchObservationEventsTable.$inferSelect;
export type InsertResearchResonance = z.infer<typeof insertResearchResonanceSchema>;
export type ResearchResonance = typeof researchResonanceTable.$inferSelect;
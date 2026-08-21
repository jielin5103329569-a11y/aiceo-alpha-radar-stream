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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiIndustryPoolSnapshotsTable = pgTable(
  "ai_industry_pool_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyVersion: varchar("strategy_version", { length: 80 }).notNull(),
    catalogHash: varchar("catalog_hash", { length: 128 }).notNull(),
    activeCount: integer("active_count").notNull(),
    historicalDistinctCount: integer("historical_distinct_count").notNull(),
    capacity: integer("capacity").notNull(),
    capacityState: varchar("capacity_state", { length: 32 }).notNull(),
    referenceAuthorizationState: varchar("reference_authorization_state", { length: 32 }).notNull(),
    referenceReason: text("reference_reason").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_industry_pool_snapshots_catalog_hash_unique").on(table.catalogHash),
    index("ai_industry_pool_snapshots_generated_at_idx").on(table.generatedAt),
  ],
);

/** Current, non-authoritative taxonomy projection. It cannot grant scan, Alert, or Buy authority. */
export const aiIndustryPoolMembersTable = pgTable(
  "ai_industry_pool_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    securityIdentifier: varchar("security_identifier", { length: 128 }),
    categories: jsonb("categories").$type<string[]>().notNull(),
    membershipState: varchar("membership_state", { length: 32 }).notNull(),
    sectorReviewState: varchar("sector_review_state", { length: 48 }).notNull(),
    entryReason: text("entry_reason").notNull(),
    exitReason: text("exit_reason"),
    strategyVersion: varchar("strategy_version", { length: 80 }).notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_industry_pool_members_symbol_unique").on(table.symbol),
    index("ai_industry_pool_members_state_idx").on(table.membershipState, table.lastObservedAt),
    index("ai_industry_pool_members_identifier_idx").on(table.securityIdentifier),
  ],
);

/** Append-only lifecycle evidence, protected from member projection retries with a stable event key. */
export const aiIndustryPoolEventsTable = pgTable(
  "ai_industry_pool_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: varchar("event_key", { length: 180 }).notNull(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").$type<Record<string, string | number | boolean | null>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_industry_pool_events_event_key_unique").on(table.eventKey),
    index("ai_industry_pool_events_symbol_occurred_idx").on(table.symbol, table.occurredAt),
  ],
);

/** One row per provider-facing identifier, so retries never silently consume unbounded capacity. */
export const aiIndustryReferenceUsageTable = pgTable(
  "ai_industry_reference_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    securityIdentifier: varchar("security_identifier", { length: 128 }).notNull(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
    successfulLookupCount: integer("successful_lookup_count").notNull().default(0),
    lastOutcome: varchar("last_outcome", { length: 48 }).notNull(),
    lastReason: text("last_reason").notNull(),
    firstRequestedAt: timestamp("first_requested_at", { withTimezone: true }).notNull(),
    lastRequestedAt: timestamp("last_requested_at", { withTimezone: true }).notNull(),
    lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_industry_reference_usage_identifier_unique").on(table.securityIdentifier),
    index("ai_industry_reference_usage_outcome_idx").on(table.lastOutcome, table.lastRequestedAt),
  ],
);

export const insertAiIndustryPoolSnapshotSchema = createInsertSchema(aiIndustryPoolSnapshotsTable)
  .omit({ id: true });
export const insertAiIndustryPoolMemberSchema = createInsertSchema(aiIndustryPoolMembersTable)
  .omit({ id: true });
export const insertAiIndustryPoolEventSchema = createInsertSchema(aiIndustryPoolEventsTable)
  .omit({ id: true });
export const insertAiIndustryReferenceUsageSchema = createInsertSchema(aiIndustryReferenceUsageTable)
  .omit({ id: true });

export type AiIndustryPoolSnapshot = z.infer<typeof insertAiIndustryPoolSnapshotSchema>;
export type AiIndustryPoolMember = typeof aiIndustryPoolMembersTable.$inferSelect;
export type AiIndustryPoolEvent = typeof aiIndustryPoolEventsTable.$inferSelect;
export type AiIndustryReferenceUsage = typeof aiIndustryReferenceUsageTable.$inferSelect;
/**
 * Alert domain database schema — Task #18.
 *
 * Tables:
 *  alert_records          — immutable per-event notification candidates
 *  alert_user_receipts    — per-user per-alert read/acknowledge tracking
 *  user_alert_state       — per-user per-symbol alert preferences and last-seen state
 *  notification_settings  — per-user global notification delivery preferences
 *  push_subscriptions     — Web Push / APNs / FCM endpoint registrations
 *  alert_delivery_audit   — append-only delivery attempt log
 *
 * NOTE: userId fields use text (not uuid) because Clerk user IDs are opaque
 * strings like "user_2abc…" — not RFC-4122 UUIDs.
 */

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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// alert_records
//   One row per unique notification candidate that passed all fail-closed gates.
//   eventKey is globally unique (same deduplication key used by AlertMonitor).
// ---------------------------------------------------------------------------

export type AlertGateSnapshotJson = {
  bothStreamsReceiving: boolean;
  marketFeedStreaming: boolean;
  scoreAvailable: boolean;
  scoreGood: boolean;
  scoreNonNull: boolean;
  preBreakoutDataFresh: boolean;
  coreComponentsScoreEligible: boolean;
  subscriptionVerified: boolean;
  realMarketEventReceived: boolean;
  enteredScoringWindow: boolean;
  scoringEligible: boolean;
  triggerEvidenceAvailable: boolean;
  noShadowVeto: boolean;
  noHeartbeatVeto: boolean;
  noRankingVeto: boolean;
  noFocusedLeaderVeto: boolean;
  noMissingDataVeto: boolean;
  noStaleDataVeto: boolean;
};

export const alertRecordsTable = pgTable(
  "alert_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Deterministic deduplication key derived by alertMonitor.deriveEventKey(). */
    eventKey: text("event_key").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    /** "info" | "watch" | "alert" | "critical" */
    severity: varchar("severity", { length: 20 }).notNull(),
    /** "pre_breakout_confirmed" | "pre_breakout_detected" | "accelerating_state" | "watch_state_elevated" */
    triggerReason: varchar("trigger_reason", { length: 60 }).notNull(),
    detectionState: varchar("detection_state", { length: 40 }).notNull(),
    confirmationStatus: varchar("confirmation_status", { length: 40 }).notNull(),
    /** Stored as text to avoid floating-point ambiguity at read time. */
    alphaScore: text("alpha_score").notNull(),
    /** Nullable — not always available. */
    alphaVelocity30s: text("alpha_velocity_30s"),
    confidence: integer("confidence").notNull(),
    triggerPrice: text("trigger_price"),
    preBreakoutState: varchar("pre_breakout_state", { length: 40 }).notNull(),
    /** Trusted fresh reference classification at alert generation time; null when unavailable. */
    sector: varchar("sector", { length: 160 }),
    /** Trusted fresh reference classification at alert generation time; null when unavailable. */
    industry: varchar("industry", { length: 160 }),
    satisfiedEvidence: jsonb("satisfied_evidence").$type<string[]>().notNull(),
    missingEvidence: jsonb("missing_evidence").$type<string[]>().notNull(),
    /** The verified state-machine transition used as this alert's immutable identity. */
    transitionAt: timestamp("transition_at", { withTimezone: true }).notNull(),
    /** Verbatim gate snapshot captured at generation time for audit. */
    gateSnapshot: jsonb("gate_snapshot").$type<AlertGateSnapshotJson>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_records_event_key_unique").on(table.eventKey),
    index("alert_records_symbol_generated_idx").on(table.symbol, table.generatedAt),
    index("alert_records_severity_generated_idx").on(table.severity, table.generatedAt),
    index("alert_records_symbol_severity_idx").on(table.symbol, table.severity),
  ],
);

// ---------------------------------------------------------------------------
// alert_user_receipts
//   Per-user per-alert read and acknowledge state.
//   userId is text because Clerk IDs are not RFC-4122 UUIDs.
//   Unique constraint on (userId, alertRecordId) for idempotent upserts.
// ---------------------------------------------------------------------------

export const alertUserReceiptsTable = pgTable(
  "alert_user_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clerk user ID — opaque text string, e.g. "user_2abc…". */
    userId: text("user_id").notNull(),
    alertRecordId: uuid("alert_record_id")
      .notNull()
      .references(() => alertRecordsTable.id),
    /** When the user first viewed this alert. Null until read. */
    readAt: timestamp("read_at", { withTimezone: true }),
    /** When the user explicitly acknowledged/dismissed this alert. Null until acknowledged. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_user_receipts_user_alert_unique").on(table.userId, table.alertRecordId),
    index("alert_user_receipts_user_id_idx").on(table.userId),
    index("alert_user_receipts_alert_record_id_idx").on(table.alertRecordId),
    index("alert_user_receipts_read_at_idx").on(table.readAt),
  ],
);

// ---------------------------------------------------------------------------
// user_alert_state
//   Per-user per-symbol alert preferences: snooze, opt-out.
//   userId is text because Clerk IDs are not RFC-4122 UUIDs.
// ---------------------------------------------------------------------------

export const userAlertStateTable = pgTable(
  "user_alert_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clerk user ID — opaque text string. */
    userId: text("user_id").notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    /** Whether alerts for this symbol are snoozed for this user. */
    snoozed: boolean("snoozed").notNull().default(false),
    /** When the snooze expires (null = indefinite when snoozed is true). */
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    /** Whether the user has opted out of all alerts for this symbol. */
    optedOut: boolean("opted_out").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_alert_state_user_symbol_unique").on(table.userId, table.symbol),
    index("user_alert_state_user_id_idx").on(table.userId),
    index("user_alert_state_symbol_idx").on(table.symbol),
  ],
);

// ---------------------------------------------------------------------------
// notification_settings
//   Per-user global delivery preferences (one row per user).
//   userId is text because Clerk IDs are not RFC-4122 UUIDs.
// ---------------------------------------------------------------------------

export type NotificationChannelPreferences = {
  /** Whether browser / Web Push notifications are enabled. */
  webPush: boolean;
  /** Whether in-app notifications are enabled. */
  inApp: boolean;
  /** Minimum severity to deliver — "info" | "watch" | "alert" | "critical". */
  minimumSeverity: string;
  /** Quiet hours in local time. null = no quiet hours. Format: "HH:MM" 24-h. */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  /** IANA timezone for quiet hours evaluation. */
  timezone: string | null;
};

export const notificationSettingsTable = pgTable(
  "notification_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clerk user ID — opaque text string. */
    userId: text("user_id").notNull(),
    channelPreferences: jsonb("channel_preferences")
      .$type<NotificationChannelPreferences>()
      .notNull()
      .default({
        webPush: true,
        inApp: true,
        minimumSeverity: "watch",
        quietHoursStart: null,
        quietHoursEnd: null,
        timezone: null,
      }),
    /** Global opt-out overrides all per-symbol and channel settings. */
    globalOptOut: boolean("global_opt_out").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_settings_user_id_unique").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// push_subscriptions
//   Web Push / APNs / FCM endpoint registrations.
//   userId is text because Clerk IDs are not RFC-4122 UUIDs.
// ---------------------------------------------------------------------------

export type PushSubscriptionPayload = {
  /** "web_push" | "apns" | "fcm" */
  provider: string;
  /** Web Push: full endpoint URL. */
  endpoint?: string;
  /** VAPID P256DH public key (Web Push). */
  p256dh?: string;
  /** VAPID auth secret (Web Push). */
  auth?: string;
  /** APNs device token. */
  deviceToken?: string;
  /** FCM registration token. */
  registrationToken?: string;
};

export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clerk user ID — opaque text string. */
    userId: text("user_id").notNull(),
    /** Human-readable device label, e.g. "Chrome on MacBook". */
    deviceLabel: varchar("device_label", { length: 120 }),
    /** Provider-specific subscription payload. */
    subscriptionPayload: jsonb("subscription_payload")
      .$type<PushSubscriptionPayload>()
      .notNull(),
    /** Whether this endpoint is currently active. */
    active: boolean("active").notNull().default(true),
    /** Last successful delivery to this endpoint. */
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    /** Last failed delivery attempt (null = no failures yet). */
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    /** Consecutive delivery failures since last success (for expiry logic). */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("push_subscriptions_user_id_active_idx").on(table.userId, table.active),
    index("push_subscriptions_user_id_idx").on(table.userId),
    index("push_subscriptions_active_idx").on(table.active),
  ],
);

// ---------------------------------------------------------------------------
// alert_delivery_audit
//   Append-only log of every delivery attempt.
// ---------------------------------------------------------------------------

export type AlertDeliveryOutcome =
  | "delivered"
  | "failed"
  | "skipped_opt_out"
  | "skipped_snooze"
  | "skipped_quiet_hours"
  | "skipped_severity_threshold"
  | "skipped_duplicate"
  | "skipped_cooldown"
  | "skipped_no_vapid"
  | "skipped_no_subscriptions";

export const alertDeliveryAuditTable = pgTable(
  "alert_delivery_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for an account-initiated test push; production deliveries reference an immutable alert. */
    alertRecordId: uuid("alert_record_id")
      .references(() => alertRecordsTable.id),
    /** Clerk user ID — opaque text string. */
    userId: text("user_id").notNull(),
    /** Null for in-app / system deliveries. */
    pushSubscriptionId: uuid("push_subscription_id"),
    /** "web_push" | "in_app" | "email" | "system" */
    channel: varchar("channel", { length: 30 }).notNull(),
    outcome: varchar("outcome", { length: 40 }).notNull(),
    /** HTTP status code or provider-specific error code. */
    providerStatusCode: integer("provider_status_code"),
    /** Provider error message for failed deliveries. */
    errorDetail: text("error_detail"),
    /** Round-trip latency in milliseconds for delivery attempts. */
    latencyMs: integer("latency_ms"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("alert_delivery_audit_record_id_idx").on(table.alertRecordId),
    index("alert_delivery_audit_user_id_idx").on(table.userId),
    index("alert_delivery_audit_attempted_idx").on(table.attemptedAt),
    index("alert_delivery_audit_outcome_idx").on(table.outcome),
    index("alert_delivery_audit_record_user_idx").on(table.alertRecordId, table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Drizzle insert schemas + types
// ---------------------------------------------------------------------------

export const insertAlertRecordSchema = createInsertSchema(alertRecordsTable).omit({
  id: true,
  createdAt: true,
});

export const insertAlertUserReceiptSchema = createInsertSchema(alertUserReceiptsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserAlertStateSchema = createInsertSchema(userAlertStateTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationSettingsSchema = createInsertSchema(notificationSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAlertDeliveryAuditSchema = createInsertSchema(alertDeliveryAuditTable).omit({
  id: true,
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type InsertAlertRecord = z.infer<typeof insertAlertRecordSchema>;
export type AlertRecord = typeof alertRecordsTable.$inferSelect;

export type InsertAlertUserReceipt = z.infer<typeof insertAlertUserReceiptSchema>;
export type AlertUserReceipt = typeof alertUserReceiptsTable.$inferSelect;

export type InsertUserAlertState = z.infer<typeof insertUserAlertStateSchema>;
export type UserAlertState = typeof userAlertStateTable.$inferSelect;

export type InsertNotificationSettings = z.infer<typeof insertNotificationSettingsSchema>;
export type NotificationSettings = typeof notificationSettingsTable.$inferSelect;

export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;

export type InsertAlertDeliveryAudit = z.infer<typeof insertAlertDeliveryAuditSchema>;
export type AlertDeliveryAudit = typeof alertDeliveryAuditTable.$inferSelect;

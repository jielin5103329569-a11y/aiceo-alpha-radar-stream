/**
 * Alert Service — Task #18 isolated backend service.
 *
 * Lifecycle:
 *   start()  — subscribes to databentoLive "status" events, begins evaluating candidates
 *   stop()   — unsubscribes, stops evaluating
 *
 * Guarantees:
 *  • Never awaits inside a status event handler — all async work is fire-and-forget
 *    via setImmediate so the feed event loop is never blocked
 *  • Never throws into feed code — every async path has its own catch
 *  • Idempotent alert_record inserts (eventKey unique constraint)
 *  • Web Push delivery only when VAPID_PRIVATE_KEY + VAPID_PUBLIC_KEY env vars exist;
 *    otherwise audit outcome "skipped_no_vapid" without claiming delivery
 *  • Respects notification_settings global opt-out and minimumSeverity
 *  • Respects user_alert_state per-symbol opt-out and snooze
 *  • Bounded failure tracking per push_subscription (deactivate after MAX_CONSECUTIVE_FAILURES)
 *  • Delivery audit for every attempt/skip
 *  • Exposes read-only health snapshot and methods for future API routes
 */

import { db } from "@workspace/db";
import {
  alertRecordsTable,
  alertDeliveryAuditTable,
  notificationSettingsTable,
  pushSubscriptionsTable,
  userAlertStateTable,
  type AlertRecord,
  type NotificationChannelPreferences,
  type AlertSectorLeaderContext,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { databentoLive } from "./databentoLive";
import { marketUniverse } from "./marketUniverse";
import {
  AlertMonitor,
  observeRadarStatus,
  type NotificationCandidate,
  type AlertSeverity,
} from "./alertMonitor";
import type { RadarStatus } from "./databentoLive";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONSECUTIVE_PUSH_FAILURES = 5;
const ALERT_SERVICE_HEARTBEAT_MS = 10_000;
/**
 * Display limit only. A fully confirmed #1 remains eligible for alert delivery
 * even when it is the sole leader surfaced for its sector.
 */
const MAX_SECTOR_LEADERS = 5;
const SEVERITY_ORDER: AlertSeverity[] = ["info", "watch", "alert", "critical"];

function severityIndex(s: string): number {
  const idx = SEVERITY_ORDER.indexOf(s as AlertSeverity);
  return idx === -1 ? 0 : idx;
}

export type AlertClassification = {
  readonly sector: string;
  readonly industry: string;
};

function trustedAlertClassification(symbol: string): AlertClassification | null {
  const summary = marketUniverse.getSummary();
  if (summary.freshness !== "fresh" || summary.dataQuality !== "good") return null;
  const reference = marketUniverse.getSecurity(symbol);
  if (reference?.eligibility !== "eligible") return null;
  const sector = reference?.sector?.trim();
  const industry = reference?.industry?.trim();
  if (!sector || !industry || !reference?.classificationSource) return null;
  return { sector, industry };
}

/**
 * Builds descriptive context only after the alert candidate has already passed
 * every production gate. The snapshot itself is server-owned and constructed
 * solely from fresh, eligible live Alpha windows; this helper never changes
 * eligibility, identity, or delivery.
 */
export function buildAlertSectorLeaderContext(
  status: RadarStatus,
  classification: AlertClassification | null,
): AlertSectorLeaderContext | null {
  if (!classification || status.sectorPriority?.state !== "ranked") return null;

  const sector = status.sectorPriority.sectors.find((item) => (
    item.sector === classification.sector
    && item.eligibility === "ranked"
    && item.dataFresh
  ));
  if (!sector) return null;

  const rankedMembers = sector.members
    .filter((member) => (
      member.eligibility === "ranked"
      && member.marketDataState === "fresh"
      && member.individualAlphaScore !== null
      && member.sectorWeightedScore !== null
      && Number.isFinite(member.sectorWeightedScore)
    ))
    .sort((left, right) => (
      (right.sectorWeightedScore ?? Number.NEGATIVE_INFINITY)
      - (left.sectorWeightedScore ?? Number.NEGATIVE_INFINITY)
    ) || left.symbol.localeCompare(right.symbol))
    // This is intentionally an upper bound, never a minimum-population gate.
    .slice(0, MAX_SECTOR_LEADERS);

  if (rankedMembers.length === 0) return null;

  const topMember = rankedMembers[0];
  return {
    sector: sector.sector ?? classification.sector,
    leaders: rankedMembers.map((member, index) => ({
      rank: index + 1,
      symbol: member.symbol,
      grade: member.preBreakoutState === "confirmed" && member.confirmationStatus === "confirmed"
        ? "confirmed"
        : member.preBreakoutState === "breakout_critical"
          ? "critical"
          : member.preBreakoutState === "latent"
            ? "latent"
            : "watch",
    })),
    strongestBreakoutSymbol: (
      topMember.preBreakoutState === "confirmed"
      && topMember.confirmationStatus === "confirmed"
    )
      ? topMember.symbol
      : null,
  };
}

function sectorLeaderPushSuffix(context: AlertSectorLeaderContext | null): string {
  if (!context) return "";
  const leaders = context.leaders.map((leader) => {
    const label = context.strongestBreakoutSymbol === leader.symbol
      ? "🔥 最强爆发"
      : leader.grade === "critical"
        ? "🟠 爆发临界"
        : leader.grade === "latent"
          ? "🟡 潜伏候选"
          : "观察";
    return `#${leader.rank} ${leader.symbol} ${label}`;
  }).join("; ");
  const breakout = context.strongestBreakoutSymbol
    ? ""
    : "; 最强爆发：暂无确认";
  return ` · ${context.sector}: ${leaders}${breakout}`;
}

export function buildAlertPushPayload(
  candidate: NotificationCandidate,
  alertRecordId: string,
  classification: AlertClassification | null,
  sectorLeaderContext: AlertSectorLeaderContext | null,
) {
  const classificationSuffix = classification
    ? ` · ${classification.sector} / ${classification.industry}`
    : "";

  const stageLabel = candidate.triggerReason === "breakout_confirmed"
    ? "🔥 最强爆发"
    : candidate.triggerReason === "breakout_critical"
      ? "🟠 爆发临界"
      : candidate.triggerReason === "latent_candidate"
        ? "🟡 潜伏候选"
        : candidate.triggerReason === "take_profit_watch"
          ? "⚠️ 止盈/减仓关注"
          : candidate.triggerReason === "trend_reversal_confirmed"
            ? "🔴 趋势反转/止盈确认"
        : candidate.severity.toUpperCase();
  return {
    title: `${candidate.symbol} — ${stageLabel}`,
    body: `${candidate.triggerReason.replace(/_/g, " ")} · Alpha ${candidate.alphaScore}${classificationSuffix}${sectorLeaderPushSuffix(sectorLeaderContext)}`,
    data: {
      symbol: candidate.symbol,
      severity: candidate.severity,
      triggerReason: candidate.triggerReason,
      alertRecordId,
      eventKey: candidate.eventKey,
      sector: classification?.sector ?? null,
      industry: classification?.industry ?? null,
      sectorLeaderContext,
    },
  };
}

// ---------------------------------------------------------------------------
// VAPID capability detection (evaluated once at module load, immutable)
// ---------------------------------------------------------------------------

export type VapidCapability =
  | { available: true; publicKey: string; subject: string }
  | { available: false; reason: string };

function detectVapid(): VapidCapability {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const subject = process.env.VAPID_SUBJECT ?? process.env.VAPID_EMAIL;
  if (!privateKey || !publicKey) {
    return {
      available: false,
      reason: "VAPID_PRIVATE_KEY and/or VAPID_PUBLIC_KEY environment variables are not set",
    };
  }
  if (!subject) {
    return {
      available: false,
      reason: "VAPID_SUBJECT (or VAPID_EMAIL) environment variable is not set",
    };
  }
  return { available: true, publicKey, subject };
}

export const vapidCapability: VapidCapability = detectVapid();

// ---------------------------------------------------------------------------
// Health snapshot types
// ---------------------------------------------------------------------------

export type AlertServiceHealthSnapshot = {
  readonly running: boolean;
  readonly startedAt: Date | null;
  readonly stoppedAt: Date | null;
  readonly lastHeartbeatAt: Date | null;
  readonly lastActivityAt: Date | null;
  readonly lastConsumeAt: Date | null;
  readonly candidatesEvaluated: number;
  readonly newCandidatesProduced: number;
  readonly dbInsertsAttempted: number;
  readonly dbInsertsSucceeded: number;
  readonly dbInsertsDuplicate: number;
  readonly dbInsertsFailed: number;
  readonly deliveriesAttempted: number;
  readonly deliveriesSucceeded: number;
  readonly deliveriesSkipped: number;
  readonly deliveriesFailed: number;
  readonly lastCandidateAt: Date | null;
  readonly lastDeliveryAt: Date | null;
  readonly lastErrorAt: Date | null;
  readonly lastError: string | null;
  readonly vapid: VapidCapability;
};

// ---------------------------------------------------------------------------
// Internal counters
// ---------------------------------------------------------------------------

type ServiceCounters = {
  lastHeartbeatAt: Date | null;
  lastActivityAt: Date | null;
  lastConsumeAt: Date | null;
  candidatesEvaluated: number;
  newCandidatesProduced: number;
  dbInsertsAttempted: number;
  dbInsertsSucceeded: number;
  dbInsertsDuplicate: number;
  dbInsertsFailed: number;
  deliveriesAttempted: number;
  deliveriesSucceeded: number;
  deliveriesSkipped: number;
  deliveriesFailed: number;
  lastCandidateAt: Date | null;
  lastDeliveryAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
};

function zeroCounters(): ServiceCounters {
  return {
    lastHeartbeatAt: null,
    lastActivityAt: null,
    lastConsumeAt: null,
    candidatesEvaluated: 0,
    newCandidatesProduced: 0,
    dbInsertsAttempted: 0,
    dbInsertsSucceeded: 0,
    dbInsertsDuplicate: 0,
    dbInsertsFailed: 0,
    deliveriesAttempted: 0,
    deliveriesSucceeded: 0,
    deliveriesSkipped: 0,
    deliveriesFailed: 0,
    lastCandidateAt: null,
    lastDeliveryAt: null,
    lastErrorAt: null,
    lastError: null,
  };
}

// ---------------------------------------------------------------------------
// AlertService
// ---------------------------------------------------------------------------

export class AlertService {
  private running = false;
  private startedAt: Date | null = null;
  private stoppedAt: Date | null = null;
  private readonly monitor = new AlertMonitor({ cooldownMs: 60_000 });
  private counters: ServiceCounters = zeroCounters();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lifecycleEpoch = 0;

  // Bound listener reference so we can off() it exactly
  private readonly statusListener = (status: RadarStatus): void => {
    if (!this.running) return;
    const now = new Date();
    const epoch = this.lifecycleEpoch;
    this.counters.lastConsumeAt = now;
    this.counters.lastActivityAt = now;
    // Fire-and-forget via setImmediate — never block the event emitter
    setImmediate(() => {
      this.handleStatus(status, epoch).catch((err: unknown) => {
        this.recordError(err);
      });
    });
  };

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.lifecycleEpoch += 1;
    this.running = true;
    this.startedAt = new Date();
    this.stoppedAt = null;
    this.counters = zeroCounters();
    this.recordHeartbeat(this.startedAt);
    this.monitor.resetAll();
    databentoLive.on("status", this.statusListener);
    this.heartbeatTimer = setInterval(() => this.recordHeartbeat(), ALERT_SERVICE_HEARTBEAT_MS);
    this.heartbeatTimer.unref();
    logger.info("AlertService started — subscribing to universe status events");
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.lifecycleEpoch += 1;
    this.stoppedAt = new Date();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    databentoLive.off("status", this.statusListener);
    logger.info("AlertService stopped");
  }

  // ---------------------------------------------------------------------------
  // Public read-only accessors (for future API routes)
  // ---------------------------------------------------------------------------

  getHealth(): AlertServiceHealthSnapshot {
    return {
      running: this.running,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      ...this.counters,
      vapid: vapidCapability,
    };
  }

  private recordHeartbeat(now = new Date()): void {
    if (!this.running) return;
    this.counters.lastHeartbeatAt = now;
  }

  /** List active push subscriptions for a user (for future route). */
  async listPushSubscriptions(userId: string): Promise<typeof pushSubscriptionsTable.$inferSelect[]> {
    return db
      .select()
      .from(pushSubscriptionsTable)
      .where(and(
        eq(pushSubscriptionsTable.userId, userId),
        eq(pushSubscriptionsTable.active, true),
      ));
  }

  /** Get or create notification settings for a user (for future route). */
  async getNotificationSettings(userId: string): Promise<typeof notificationSettingsTable.$inferSelect> {
    const existing = await db
      .select()
      .from(notificationSettingsTable)
      .where(eq(notificationSettingsTable.userId, userId))
      .limit(1);
    if (existing.length > 0) return existing[0];
    // Create defaults
    const inserted = await db
      .insert(notificationSettingsTable)
      .values({ userId })
      .returning();
    return inserted[0];
  }

  /** Get recent alert records for a symbol (for future route). */
  async getRecentAlerts(symbol: string, limit = 20): Promise<AlertRecord[]> {
    return db
      .select()
      .from(alertRecordsTable)
      .where(eq(alertRecordsTable.symbol, symbol))
      .orderBy(alertRecordsTable.generatedAt)
      .limit(limit);
  }

  /**
   * Send an account-initiated test push. This never creates an alert record,
   * never observes market data, and is separately marked in the audit trail.
   */
  async sendTestPush(userId: string): Promise<{
    status: "sent" | "unavailable" | "no_subscriptions" | "failed";
    attempted: number;
  }> {
    if (!vapidCapability.available) {
      return { status: "unavailable", attempted: 0 };
    }

    const subscriptions = await this.listPushSubscriptions(userId);
    if (subscriptions.length === 0) {
      return { status: "no_subscriptions", attempted: 0 };
    }

    const webpush = await import("web-push").catch(() => null);
    if (!webpush) return { status: "failed", attempted: 0 };

    const vapid = vapidCapability as Extract<VapidCapability, { available: true }>;
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, process.env.VAPID_PRIVATE_KEY!);

    let attempted = 0;
    let sent = 0;
    for (const subscription of subscriptions) {
      const payload = subscription.subscriptionPayload;
      if (!payload.endpoint || !payload.p256dh || !payload.auth) continue;
      attempted += 1;
      try {
        await webpush.sendNotification(
          {
            endpoint: payload.endpoint,
            keys: { p256dh: payload.p256dh, auth: payload.auth },
          },
          JSON.stringify({
            title: "Alpha Radar — Test notification",
            body: "Verification-only: Push delivery is active. This is not a trading instruction.",
            url: "/",
            eventKey: "alpha-radar-test",
          }),
        );
        sent += 1;
        this.counters.deliveriesSucceeded += 1;
        await this.auditDelivery({
          alertRecordId: null,
          userId,
          pushSubscriptionId: subscription.id,
          channel: "web_push_test",
          outcome: "delivered",
        });
      } catch (err) {
        this.counters.deliveriesFailed += 1;
        this.recordError(err);
        await this.auditDelivery({
          alertRecordId: null,
          userId,
          pushSubscriptionId: subscription.id,
          channel: "web_push_test",
          outcome: "failed",
          errorDetail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { status: sent > 0 ? "sent" : "failed", attempted };
  }

  // ---------------------------------------------------------------------------
  // Core status handler (always async, always caught by caller)
  // ---------------------------------------------------------------------------

  private isCurrentEpoch(epoch: number): boolean {
    return this.running && this.lifecycleEpoch === epoch;
  }

  private async handleStatus(status: RadarStatus, epoch: number): Promise<void> {
    if (!this.isCurrentEpoch(epoch)) return;
    this.counters.lastActivityAt = new Date();

    const observations = observeRadarStatus(this.monitor, status);
    this.counters.candidatesEvaluated += observations.length;

    for (const obs of observations) {
      if (!this.isCurrentEpoch(epoch)) return;
      if (!obs.isNewCandidate || !obs.result.ok) continue;

      this.counters.newCandidatesProduced += 1;
      this.counters.lastCandidateAt = obs.evaluatedAt;

      const candidate = obs.result.candidate;
      // Classification is optional context assembled after all production gates
      // pass. It must never influence candidate eligibility or identity.
      const classification = trustedAlertClassification(candidate.symbol);
      const sectorLeaderContext = buildAlertSectorLeaderContext(status, classification);

      // Persist the alert record idempotently, then dispatch delivery
      const alertId = await this.persistAlertRecord(candidate, classification, sectorLeaderContext);
      if (alertId !== null && this.isCurrentEpoch(epoch)) {
        // Fire-and-forget delivery pipeline — never awaited in this path
        this.dispatchDelivery(alertId, candidate, classification, sectorLeaderContext, epoch).catch((err: unknown) => {
          this.recordError(err);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Alert record persistence
  // ---------------------------------------------------------------------------

  private async persistAlertRecord(
    candidate: NotificationCandidate,
    classification: AlertClassification | null,
    sectorLeaderContext: AlertSectorLeaderContext | null,
  ): Promise<string | null> {
    this.counters.dbInsertsAttempted += 1;
    try {
      const result = await db
        .insert(alertRecordsTable)
        .values({
          eventKey: candidate.eventKey,
          symbol: candidate.symbol,
          severity: candidate.severity,
          triggerReason: candidate.triggerReason,
          detectionState: candidate.detectionState,
          confirmationStatus: candidate.confirmationStatus,
          alphaScore: String(candidate.alphaScore),
          alphaVelocity30s: candidate.alphaVelocity30s !== null
            ? String(candidate.alphaVelocity30s)
            : null,
          confidence: Math.round(candidate.confidence),
          triggerPrice: candidate.triggerPrice !== null
            ? String(candidate.triggerPrice)
            : null,
          preBreakoutState: candidate.preBreakoutState,
          sector: classification?.sector ?? null,
          industry: classification?.industry ?? null,
          sectorLeaderContext,
          satisfiedEvidence: [...candidate.satisfiedEvidence],
          missingEvidence: [...candidate.missingEvidence],
          transitionAt: candidate.transitionAt,
          gateSnapshot: { ...candidate.gateSnapshot },
          generatedAt: candidate.generatedAt,
        })
        .onConflictDoNothing({ target: alertRecordsTable.eventKey })
        .returning({ id: alertRecordsTable.id });

      if (result.length === 0) {
        // Conflict — already exists (idempotent duplicate)
        this.counters.dbInsertsDuplicate += 1;
        return null;
      }

      this.counters.dbInsertsSucceeded += 1;
      logger.info(
        { symbol: candidate.symbol, eventKey: candidate.eventKey, severity: candidate.severity },
        "Alert record persisted",
      );
      return result[0].id;
    } catch (err: unknown) {
      this.counters.dbInsertsFailed += 1;
      this.recordError(err);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Delivery dispatch — respects opt-outs, severity thresholds, VAPID availability
  // ---------------------------------------------------------------------------

  private async dispatchDelivery(
    alertRecordId: string,
    candidate: NotificationCandidate,
    classification: AlertClassification | null,
    sectorLeaderContext: AlertSectorLeaderContext | null,
    epoch: number,
  ): Promise<void> {
    if (!this.isCurrentEpoch(epoch)) return;
    // Load active push subscriptions
    let subscriptions: typeof pushSubscriptionsTable.$inferSelect[] = [];
    try {
      subscriptions = await db
        .select()
        .from(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.active, true));
    } catch (err: unknown) {
      this.recordError(err);
      return;
    }
    if (!this.isCurrentEpoch(epoch)) return;

    if (subscriptions.length === 0) {
      await this.auditDelivery({
        alertRecordId,
        userId: "system",
        channel: "web_push",
        outcome: "skipped_no_subscriptions",
        errorDetail: "No active push subscriptions",
      });
      return;
    }

    // Group by userId so we can check per-user settings
    const byUser = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions) {
      const list = byUser.get(sub.userId) ?? [];
      list.push(sub);
      byUser.set(sub.userId, list);
    }

    for (const [userId, userSubs] of byUser) {
      if (!this.isCurrentEpoch(epoch)) return;
      await this.deliverToUser(alertRecordId, candidate, classification, sectorLeaderContext, userId, userSubs, epoch);
    }
  }

  private async deliverToUser(
    alertRecordId: string,
    candidate: NotificationCandidate,
    classification: AlertClassification | null,
    sectorLeaderContext: AlertSectorLeaderContext | null,
    userId: string,
    subs: typeof pushSubscriptionsTable.$inferSelect[],
    epoch: number,
  ): Promise<void> {
    if (!this.isCurrentEpoch(epoch)) return;
    // Check global notification settings
    let settings: typeof notificationSettingsTable.$inferSelect | null = null;
    try {
      const rows = await db
        .select()
        .from(notificationSettingsTable)
        .where(eq(notificationSettingsTable.userId, userId))
        .limit(1);
      settings = rows[0] ?? null;
    } catch {
      // Can't load settings — skip silently; this shouldn't block alert loop
    }
    if (!this.isCurrentEpoch(epoch)) return;

    if (settings?.globalOptOut === true) {
      await this.auditDelivery({
        alertRecordId,
        userId,
        channel: "web_push",
        outcome: "skipped_opt_out",
        errorDetail: "User global opt-out is active",
      });
      return;
    }

    // Check minimum severity threshold
    const prefs: NotificationChannelPreferences = settings?.channelPreferences ?? {
      webPush: true,
      inApp: true,
      minimumSeverity: "watch",
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
    };

    if (!prefs.webPush) {
      await this.auditDelivery({
        alertRecordId,
        userId,
        channel: "web_push",
        outcome: "skipped_opt_out",
        errorDetail: "User web push channel is disabled",
      });
      return;
    }

    const minIdx = severityIndex(prefs.minimumSeverity);
    const candidateIdx = severityIndex(candidate.severity);
    if (candidateIdx < minIdx) {
      await this.auditDelivery({
        alertRecordId,
        userId,
        channel: "web_push",
        outcome: "skipped_severity_threshold",
        errorDetail: `Severity "${candidate.severity}" below user minimum "${prefs.minimumSeverity}"`,
      });
      return;
    }

    // Check per-symbol opt-out / snooze
    let symbolState: typeof userAlertStateTable.$inferSelect | null = null;
    try {
      const rows = await db
        .select()
        .from(userAlertStateTable)
        .where(
          and(
            eq(userAlertStateTable.userId, userId),
            eq(userAlertStateTable.symbol, candidate.symbol),
          ),
        )
        .limit(1);
      symbolState = rows[0] ?? null;
    } catch {
      // Can't load symbol state — continue without per-symbol check
    }

    if (symbolState?.optedOut === true) {
      await this.auditDelivery({
        alertRecordId,
        userId,
        channel: "web_push",
        outcome: "skipped_opt_out",
        errorDetail: `User opted out of alerts for ${candidate.symbol}`,
      });
      return;
    }

    if (symbolState?.snoozed === true) {
      const until = symbolState.snoozedUntil;
      if (!until || until.getTime() > Date.now()) {
        await this.auditDelivery({
          alertRecordId,
          userId,
          channel: "web_push",
          outcome: "skipped_snooze",
          errorDetail: until
            ? `Snoozed until ${until.toISOString()}`
            : `Snoozed indefinitely for ${candidate.symbol}`,
        });
        return;
      }
    }

    // Check VAPID capability
    if (!vapidCapability.available) {
      await this.auditDelivery({
        alertRecordId,
        userId,
        channel: "web_push",
        outcome: "skipped_no_vapid",
        errorDetail: vapidCapability.reason,
      });
      this.counters.deliveriesSkipped += 1;
      return;
    }

    // Attempt push delivery to each active subscription for this user
    for (const sub of subs) {
      if (!this.isCurrentEpoch(epoch)) return;
      await this.attemptPushDelivery(alertRecordId, candidate, classification, sectorLeaderContext, userId, sub, epoch);
    }
  }

  private async attemptPushDelivery(
    alertRecordId: string,
    candidate: NotificationCandidate,
    classification: AlertClassification | null,
    sectorLeaderContext: AlertSectorLeaderContext | null,
    userId: string,
    sub: typeof pushSubscriptionsTable.$inferSelect,
    epoch: number,
  ): Promise<void> {
    if (!this.isCurrentEpoch(epoch)) return;
    this.counters.deliveriesAttempted += 1;
    const startMs = Date.now();

    const payload = sub.subscriptionPayload;
    if (!payload.endpoint || !payload.p256dh || !payload.auth) {
      await this.auditDelivery({
        alertRecordId,
        userId,
        pushSubscriptionId: sub.id,
        channel: "web_push",
        outcome: "failed",
        errorDetail: "Subscription payload missing endpoint, p256dh, or auth",
      });
      this.counters.deliveriesFailed += 1;
      return;
    }

    try {
      // Dynamic import so the module is only loaded when VAPID is available
      // and we have a real subscription to deliver to.
      const webpush = await import("web-push").catch(() => null);
      if (!this.isCurrentEpoch(epoch)) return;
      if (!webpush) {
        await this.auditDelivery({
          alertRecordId,
          userId,
          pushSubscriptionId: sub.id,
          channel: "web_push",
          outcome: "skipped_no_vapid",
          errorDetail: "web-push package not available",
        });
        this.counters.deliveriesSkipped += 1;
        return;
      }

      const vapid = vapidCapability as Extract<VapidCapability, { available: true }>;
      webpush.setVapidDetails(
        vapid.subject,
        vapid.publicKey,
        process.env.VAPID_PRIVATE_KEY!,
      );

      const notificationBody = JSON.stringify(
        buildAlertPushPayload(candidate, alertRecordId, classification, sectorLeaderContext),
      );

      await webpush.sendNotification(
        {
          endpoint: payload.endpoint,
          keys: { p256dh: payload.p256dh, auth: payload.auth },
        },
        notificationBody,
      );

      const latencyMs = Date.now() - startMs;
      this.counters.deliveriesSucceeded += 1;
      this.counters.lastDeliveryAt = new Date();

      await this.auditDelivery({
        alertRecordId,
        userId,
        pushSubscriptionId: sub.id,
        channel: "web_push",
        outcome: "delivered",
        latencyMs,
      });

      // Reset failure counter on success
      await db
        .update(pushSubscriptionsTable)
        .set({
          lastDeliveredAt: new Date(),
          consecutiveFailures: 0,
          updatedAt: new Date(),
        })
        .where(eq(pushSubscriptionsTable.id, sub.id))
        .catch(() => undefined);
    } catch (err: unknown) {
      const latencyMs = Date.now() - startMs;
      const errorDetail = err instanceof Error ? err.message : String(err);
      const statusCode = (err as { statusCode?: number }).statusCode ?? null;

      this.counters.deliveriesFailed += 1;
      this.recordError(err);

      await this.auditDelivery({
        alertRecordId,
        userId,
        pushSubscriptionId: sub.id,
        channel: "web_push",
        outcome: "failed",
        providerStatusCode: statusCode ?? undefined,
        errorDetail,
        latencyMs,
      });

      // Track consecutive failures — deactivate after limit
      const newFailureCount = (sub.consecutiveFailures ?? 0) + 1;
      const shouldDeactivate = newFailureCount >= MAX_CONSECUTIVE_PUSH_FAILURES
        || statusCode === 410 // Gone — subscription expired
        || statusCode === 404; // Not found — subscription no longer valid

      await db
        .update(pushSubscriptionsTable)
        .set({
          lastFailedAt: new Date(),
          consecutiveFailures: newFailureCount,
          active: shouldDeactivate ? false : sub.active,
          updatedAt: new Date(),
        })
        .where(eq(pushSubscriptionsTable.id, sub.id))
        .catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Audit helpers
  // ---------------------------------------------------------------------------

  private async auditDelivery(entry: {
    alertRecordId: string | null;
    userId: string;
    pushSubscriptionId?: string;
    channel: string;
    outcome: string;
    providerStatusCode?: number;
    errorDetail?: string;
    latencyMs?: number;
  }): Promise<void> {
    try {
      await db.insert(alertDeliveryAuditTable).values({
        alertRecordId: entry.alertRecordId,
        userId: entry.userId,
        pushSubscriptionId: entry.pushSubscriptionId ?? null,
        channel: entry.channel,
        outcome: entry.outcome,
        providerStatusCode: entry.providerStatusCode ?? null,
        errorDetail: entry.errorDetail ?? null,
        latencyMs: entry.latencyMs ?? null,
      });
    } catch (err: unknown) {
      // Audit failure must not propagate
      logger.warn(
        { err, alertRecordId: entry.alertRecordId },
        "Alert delivery audit insert failed (non-fatal)",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Error tracking
  // ---------------------------------------------------------------------------

  private recordError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.counters.lastErrorAt = new Date();
    this.counters.lastError = message;
    logger.warn({ err: message }, "AlertService non-fatal error");
  }
}

// ---------------------------------------------------------------------------
// Singleton — imported by routes and startup code
// ---------------------------------------------------------------------------

export const alertService = new AlertService();

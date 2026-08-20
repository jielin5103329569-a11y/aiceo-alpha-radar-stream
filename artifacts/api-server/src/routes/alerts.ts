import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  alertRecordsTable,
  alertUserReceiptsTable,
  notificationSettingsTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { alertService, vapidCapability } from "../lib/alertService";

const router = Router();
const alertIdSchema = z.string().uuid();
const settingsSchema = z.object({
  browserNotificationsEnabled: z.boolean(),
  minimumTier: z.enum(["confirmed", "pre_breakout", "accelerating", "watch"]),
  notifyOnWatch: z.boolean(),
});
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().min(1).max(1024),
    auth: z.string().min(1).max(1024),
  }),
  deviceLabel: z.string().trim().max(120).optional(),
});

function getUserId(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication is required for alerts." });
    return null;
  }
  return userId;
}

function serializeAlert(
  record: typeof alertRecordsTable.$inferSelect,
  receipt: typeof alertUserReceiptsTable.$inferSelect | null,
) {
  return {
    id: record.id,
    eventKey: record.eventKey,
    symbol: record.symbol,
    severity: record.severity,
    triggerReason: record.triggerReason,
    detectionState: record.detectionState,
    confirmationStatus: record.confirmationStatus,
    alphaScore: Number(record.alphaScore),
    alphaVelocity30s: record.alphaVelocity30s === null ? null : Number(record.alphaVelocity30s),
    confidence: record.confidence,
    triggerPrice: record.triggerPrice === null ? null : Number(record.triggerPrice),
    preBreakoutState: record.preBreakoutState,
    sector: record.sector,
    industry: record.industry,
    sectorLeaderContext: record.sectorLeaderContext,
    satisfiedEvidence: record.satisfiedEvidence,
    missingEvidence: record.missingEvidence,
    generatedAt: record.generatedAt.toISOString(),
    readAt: receipt?.readAt?.toISOString() ?? null,
    acknowledgedAt: receipt?.acknowledgedAt?.toISOString() ?? null,
  };
}

function settingsResponse(settings: typeof notificationSettingsTable.$inferSelect) {
  const prefs = settings.channelPreferences;
  return {
    browserNotificationsEnabled: prefs.webPush,
    inAppNotificationsEnabled: prefs.inApp,
    minimumSeverity: prefs.minimumSeverity,
    quietHoursStart: prefs.quietHoursStart,
    quietHoursEnd: prefs.quietHoursEnd,
    timezone: prefs.timezone,
    globalOptOut: settings.globalOptOut,
  };
}

async function requireAlertRecord(
  alertRecordId: string,
  res: Response,
): Promise<boolean> {
  const [record] = await db
    .select({ id: alertRecordsTable.id })
    .from(alertRecordsTable)
    .where(eq(alertRecordsTable.id, alertRecordId))
    .limit(1);
  if (record) return true;
  res.status(404).json({ error: "Alert record was not found." });
  return false;
}

type MinimumTier = "confirmed" | "pre_breakout" | "accelerating" | "watch";

function tierToSeverity(tier: MinimumTier): string {
  return {
    confirmed: "critical",
    pre_breakout: "alert",
    accelerating: "watch",
    watch: "watch",
  }[tier];
}

router.get("/alerts", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const limit = z.coerce.number().int().min(1).max(100).catch(50).parse(req.query.limit);
  const rows = await db
    .select({ record: alertRecordsTable, receipt: alertUserReceiptsTable })
    .from(alertRecordsTable)
    .leftJoin(
      alertUserReceiptsTable,
      and(
        eq(alertUserReceiptsTable.alertRecordId, alertRecordsTable.id),
        eq(alertUserReceiptsTable.userId, userId),
      ),
    )
    .orderBy(desc(alertRecordsTable.generatedAt))
    .limit(limit);
  res.json({ alerts: rows.map(({ record, receipt }) => serializeAlert(record, receipt)) });
});

router.get("/alerts/settings", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  res.json(settingsResponse(await alertService.getNotificationSettings(userId)));
});

router.put("/alerts/settings", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid notification settings.", details: parsed.error.flatten() });
    return;
  }
  const existing = await alertService.getNotificationSettings(userId);
  const nextPrefs = {
    ...existing.channelPreferences,
    webPush: parsed.data.browserNotificationsEnabled,
    minimumSeverity: parsed.data.notifyOnWatch ? "info" : tierToSeverity(parsed.data.minimumTier),
  };
  const [updated] = await db
    .update(notificationSettingsTable)
    .set({ channelPreferences: nextPrefs, updatedAt: new Date() })
    .where(eq(notificationSettingsTable.userId, userId))
    .returning();
  res.json(settingsResponse(updated));
});

router.post("/alerts/:alertId/read", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const parsed = alertIdSchema.safeParse(req.params.alertId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid alert id." });
    return;
  }
  if (!(await requireAlertRecord(parsed.data, res))) return;
  await db
    .insert(alertUserReceiptsTable)
    .values({ userId, alertRecordId: parsed.data, readAt: new Date() })
    .onConflictDoUpdate({
      target: [alertUserReceiptsTable.userId, alertUserReceiptsTable.alertRecordId],
      set: { readAt: new Date(), updatedAt: new Date() },
    });
  res.status(204).end();
});

router.post("/alerts/read-all", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const records = await db.select({ id: alertRecordsTable.id }).from(alertRecordsTable)
    .orderBy(desc(alertRecordsTable.generatedAt)).limit(100);
  const now = new Date();
  await Promise.all(records.map(({ id }) => db.insert(alertUserReceiptsTable)
    .values({ userId, alertRecordId: id, readAt: now })
    .onConflictDoUpdate({
      target: [alertUserReceiptsTable.userId, alertUserReceiptsTable.alertRecordId],
      set: { readAt: now, updatedAt: now },
    })));
  res.status(204).end();
});

router.post("/alerts/:alertId/acknowledge", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const parsed = alertIdSchema.safeParse(req.params.alertId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid alert id." });
    return;
  }
  if (!(await requireAlertRecord(parsed.data, res))) return;
  const now = new Date();
  await db
    .insert(alertUserReceiptsTable)
    .values({ userId, alertRecordId: parsed.data, readAt: now, acknowledgedAt: now })
    .onConflictDoUpdate({
      target: [alertUserReceiptsTable.userId, alertUserReceiptsTable.alertRecordId],
      set: { readAt: now, acknowledgedAt: now, updatedAt: now },
    });
  res.status(204).end();
});

router.get("/alerts/push-capability", (req: Request, res: Response): void => {
  const userId = getUserId(req, res);
  if (!userId) return;
  res.json(vapidCapability.available
    ? { available: true, publicKey: vapidCapability.publicKey }
    : { available: false, reason: vapidCapability.reason });
});

router.post("/alerts/push-subscriptions", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  if (!vapidCapability.available) {
    res.status(503).json({ error: "Web Push is not configured for this service." });
    return;
  }
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid push subscription.", details: parsed.error.flatten() });
    return;
  }
  const existing = (await alertService.listPushSubscriptions(userId))
    .find((subscription) => subscription.subscriptionPayload.endpoint === parsed.data.endpoint);
  const payload = {
    provider: "web_push",
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  };
  if (existing) {
    await db.update(pushSubscriptionsTable)
      .set({ subscriptionPayload: payload, deviceLabel: parsed.data.deviceLabel ?? null, active: true, consecutiveFailures: 0, updatedAt: new Date() })
      .where(and(eq(pushSubscriptionsTable.id, existing.id), eq(pushSubscriptionsTable.userId, userId)));
  } else {
    await db.insert(pushSubscriptionsTable).values({ userId, subscriptionPayload: payload, deviceLabel: parsed.data.deviceLabel ?? null });
  }
  res.status(204).end();
});

router.delete("/alerts/push-subscriptions/:subscriptionId", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const parsed = alertIdSchema.safeParse(req.params.subscriptionId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid subscription id." });
    return;
  }
  await db.update(pushSubscriptionsTable)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(pushSubscriptionsTable.id, parsed.data), eq(pushSubscriptionsTable.userId, userId)));
  res.status(204).end();
});

router.post("/alerts/test-notification", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const result = await alertService.sendTestPush(userId);
  if (result.status === "unavailable") {
    res.status(503).json({ ...result, reason: "Web Push is not configured for this service." });
    return;
  }
  res.json(result);
});

export default router;
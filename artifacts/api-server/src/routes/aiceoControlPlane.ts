import { Router, type Request, type Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { z } from "zod";
import { aiceoControlPlane } from "../lib/aiceoControlPlane";
import { aiceoContinuityLayer } from "../lib/aiceoContinuityLayer";
import { authorizeAiceoRole, authorizeAnyAiceoRole, type AiceoRole } from "../lib/aiceoAuthorization";

const router = Router();
const submission = z.object({
  action: z.string().min(1).max(120), resource: z.string().min(1).max(180),
  governance: z.object({
    classification: z.enum(["ordinary_technical", "owner_protection"]),
    redLines: z.array(z.enum(["financial_and_physical_assets", "legal_liability", "aiceo_system_integrity"])).max(3),
  }).strict(),
  environment: z.enum(["development", "staging", "production"]).optional(),
  budget: z.object({ estimatedTokens: z.number().int().nonnegative(), estimatedCalls: z.number().int().nonnegative(), estimatedUsd: z.number().nonnegative() }).partial().optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(), maxRetries: z.number().int().nonnegative().max(2).optional(), clientTimestamp: z.string().datetime().optional(),
}).strict();
const evidence = z.object({ summary: z.string().min(1).max(500), facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }).strict();
const continuityUpdate = z.object({
  state: z.enum(["RUNNING", "PAUSED", "FAILED", "COMPLETED", "OWNER_GATE"]),
  currentState: z.record(z.string(), z.unknown()),
  decisionRuleRegistry: z.array(z.record(z.string(), z.unknown())),
  entityRegistry: z.array(z.record(z.string(), z.unknown())),
  aliasDictionary: z.record(z.string(), z.unknown()),
  evidencePointers: z.array(z.record(z.string(), z.unknown())),
  resumeNode: z.record(z.string(), z.unknown()),
  failureReason: z.string().max(1000).nullable().optional(),
  recoveryStrategy: z.string().max(1000).nullable().optional(),
  ownerGateReason: z.string().max(1000).nullable().optional(),
}).strict();
const privileged = (role: AiceoRole, handler: (req: Request, res: Response, userId: string) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    await aiceoControlPlane.rejectAccess("anonymous", role, "Authentication required.").catch(() => undefined);
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  let publicMetadata: Record<string, unknown>;
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    publicMetadata = user.publicMetadata;
  } catch {
    await aiceoControlPlane.rejectAccess(auth.userId, role, "Clerk role authority is unavailable.").catch(() => undefined);
    res.status(503).json({ error: "Clerk role authority is unavailable." });
    return;
  }
  const authorization = authorizeAiceoRole({
    userId: auth.userId,
    sessionClaims: auth.sessionClaims as Record<string, unknown> | null | undefined,
    publicMetadata,
  }, role);
  if (!authorization.allowed) {
    await aiceoControlPlane.rejectAccess(auth.userId, role, authorization.error).catch(() => undefined);
    res.status(authorization.status).json({ error: authorization.error });
    return;
  }
  await handler(req, res, authorization.userId);
};
const anyAiceoRole = (handler: (req: Request, res: Response, userId: string, role: AiceoRole) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    await aiceoControlPlane.rejectAccess("anonymous", "exclusive AICEO role", "Authentication required.").catch(() => undefined);
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  let publicMetadata: Record<string, unknown>;
  try {
    publicMetadata = (await clerkClient.users.getUser(auth.userId)).publicMetadata;
  } catch {
    await aiceoControlPlane.rejectAccess(auth.userId, "exclusive AICEO role", "Clerk role authority is unavailable.").catch(() => undefined);
    res.status(503).json({ error: "Clerk role authority is unavailable." });
    return;
  }
  const authorization = authorizeAnyAiceoRole({
    userId: auth.userId,
    sessionClaims: auth.sessionClaims as Record<string, unknown> | null | undefined,
    publicMetadata,
  });
  if (!authorization.allowed) {
    await aiceoControlPlane.rejectAccess(auth.userId, "exclusive AICEO role", authorization.error).catch(() => undefined);
    res.status(authorization.status).json({ error: authorization.error });
    return;
  }
  await handler(req, res, authorization.userId, authorization.role);
};
const run = async (fn: () => Promise<unknown>, res: Response): Promise<void> => {
  try { res.json(await fn()); } catch (error) { const message = error instanceof Error ? error.message : String(error); res.status(/storage|database|connection/i.test(message) ? 503 : 409).json({ error: message }); }
};

router.get("/aiceo/self-check", async (_req, res) => { try { res.json(await aiceoControlPlane.selfCheck()); } catch (error) { res.status(503).json({ error: String(error) }); } });
router.get("/aiceo/status", async (_req, res) => {
  let status;
  try { status = await aiceoControlPlane.status(); } catch (error) { res.status(503).json({ error: String(error) }); return; }
  res.status(status.degraded ? 503 : 200).json(status);
});
router.get("/aiceo/history", async (req, res) => { try { res.json(await aiceoControlPlane.history(Number(req.query.limit) || 100)); } catch (error) { res.status(503).json({ error: String(error) }); } });
router.get("/aiceo/continuity", anyAiceoRole(async (_req, res, _userId, role) => {
  await run(() => aiceoContinuityLayer.snapshot(role), res);
}));
router.post("/aiceo/continuity/resume", anyAiceoRole(async (req, res, _userId, role) => {
  const parsed = z.object({ alias: z.string().min(1).max(120) }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await run(() => aiceoContinuityLayer.resume(parsed.data.alias, role), res);
}));
router.put("/aiceo/continuity/state", privileged("aiceo_operator", async (req, res, userId) => {
  const parsed = continuityUpdate.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await run(() => aiceoContinuityLayer.update(parsed.data, userId), res);
}));
router.post("/aiceo/tasks", privileged("aiceo_operator", async (req, res, userId) => {
  const parsed = submission.safeParse(req.body); if (!parsed.success) {
    await aiceoControlPlane.rejectSubmission(userId, parsed.error.message);
    res.status(400).json({ error: parsed.error.message }); return;
  }
  await run(() => aiceoControlPlane.submit(parsed.data, userId), res);
}));
router.get("/aiceo/governance-acceptance", anyAiceoRole(async (_req, res, _userId, role) => {
  await run(() => aiceoControlPlane.governanceAcceptance(role), res);
}));
router.post("/aiceo/governance-acceptance/test-task", privileged("aiceo_operator", async (_req, res, userId) => {
  await run(() => aiceoControlPlane.createGovernanceAcceptanceTask(userId), res);
}));
router.post("/aiceo/tasks/:id/execute", privileged("aiceo_operator", async (req, res, userId) => {
  await run(() => aiceoControlPlane.executeApproved(String(req.params.id), userId), res);
}));
router.post("/aiceo/tasks/:id/owner-governance-approve", privileged("aiceo_owner", async (req, res, userId) => {
  await run(() => aiceoControlPlane.approveOwnerGovernance(String(req.params.id), userId), res);
}));
router.post("/aiceo/tasks/:id/validate", privileged("aiceo_validator", async (req, res, userId) => { const parsed = z.object({ passed: z.literal(true), evidence }).strict().safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; } await run(() => aiceoControlPlane.validate(String(req.params.id), parsed.data.passed, userId, parsed.data.evidence), res); }));
router.post("/aiceo/tasks/:id/cancel", privileged("aiceo_operator", async (req, res, userId) => await run(() => aiceoControlPlane.cancel(String(req.params.id), userId), res)));
router.post("/aiceo/operator/kill-switch", privileged("aiceo_owner", async (req, res, userId) => run(() => aiceoControlPlane.setKillSwitch(req.body?.enabled !== false, userId), res)));
router.post("/aiceo/operator/recovery-ack", privileged("aiceo_owner", async (_req, res, userId) => run(() => aiceoControlPlane.acknowledgeRecovery(userId), res)));
router.post("/aiceo/operator/circuit-reset", privileged("aiceo_owner", async (_req, res, userId) => run(() => aiceoControlPlane.resetCircuit(userId), res)));
router.post("/aiceo/tasks/:id/diagnose", privileged("aiceo_operator", async (req, res, userId) => { const parsed = z.object({ resolution: z.enum(["BLOCKED", "CANCELLED"]), evidence }).strict().safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; } await run(() => aiceoControlPlane.diagnose(String(req.params.id), parsed.data.resolution, userId, parsed.data.evidence), res); }));

export default router;
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { aiceoControlPlane } from "../lib/aiceoControlPlane";

const router = Router();
const submission = z.object({
  action: z.string().min(1).max(120), resource: z.string().min(1).max(180),
  environment: z.enum(["development", "staging", "production"]).optional(),
  budget: z.object({ estimatedTokens: z.number().int().nonnegative(), estimatedCalls: z.number().int().nonnegative(), estimatedUsd: z.number().nonnegative() }).partial().optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(), maxRetries: z.number().int().nonnegative().max(2).optional(), clientTimestamp: z.string().datetime().optional(),
}).strict();
const evidence = z.object({ summary: z.string().min(1).max(500), facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }).strict();
const requireUser = (req: Request, res: Response): string | null => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Authentication required." }); return null; }
  return userId;
};
const hasAiceoRole = (req: Request, role: "aiceo_operator" | "aiceo_validator"): boolean => {
  const claims = getAuth(req).sessionClaims as Record<string, unknown> | null | undefined;
  const metadata = claims?.metadata && typeof claims.metadata === "object" ? claims.metadata as Record<string, unknown> : null;
  const publicMetadata = claims?.publicMetadata && typeof claims.publicMetadata === "object" ? claims.publicMetadata as Record<string, unknown> : null;
  const values = [claims?.role, metadata?.role, publicMetadata?.role, ...(Array.isArray(claims?.roles) ? claims.roles : [])];
  return values.includes(role);
};
const operator = (handler: (req: Request, res: Response, userId: string) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
  const userId = requireUser(req, res); if (userId) await handler(req, res, userId);
};
const privileged = (role: "aiceo_operator" | "aiceo_validator", handler: (req: Request, res: Response, userId: string) => Promise<void>) => operator(async (req, res, userId) => {
  if (!hasAiceoRole(req, role)) { res.status(403).json({ error: `ARCH-001 ${role} role required.` }); return; }
  await handler(req, res, userId);
});
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
router.post("/aiceo/tasks", operator(async (req, res, userId) => {
  const parsed = submission.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await run(() => aiceoControlPlane.submit(parsed.data, userId), res);
}));
router.post("/aiceo/tasks/:id/execute", operator(async (req, res, userId) => {
  await run(() => aiceoControlPlane.executeApproved(String(req.params.id), userId), res);
}));
router.post("/aiceo/tasks/:id/validate", privileged("aiceo_validator", async (req, res, userId) => { const parsed = z.object({ passed: z.literal(true), evidence }).strict().safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; } await run(() => aiceoControlPlane.validate(String(req.params.id), parsed.data.passed, userId, parsed.data.evidence), res); }));
router.post("/aiceo/tasks/:id/cancel", operator(async (req, res, userId) => await run(() => aiceoControlPlane.cancel(String(req.params.id), userId), res)));
router.post("/aiceo/operator/kill-switch", privileged("aiceo_operator", async (req, res, userId) => run(() => aiceoControlPlane.setKillSwitch(req.body?.enabled !== false, userId), res)));
router.post("/aiceo/operator/recovery-ack", privileged("aiceo_operator", async (_req, res, userId) => run(() => aiceoControlPlane.acknowledgeRecovery(userId), res)));
router.post("/aiceo/operator/circuit-reset", privileged("aiceo_operator", async (_req, res, userId) => run(() => aiceoControlPlane.resetCircuit(userId), res)));
router.post("/aiceo/tasks/:id/diagnose", privileged("aiceo_operator", async (req, res, userId) => { const parsed = z.object({ resolution: z.enum(["BLOCKED", "CANCELLED"]), evidence }).strict().safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; } await run(() => aiceoControlPlane.diagnose(String(req.params.id), parsed.data.resolution, userId, parsed.data.evidence), res); }));

export default router;
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetMarketUniverseQueryParams,
  GetMarketUniverseResponse,
  GetFocusedScanStatusResponse,
  GetCatalystRadarResponse,
  GetBackendLifelineResponse,
  GetEngineeringGovernanceResponse,
  GetOpportunityCenterResponse,
  GetRadarStatusResponse,
  GetSignalValidationAuditParams,
  GetSignalValidationAuditResponse,
  GetSignalValidationQueryParams,
  GetSignalValidationResponse,
  GetShadowLearningValidationQueryParams,
  GetShadowLearningValidationResponse,
} from "@workspace/api-zod";

import { databentoLive } from "../lib/databentoLive";
import { marketUniverse } from "../lib/marketUniverse";
import { signalValidation } from "../lib/signalValidation";
import { shadowLearning } from "../lib/shadowLearning";
import { buildEngineeringGovernanceSnapshot } from "../lib/engineeringGovernance";
import { backendLifeline } from "../lib/backendLifeline";
import { alertService } from "../lib/alertService";
import { internalTaskRegistry } from "../lib/internalTaskRegistry";
import { radarSseConnections } from "../lib/sseConnections";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/radar/status", (_req: Request, res: Response): void => {
  res.json(GetRadarStatusResponse.parse(databentoLive.getStatus()));
});

router.get("/radar/engineering-governance", (_req: Request, res: Response): void => {
  res.json(GetEngineeringGovernanceResponse.parse(buildEngineeringGovernanceSnapshot({
    now: new Date(),
    protectedScanners: databentoLive.getEngineeringScannerHealth(),
    internalTaskHealth: internalTaskRegistry.getSnapshot(),
  })));
});

router.get("/radar/lifeline", (_req: Request, res: Response): void => {
  res.json(GetBackendLifelineResponse.parse(backendLifeline.getSnapshot({
    symbols: databentoLive.getLifelineHealth(),
    alert: alertService.getHealth(),
    marketUniverse: marketUniverse.getLifelineHealth(),
    internalTasks: internalTaskRegistry.getSnapshot(),
  })));
});

router.get("/radar/universe", (req: Request, res: Response): void => {
  const parsed = GetMarketUniverseQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(GetMarketUniverseResponse.parse(marketUniverse.query(parsed.data)));
});

router.get("/radar/focused-scans", (_req: Request, res: Response): void => {
  res.json(GetFocusedScanStatusResponse.parse(databentoLive.getFocusedScanStatus()));
});

router.get("/radar/catalysts", (_req: Request, res: Response): void => {
  res.json(GetCatalystRadarResponse.parse(databentoLive.getCatalystRadar()));
});

router.get("/radar/opportunities", (_req: Request, res: Response): void => {
  res.json(GetOpportunityCenterResponse.parse(databentoLive.getOpportunityCenter()));
});

router.get("/radar/validation", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetSignalValidationQueryParams.safeParse({
    ...req.query,
    horizonDays: typeof req.query.horizonDays === "string"
      ? Number(req.query.horizonDays)
      : req.query.horizonDays,
    limit: typeof req.query.limit === "string"
      ? Number(req.query.limit)
      : req.query.limit,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const dashboard = await signalValidation.getDashboard(parsed.data);
  res.json(GetSignalValidationResponse.parse(dashboard));
});

router.get(
  "/radar/validation/signals/:signalId",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = GetSignalValidationAuditParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!UUID_PATTERN.test(parsed.data.signalId)) {
      res.status(400).json({ error: "signalId must be a valid UUID." });
      return;
    }
    try {
      const audit = await signalValidation.getAudit(parsed.data.signalId);
      if (!audit) {
        res.status(404).json({ error: "Signal validation record not found." });
        return;
      }
      res.json(GetSignalValidationAuditResponse.parse(audit));
    } catch (error) {
      req.log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Signal validation audit storage is unavailable",
      );
      res.status(503).json({
        error: "Persistent validation storage is unavailable. Live Alpha Radar is unaffected.",
      });
    }
  },
);

router.get("/radar/shadow-learning", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetShadowLearningValidationQueryParams.safeParse({
    ...req.query,
    horizonDays: typeof req.query.horizonDays === "string"
      ? Number(req.query.horizonDays)
      : req.query.horizonDays,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const dashboard = await shadowLearning.getDashboard(parsed.data);
  res.json(GetShadowLearningValidationResponse.parse(dashboard));
});

router.get("/radar/events", (req: Request, res: Response): void => {
  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 2000\n\n");

  let closed = false;
  let backpressured = false;
  const removeFromRegistry = radarSseConnections.add(res);
  const writeStatus = (): void => {
    if (closed || backpressured || res.destroyed || res.writableEnded) return;
    const accepted = res.write(`event: status\ndata: ${JSON.stringify(databentoLive.getStatus())}\n\n`);
    if (!accepted) {
      backpressured = true;
      res.once("drain", () => {
        backpressured = false;
      });
    }
  };
  writeStatus();

  const heartbeat = setInterval(() => {
    // Publish a freshly derived status even when the market is quiet so
    // session transitions and readiness context update without treating this
    // transport heartbeat as market evidence.
    writeStatus();
  }, 15_000);
  databentoLive.on("status", writeStatus);

  req.on("close", () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    databentoLive.off("status", writeStatus);
    removeFromRegistry();
    if (!res.writableEnded) res.end();
  });
});

export default router;
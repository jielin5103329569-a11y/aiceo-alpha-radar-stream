import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetMarketUniverseQueryParams,
  GetMarketUniverseResponse,
  GetFocusedScanStatusResponse,
  GetRadarStatusResponse,
  GetSignalValidationAuditParams,
  GetSignalValidationAuditResponse,
  GetSignalValidationQueryParams,
  GetSignalValidationResponse,
  StartRadarConnectionResponse,
  StopRadarConnectionResponse,
} from "@workspace/api-zod";

import { databentoLive } from "../lib/databentoLive";
import { marketUniverse } from "../lib/marketUniverse";
import { signalValidation } from "../lib/signalValidation";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/radar/status", (_req: Request, res: Response): void => {
  res.json(GetRadarStatusResponse.parse(databentoLive.getStatus()));
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

router.post("/radar/connect", (req: Request, res: Response): void => {
  req.log.info("Starting safe Databento live connection");
  res.json(StartRadarConnectionResponse.parse(databentoLive.start()));
});

router.post("/radar/disconnect", (req: Request, res: Response): void => {
  req.log.info("Stopping safe Databento live connection");
  res.json(StopRadarConnectionResponse.parse(databentoLive.stop()));
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

  const writeStatus = (): void => {
    res.write(`event: status\ndata: ${JSON.stringify(databentoLive.getStatus())}\n\n`);
  };
  writeStatus();

  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15_000);
  databentoLive.on("status", writeStatus);

  req.on("close", () => {
    clearInterval(heartbeat);
    databentoLive.off("status", writeStatus);
    res.end();
  });
});

export default router;
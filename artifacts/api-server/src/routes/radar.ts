import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetRadarStatusResponse,
  StartRadarConnectionResponse,
  StopRadarConnectionResponse,
} from "@workspace/api-zod";

import { databentoLive } from "../lib/databentoLive";

const router: IRouter = Router();

router.get("/radar/status", (_req: Request, res: Response): void => {
  res.json(GetRadarStatusResponse.parse(databentoLive.getStatus()));
});

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

  const writeStatus = (): void => {
    res.write(`event: status\ndata: ${JSON.stringify(databentoLive.getStatus())}\n\n`);
  };
  writeStatus();

  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25_000);
  databentoLive.on("status", writeStatus);

  req.on("close", () => {
    clearInterval(heartbeat);
    databentoLive.off("status", writeStatus);
    res.end();
  });
});

export default router;
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  AppendResearchObservationBody,
  AppendResearchObservationResponse,
  GetResearchSidecarHistoryQueryParams,
  GetResearchSidecarHistoryResponse,
  GetResearchSidecarResponse,
} from "@workspace/api-zod";
import {
  degradedResearchSidecarSnapshot,
  researchSidecar,
  RESEARCH_SIDECAR_UNAVAILABLE_REASON,
  ResearchObservationConflictError,
  ResearchObservationValidationError,
} from "../lib/researchSidecar";

const router: IRouter = Router();

function requireResearchAuth(req: Request, res: Response): boolean {
  if (getAuth(req).userId) return true;
  res.status(401).json({ error: "Authentication is required to append research observations." });
  return false;
}

router.post(
  "/research-sidecar/observations",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireResearchAuth(req, res)) return;
    const parsed = AppendResearchObservationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await researchSidecar.appendObservation(parsed.data);
      res.status(result.idempotent ? 200 : 201).json(
        AppendResearchObservationResponse.parse(result),
      );
    } catch (error) {
      if (error instanceof ResearchObservationValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof ResearchObservationConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      req.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        RESEARCH_SIDECAR_UNAVAILABLE_REASON,
      );
      res.status(503).json({
        status: "degraded",
        reason: RESEARCH_SIDECAR_UNAVAILABLE_REASON,
      });
    }
  },
);

router.get("/research-sidecar", async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await researchSidecar.getSnapshot();
    res.json(GetResearchSidecarResponse.parse(snapshot));
  } catch (error) {
    req.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Research sidecar storage is unavailable",
    );
    res.status(503).json(GetResearchSidecarResponse.parse(degradedResearchSidecarSnapshot()));
  }
});

router.get("/research-sidecar/snapshot", async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await researchSidecar.getSnapshot();
    res.json(GetResearchSidecarResponse.parse(snapshot));
  } catch (error) {
    req.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      RESEARCH_SIDECAR_UNAVAILABLE_REASON,
    );
    res.status(503).json(GetResearchSidecarResponse.parse(degradedResearchSidecarSnapshot()));
  }
});

router.get("/research-sidecar/history", async (req: Request, res: Response): Promise<void> => {
  const parsedQuery = GetResearchSidecarHistoryQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }
  try {
    const history = await researchSidecar.listHistory(parsedQuery.data.limit);
    res.json(GetResearchSidecarHistoryResponse.parse(history));
  } catch (error) {
    req.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Research sidecar history storage is unavailable",
    );
    res.status(503).json(
      GetResearchSidecarHistoryResponse.parse({
        status: "degraded",
        lanes: ["alex_moonvest", "serenity"],
        events: [],
        resonances: [],
        reason: RESEARCH_SIDECAR_UNAVAILABLE_REASON,
      }),
    );
  }
});

export default router;
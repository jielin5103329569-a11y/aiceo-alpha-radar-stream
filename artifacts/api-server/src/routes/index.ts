import { Router, type IRouter } from "express";
import healthRouter from "./health";
import radarRouter from "./radar";
import alertsRouter from "./alerts";
import researchSidecarRouter from "./researchSidecar";

const router: IRouter = Router();

router.use(healthRouter);
router.use(radarRouter);
router.use(alertsRouter);
router.use(researchSidecarRouter);

export default router;

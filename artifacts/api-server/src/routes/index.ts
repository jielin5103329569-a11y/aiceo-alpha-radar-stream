import { Router, type IRouter } from "express";
import healthRouter from "./health";
import radarRouter from "./radar";

const router: IRouter = Router();

router.use(healthRouter);
router.use(radarRouter);

export default router;

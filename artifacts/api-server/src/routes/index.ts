import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import meRouter from "./me";
import sitesRouter from "./sites";
import jobsRouter from "./jobs";
import botsRouter from "./bots";
import voiceRouter from "./voice";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(meRouter);
router.use(sitesRouter);
router.use(jobsRouter);
router.use(botsRouter);
router.use(voiceRouter);

export default router;

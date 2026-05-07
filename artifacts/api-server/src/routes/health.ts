import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

import { PUTER_CONFIGURED } from "../lib/puter";
import { aiPing } from "../lib/ai";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * /api/health — extended status including AI engine + DB readiness.
 */
router.get("/health", async (_req, res) => {
  const [aiStatus, dbCheck] = await Promise.all([
    aiPing(),
    (async () => {
      try {
        const { pool } = await import("../lib/db");
        await pool.query("SELECT 1");
        return { ok: true } as const;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } as const;
      }
    })(),
  ]);
  res.json({
    status: dbCheck.ok ? "ok" : "degraded",
    db: dbCheck,
    ai: aiStatus,
    hosting: { configured: PUTER_CONFIGURED },
    auth: {
      clerk: Boolean(process.env.CLERK_SECRET_KEY),
      magicLink: true,
    },
    time: new Date().toISOString(),
  });
});

export default router;

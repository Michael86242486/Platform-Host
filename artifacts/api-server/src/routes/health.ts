import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

import { PUTER_CONFIGURED, puterPing } from "../lib/puter";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * /api/health — extended status used by the agent + dashboard. Includes a live
 * Puter ping so we can surface broken hosting credentials early instead of
 * letting the first build fail.
 */
router.get("/health", async (_req, res) => {
  const [puter, dbCheck] = await Promise.all([
    puterPing(),
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
    puter: { configured: PUTER_CONFIGURED, ...puter },
    auth: {
      clerk: Boolean(process.env.CLERK_SECRET_KEY),
      magicLink: true,
    },
    time: new Date().toISOString(),
  });
});

export default router;

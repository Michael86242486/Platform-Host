/**
 * OpenClaw Memory API — user AI profile endpoints.
 * The profile stores what WebForge has learned about each user's
 * design taste, preferred stack, and style.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userProfilesTable } from "../lib/db";
import { requireAuth } from "../middlewares/auth";
import type { UserAIProfile } from "../lib/db";

const router: IRouter = Router();

/** GET /api/me/profile — fetch the user's AI profile */
router.get("/me/profile", requireAuth, async (req, res) => {
  try {
    const userId = (req as { userId?: string }).userId;
    if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

    const [row] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId))
      .limit(1);

    if (!row) {
      res.json({ profile: null, hasProfile: false });
      return;
    }

    res.json({ profile: row.profile, hasProfile: true, updatedAt: row.updatedAt });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/** DELETE /api/me/profile — reset the AI memory (privacy) */
router.delete("/me/profile", requireAuth, async (req, res) => {
  try {
    const userId = (req as { userId?: string }).userId;
    if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

    await db
      .delete(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));

    res.json({ ok: true, message: "AI profile cleared." });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear profile" });
  }
});

export default router;

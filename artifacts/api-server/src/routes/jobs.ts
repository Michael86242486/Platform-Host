import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/auth";
import { db, jobsTable, sitesTable } from "../lib/db";

const router: IRouter = Router();

router.get("/jobs", requireAuth, async (req, res) => {
  const rows = await db
    .select({
      id: jobsTable.id,
      siteId: jobsTable.siteId,
      siteName: sitesTable.name,
      kind: jobsTable.kind,
      status: jobsTable.status,
      progress: jobsTable.progress,
      message: jobsTable.message,
      createdAt: jobsTable.createdAt,
      finishedAt: jobsTable.finishedAt,
    })
    .from(jobsTable)
    .innerJoin(sitesTable, eq(sitesTable.id, jobsTable.siteId))
    .where(eq(jobsTable.userId, req.user!.id))
    .orderBy(desc(jobsTable.createdAt))
    .limit(50);
  res.json(
    rows.map((j) => ({
      id: j.id,
      siteId: j.siteId,
      siteName: j.siteName,
      kind: j.kind,
      status: j.status,
      progress: j.progress,
      message: j.message,
      createdAt: j.createdAt.toISOString(),
      finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
    })),
  );
});

export default router;

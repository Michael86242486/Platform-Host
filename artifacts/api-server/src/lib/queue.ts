import { eq } from "drizzle-orm";

import { db, jobsTable, sitesTable, type Job } from "./db";
import { generateSite } from "./generator";
import { logger } from "./logger";

const STAGES: { progress: number; message: string; ms: number }[] = [
  { progress: 8, message: "Reading prompt", ms: 350 },
  { progress: 22, message: "Choosing palette", ms: 450 },
  { progress: 38, message: "Sketching layout", ms: 500 },
  { progress: 55, message: "Writing HTML", ms: 600 },
  { progress: 72, message: "Styling components", ms: 600 },
  { progress: 88, message: "Wiring interactions", ms: 500 },
  { progress: 96, message: "Publishing", ms: 400 },
];

class JobQueue {
  private running = new Set<string>();

  async enqueue(jobId: string): Promise<void> {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);
    // Fire and forget — don't block the request
    void this.run(jobId).finally(() => this.running.delete(jobId));
  }

  /** Pick up any orphaned (queued/running) jobs after a server restart. */
  async resumeOrphans(): Promise<void> {
    const orphans = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.status, "queued"));
    for (const j of orphans) {
      void this.enqueue(j.id);
    }
    const stuck = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.status, "running"));
    for (const j of stuck) {
      // Reset to queued and re-run
      await db
        .update(jobsTable)
        .set({ status: "queued", progress: 0 })
        .where(eq(jobsTable.id, j.id));
      void this.enqueue(j.id);
    }
  }

  private async run(jobId: string): Promise<void> {
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);
    if (!job) return;

    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, job.siteId))
      .limit(1);
    if (!site) {
      await this.failJob(job, "Site not found");
      return;
    }

    try {
      await db
        .update(jobsTable)
        .set({ status: "running", message: STAGES[0].message, progress: 1 })
        .where(eq(jobsTable.id, job.id));
      await db
        .update(sitesTable)
        .set({
          status: "generating",
          progress: 1,
          message: STAGES[0].message,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(sitesTable.id, site.id));

      for (const stage of STAGES) {
        await sleep(stage.ms);
        await db
          .update(jobsTable)
          .set({ progress: stage.progress, message: stage.message })
          .where(eq(jobsTable.id, job.id));
        await db
          .update(sitesTable)
          .set({
            progress: stage.progress,
            message: stage.message,
            updatedAt: new Date(),
          })
          .where(eq(sitesTable.id, site.id));
      }

      const promptForGeneration =
        job.kind === "edit" && job.instructions
          ? `${site.prompt}\n\nEdits: ${job.instructions}`
          : site.prompt;

      const generated = generateSite(promptForGeneration, site.name);

      await db
        .update(sitesTable)
        .set({
          status: "ready",
          progress: 100,
          message: "Ready",
          html: generated.html,
          css: generated.css,
          js: generated.js,
          coverColor: generated.coverColor,
          name: generated.name,
          updatedAt: new Date(),
        })
        .where(eq(sitesTable.id, site.id));

      await db
        .update(jobsTable)
        .set({
          status: "done",
          progress: 100,
          message: "Done",
          finishedAt: new Date(),
        })
        .where(eq(jobsTable.id, job.id));
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Job failed");
      await this.failJob(job, err instanceof Error ? err.message : "Unknown error");
    }
  }

  private async failJob(job: Job, message: string): Promise<void> {
    await db
      .update(jobsTable)
      .set({
        status: "failed",
        message,
        finishedAt: new Date(),
      })
      .where(eq(jobsTable.id, job.id));
    await db
      .update(sitesTable)
      .set({
        status: "failed",
        error: message,
        message,
        updatedAt: new Date(),
      })
      .where(eq(sitesTable.id, job.siteId));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const jobQueue = new JobQueue();

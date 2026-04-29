import { eq } from "drizzle-orm";

import {
  db,
  jobsTable,
  messagesTable,
  sitesTable,
  type Job,
  type SitePlan,
} from "./db";
import { buildPlan, analyzeProject } from "./generator";
import {
  analyzeProjectAI,
  buildProjectAIStream,
  editProjectAI,
} from "./llm-generator";
import { logger } from "./logger";
import { getDecryptedSecrets, injectSecretsIntoFiles } from "./secrets";

const MAX_CONCURRENCY = 3;

/** Sentinel stored in jobs.instructions for analyze jobs that should
 *  auto-chain straight into a build job once analysis completes. */
const AUTO_BUILD_SENTINEL = "__AUTO_BUILD__";

const ANALYSIS_STAGES: { progress: number; label: string; ms: number }[] = [
  { progress: 12, label: "Reading your prompt", ms: 250 },
  { progress: 28, label: "Classifying project", ms: 250 },
  { progress: 50, label: "Drafting structure", ms: 250 },
  { progress: 75, label: "Choosing palette + mood", ms: 250 },
];

const BUILD_STAGES: { progress: number; label: string; ms: number }[] = [
  { progress: 8, label: "Planning architecture", ms: 250 },
  { progress: 22, label: "Wireframing pages", ms: 250 },
  { progress: 38, label: "Composing layouts", ms: 250 },
  { progress: 55, label: "Writing components", ms: 250 },
];

class JobQueue {
  private active = new Set<string>();
  private waiting: string[] = [];

  async enqueue(jobId: string): Promise<void> {
    if (this.active.has(jobId) || this.waiting.includes(jobId)) return;
    this.waiting.push(jobId);
    this.pump();
  }

  private pump(): void {
    while (this.active.size < MAX_CONCURRENCY && this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      this.active.add(next);
      void this.run(next).finally(() => {
        this.active.delete(next);
        this.pump();
      });
    }
  }

  /** Re-enqueue any jobs left in queued/running after a server restart. */
  async resumeOrphans(): Promise<void> {
    const queued = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.status, "queued"));
    for (const j of queued) void this.enqueue(j.id);
    const stuck = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.status, "running"));
    for (const j of stuck) {
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
      if (job.kind === "analyze") {
        await this.runAnalysis(job, site.prompt, site.id, site.name);
      } else if (
        job.kind === "create" ||
        job.kind === "edit" ||
        job.kind === "retry"
      ) {
        await this.runBuild(job, site.id);
      } else {
        await this.failJob(job, `Unknown job kind: ${job.kind}`);
      }
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Job failed");
      await this.failJob(
        job,
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  private async runAnalysis(
    job: Job,
    prompt: string,
    siteId: string,
    name: string,
  ): Promise<void> {
    await db
      .update(jobsTable)
      .set({ status: "running", message: ANALYSIS_STAGES[0].label, progress: 1 })
      .where(eq(jobsTable.id, job.id));
    await db
      .update(sitesTable)
      .set({
        status: "analyzing",
        progress: 1,
        message: ANALYSIS_STAGES[0].label,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(sitesTable.id, siteId));
    await insertAgentMessage(
      job.userId,
      siteId,
      "log",
      "Starting analysis…",
      { stage: 0 },
    );

    // Kick off the AI call in parallel with cosmetic progress stages.
    const analysisPromise = analyzeProjectAI(prompt, name);

    for (const stage of ANALYSIS_STAGES) {
      await sleep(stage.ms);
      await db
        .update(jobsTable)
        .set({ progress: stage.progress, message: stage.label })
        .where(eq(jobsTable.id, job.id));
      await db
        .update(sitesTable)
        .set({
          progress: stage.progress,
          message: stage.label,
          updatedAt: new Date(),
        })
        .where(eq(sitesTable.id, siteId));
      await insertAgentMessage(job.userId, siteId, "log", stage.label, {
        progress: stage.progress,
      });
    }

    const analysis = await analysisPromise;
    const plan = buildPlan(analysis);
    const autoBuild = job.instructions === AUTO_BUILD_SENTINEL;

    await db
      .update(sitesTable)
      .set({
        status: autoBuild ? "queued" : "awaiting_confirmation",
        progress: autoBuild ? 100 : 100,
        message: autoBuild
          ? "Plan ready — starting build"
          : "Awaiting your confirmation",
        analysis,
        plan,
        updatedAt: new Date(),
      })
      .where(eq(sitesTable.id, siteId));

    await insertAgentMessage(
      job.userId,
      siteId,
      "analysis",
      `Detected: ${analysis.type} — "${analysis.intent}". ${analysis.features.length} features, ${analysis.pages.length} pages.`,
      { analysis },
    );
    await insertAgentMessage(
      job.userId,
      siteId,
      "plan",
      planSummary(plan),
      { plan },
    );

    if (!autoBuild) {
      await insertAgentMessage(
        job.userId,
        siteId,
        "awaiting_confirmation",
        "Looks good? Reply 'build' (or tap Confirm) to start the build. I'll wait.",
        null,
      );
    }

    await db
      .update(jobsTable)
      .set({
        status: "done",
        progress: 100,
        message: "Plan ready",
        finishedAt: new Date(),
      })
      .where(eq(jobsTable.id, job.id));

    // Auto-chain straight into a build job (mobile app flow).
    if (autoBuild) {
      const [next] = await db
        .insert(jobsTable)
        .values({
          userId: job.userId,
          siteId,
          kind: "create",
          status: "queued",
          progress: 0,
          message: "Queued",
        })
        .returning();
      await jobQueue.enqueue(next.id);
    }
  }

  private async runBuild(job: Job, siteId: string): Promise<void> {
    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, siteId))
      .limit(1);
    if (!site) throw new Error("Site missing");

    let plan = site.plan;
    if (!plan) {
      const analysis =
        site.analysis ?? (await analyzeProjectAI(site.prompt, site.name));
      plan = buildPlan(analysis);
      await db
        .update(sitesTable)
        .set({ analysis, plan })
        .where(eq(sitesTable.id, siteId));
    }

    await db
      .update(jobsTable)
      .set({ status: "running", message: BUILD_STAGES[0].label, progress: 1 })
      .where(eq(jobsTable.id, job.id));
    await db
      .update(sitesTable)
      .set({
        status: "building",
        progress: 1,
        message: BUILD_STAGES[0].label,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(sitesTable.id, siteId));
    await insertAgentMessage(
      job.userId,
      siteId,
      "build_started",
      job.kind === "edit"
        ? "Applying your edits…"
        : "Confirmed. Forging your project now.",
      null,
    );

    const isEdit = job.kind === "edit" && !!job.instructions;

    let out: {
      files: Record<string, string>;
      coverColor: string;
      name: string;
    };

    if (isEdit && site.files) {
      // Edits still go through the JSON path (full-rewrite semantics).
      for (const stage of BUILD_STAGES) {
        await sleep(stage.ms);
        await db
          .update(jobsTable)
          .set({ progress: stage.progress, message: stage.label })
          .where(eq(jobsTable.id, job.id));
        await db
          .update(sitesTable)
          .set({
            progress: stage.progress,
            message: stage.label,
            updatedAt: new Date(),
          })
          .where(eq(sitesTable.id, siteId));
        await insertAgentMessage(
          job.userId,
          siteId,
          "build_progress",
          stage.label,
          { progress: stage.progress },
        );
      }
      out = await editProjectAI(site.files, site.name, job.instructions!);
    } else {
      // Quick cosmetic ramp before the model starts streaming.
      await db
        .update(sitesTable)
        .set({
          status: "building",
          progress: 8,
          message: BUILD_STAGES[0].label,
          files: {},
          updatedAt: new Date(),
        })
        .where(eq(sitesTable.id, siteId));
      await db
        .update(jobsTable)
        .set({ progress: 8, message: BUILD_STAGES[0].label })
        .where(eq(jobsTable.id, job.id));

      // Stream the build token-by-token. We update site.files in real time so
      // the iframe in the mobile app shows partial HTML as the model writes.
      let lastReportedFile: string | null = null;
      let revealedCount = 0;
      const seenFiles = new Set<string>();
      // Tell the model which user-provided secrets are available so it can
      // wire them in as `${NAME}` placeholders (we substitute the real values
      // post-stream in `injectSecretsIntoFiles`).
      const availableSecretNames = Object.keys(
        await getDecryptedSecrets(job.userId),
      );
      const promptWithSecrets =
        availableSecretNames.length > 0
          ? `${site.prompt}\n\n[Available user secrets — reference as \${NAME} and I'll inject the value at build-time]: ${availableSecretNames.join(", ")}`
          : site.prompt;
      out = await buildProjectAIStream(
        plan,
        site.name,
        promptWithSecrets,
        async ({ coverColor, files, currentFile, bytes }) => {
          const fileCount = Object.keys(files).length;
          // Estimate progress: 10% start + grows with bytes streamed (capped 90%)
          const byteProgress = Math.min(Math.round(bytes / 250), 80);
          const pct = Math.min(10 + byteProgress, 90);
          const label = currentFile
            ? streamLabel(currentFile)
            : "Streaming bytes…";
          await db
            .update(sitesTable)
            .set({
              status: "building",
              files: files as Record<string, string>,
              coverColor,
              progress: pct,
              message: label,
              updatedAt: new Date(),
            })
            .where(eq(sitesTable.id, siteId));
          await db
            .update(jobsTable)
            .set({ progress: pct, message: label })
            .where(eq(jobsTable.id, job.id));

          // Emit a chat log line whenever a new file appears or we cross 50%.
          if (currentFile && currentFile !== lastReportedFile) {
            lastReportedFile = currentFile;
            if (!seenFiles.has(currentFile)) {
              seenFiles.add(currentFile);
              revealedCount = fileCount;
              await insertAgentMessage(
                job.userId,
                siteId,
                "build_progress",
                streamLabel(currentFile),
                { progress: pct, file: currentFile },
              );
            }
          }
          void revealedCount;
        },
      );
    }

    const planForBuild: SitePlan = isEdit
      ? {
          ...plan,
          notes: [...plan.notes, `Edit applied: ${job.instructions}`],
          summary: `${plan.summary} Edit: ${job.instructions}`,
        }
      : plan;

    // Inject any user-stored secrets the AI referenced as `${NAME}`. Values
    // are decrypted on demand and never logged.
    const userSecrets = await getDecryptedSecrets(job.userId);
    const finalFiles = injectSecretsIntoFiles(out.files, userSecrets);

    await db
      .update(sitesTable)
      .set({
        status: "ready",
        progress: 100,
        message: "Ready",
        files: finalFiles,
        coverColor: out.coverColor,
        plan: planForBuild,
        updatedAt: new Date(),
      })
      .where(eq(sitesTable.id, siteId));
    await db
      .update(jobsTable)
      .set({
        status: "done",
        progress: 100,
        message: "Done",
        finishedAt: new Date(),
      })
      .where(eq(jobsTable.id, job.id));
    await insertAgentMessage(
      job.userId,
      siteId,
      "build_done",
      `Built ${Object.keys(out.files).length} files. Tap Preview to see it live.`,
      { files: Object.keys(out.files) },
    );
  }

  private async failJob(job: Job, message: string): Promise<void> {
    await db
      .update(jobsTable)
      .set({ status: "failed", message, finishedAt: new Date() })
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
    await insertAgentMessage(
      job.userId,
      job.siteId,
      "build_failed",
      `Build failed: ${message}`,
      null,
    );
  }
}

function planSummary(plan: SitePlan): string {
  const lines: string[] = [];
  lines.push(`Plan: ${plan.summary}`);
  lines.push("");
  lines.push("Pages:");
  for (const p of plan.pages) {
    lines.push(`  • ${p.title} — ${p.purpose}`);
  }
  lines.push("");
  lines.push(`Style: ${plan.styles.palette} (${plan.styles.mood})`);
  if (plan.features.length > 0) {
    lines.push(`Features: ${plan.features.join(", ")}`);
  }
  return lines.join("\n");
}

async function insertAgentMessage(
  userId: string,
  siteId: string,
  kind:
    | "text"
    | "analysis"
    | "plan"
    | "awaiting_confirmation"
    | "log"
    | "build_started"
    | "build_progress"
    | "build_done"
    | "build_failed",
  content: string,
  data: Record<string, unknown> | null,
): Promise<void> {
  await db.insert(messagesTable).values({
    userId,
    siteId,
    role: "agent",
    kind,
    content,
    data,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function streamLabel(path: string): string {
  if (path.endsWith(".css")) return `Painting styles — ${path}`;
  if (path.endsWith(".js")) return `Wiring interactions — ${path}`;
  if (path === "index.html") return "Streaming home page";
  if (path.endsWith(".html"))
    return `Streaming ${path.replace(/\.html$/, "")} page`;
  return `Streaming ${path}`;
}

// Re-export so callers (telegram.ts) that imported BUILD_STAGES still work.
export { BUILD_STAGES };
// Keep the legacy synchronous fallback exported for any consumer.
export { analyzeProject };
export const jobQueue = new JobQueue();

import crypto from "node:crypto";
import { eq } from "drizzle-orm";

import {
  db,
  jobsTable,
  messagesTable,
  sitesTable,
  type Job,
  type SiteCheckpoint,
  type SiteFiles,
  type SitePlan,
} from "./db";
import { buildPlan, analyzeProject } from "./generator";
import {
  analyzeProjectAI,
  buildProjectAIParallel,
  buildProjectAIStream,
  editProjectAI,
  researchInspirationAI,
  auditProjectAI,
  autoFixProjectAI,
  type ResearchBrief,
  type AuditIssue,
  type BuildQualityReport,
} from "./llm-generator";
import {
  AgentBuildLog,
} from "./agent-skills";
import { logger } from "./logger";
import { getDecryptedSecrets, injectSecretsIntoFiles } from "./secrets";
import { siteEventBus } from "./eventBus";
import { streamNarration } from "./narrate";
import { PUTER_CONFIGURED, uploadSite } from "./puter";

const MAX_CONCURRENCY = 3;
const AUTO_BUILD_SENTINEL = "__AUTO_BUILD__";

// ---------------------------------------------------------------------------
// Pipeline step definitions (displayed in chat + progress bar)
// ---------------------------------------------------------------------------

const PIPELINE_STEPS = [
  { step: 1, label: "Researching design inspiration",         pctStart: 2,  pctEnd: 14 },
  { step: 2, label: "Building the full website with AI",      pctStart: 14, pctEnd: 65 },
  { step: 3, label: "Auditing quality: SEO, accessibility, mobile", pctStart: 65, pctEnd: 73 },
  { step: 4, label: "Self-review pass (autonomous QA)",        pctStart: 73, pctEnd: 78 },
  { step: 5, label: "Auto-fixing issues found",               pctStart: 78, pctEnd: 88 },
  { step: 6, label: "Finalizing hero image",                  pctStart: 88, pctEnd: 92 },
  { step: 7, label: "Publishing to your live URL",            pctStart: 92, pctEnd: 100 },
] as const;

const ANALYSIS_STAGES = [
  { progress: 12, label: "Reading your prompt",    ms: 250 },
  { progress: 28, label: "Classifying project",    ms: 250 },
  { progress: 50, label: "Drafting structure",     ms: 250 },
  { progress: 75, label: "Choosing palette + mood", ms: 250 },
];

// ---------------------------------------------------------------------------
// Checkpoint helpers
// ---------------------------------------------------------------------------

async function saveCheckpoint(
  siteId: string,
  label: string,
  files?: SiteFiles,
  progress?: number,
): Promise<void> {
  try {
    const [row] = await db
      .select({ checkpoints: sitesTable.checkpoints, progress: sitesTable.progress })
      .from(sitesTable)
      .where(eq(sitesTable.id, siteId))
      .limit(1);
    if (!row) return;
    const existing: SiteCheckpoint[] = (row.checkpoints as SiteCheckpoint[] | null) ?? [];
    const cp: SiteCheckpoint = {
      id: crypto.randomUUID(),
      label,
      createdAt: new Date().toISOString(),
      files,
      progress: progress ?? row.progress,
    };
    await db
      .update(sitesTable)
      .set({ checkpoints: [...existing, cp].slice(-10) })
      .where(eq(sitesTable.id, siteId));
  } catch (err) {
    logger.warn({ err }, "saveCheckpoint failed (non-fatal)");
  }
}

// ---------------------------------------------------------------------------
// Progress helpers
// ---------------------------------------------------------------------------

async function setProgress(
  jobId: string,
  siteId: string,
  pct: number,
  message: string,
  status: "building" | "analyzing" | "awaiting_confirmation" = "building",
): Promise<void> {
  await db.update(jobsTable).set({ progress: pct, message }).where(eq(jobsTable.id, jobId));
  await db.update(sitesTable).set({ status, progress: pct, message, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
  siteEventBus.emitSite({ type: "site_updated", siteId });
}

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------

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

  async resumeOrphans(): Promise<void> {
    const queued = await db.select().from(jobsTable).where(eq(jobsTable.status, "queued"));
    for (const j of queued) void this.enqueue(j.id);
    const stuck = await db.select().from(jobsTable).where(eq(jobsTable.status, "running"));
    for (const j of stuck) {
      await db.update(jobsTable).set({ status: "queued", progress: 0 }).where(eq(jobsTable.id, j.id));
      void this.enqueue(j.id);
    }
  }

  private async run(jobId: string): Promise<void> {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    if (!job) return;
    const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, job.siteId)).limit(1);
    if (!site) { await this.failJob(job, "Site not found"); return; }

    try {
      if (job.kind === "analyze") {
        await this.runAnalysis(job, site.prompt, site.id, site.name, site.model ?? undefined);
      } else if (job.kind === "create" || job.kind === "edit" || job.kind === "retry") {
        await this.runBuild(job, site.id);
      } else {
        await this.failJob(job, `Unknown job kind: ${job.kind}`);
      }
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Job failed");
      await this.failJob(job, err instanceof Error ? err.message : "Unknown error");
    }
  }

  // ─── Analysis ────────────────────────────────────────────────────────────

  private async runAnalysis(
    job: Job,
    prompt: string,
    siteId: string,
    name: string,
    model?: string,
  ): Promise<void> {
    await db.update(jobsTable).set({ status: "running", message: ANALYSIS_STAGES[0].label, progress: 1 }).where(eq(jobsTable.id, job.id));
    await db.update(sitesTable).set({ status: "analyzing", progress: 1, message: ANALYSIS_STAGES[0].label, error: null, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
    await insertAgentMessage(job.userId, siteId, "log", "Starting analysis…", { stage: 0 });

    void streamNarration({
      userId: job.userId, siteId, intent: "thinking",
      context: `User wants: ${prompt.slice(0, 400)}. Tentative name: ${name}.`,
      fallback: "Reading your idea now — picking out the vibe, the pages, and a palette that fits.",
    });

    const analysisPromise = analyzeProjectAI(prompt, name, model);

    for (const stage of ANALYSIS_STAGES) {
      await sleep(stage.ms);
      await db.update(jobsTable).set({ progress: stage.progress, message: stage.label }).where(eq(jobsTable.id, job.id));
      await db.update(sitesTable).set({ progress: stage.progress, message: stage.label, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
      await insertAgentMessage(job.userId, siteId, "log", stage.label, { progress: stage.progress });
    }

    const analysis = await analysisPromise;
    const plan = buildPlan(analysis);
    const autoBuild = job.instructions === AUTO_BUILD_SENTINEL;

    await db.update(sitesTable).set({
      status: autoBuild ? "queued" : "awaiting_confirmation",
      progress: 100,
      message: autoBuild ? "Plan ready — starting build" : "Awaiting your confirmation",
      analysis, plan, updatedAt: new Date(),
    }).where(eq(sitesTable.id, siteId));

    await insertAgentMessage(job.userId, siteId, "analysis",
      `Detected: ${analysis.type} — "${analysis.intent}". ${analysis.features.length} features, ${analysis.pages.length} pages.`,
      { analysis });
    await insertAgentMessage(job.userId, siteId, "plan", planSummary(plan), { plan });
    await saveCheckpoint(siteId, "Analysis complete — plan ready");

    if (!autoBuild) {
      await insertAgentMessage(job.userId, siteId, "awaiting_confirmation",
        "Looks good? Reply 'build' (or tap Confirm) to start the build. I'll wait.", null);
    }

    await db.update(jobsTable).set({ status: "done", progress: 100, message: "Plan ready", finishedAt: new Date() }).where(eq(jobsTable.id, job.id));

    if (autoBuild) {
      const [next] = await db.insert(jobsTable).values({
        userId: job.userId, siteId, kind: "create", status: "queued", progress: 0, message: "Queued",
      }).returning();
      await jobQueue.enqueue(next.id);
    }
  }

  // ─── 7-Phase Build ───────────────────────────────────────────────────────

  private async runBuild(job: Job, siteId: string): Promise<void> {
    const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
    if (!site) throw new Error("Site missing");
    const siteModel = site.model ?? undefined;

    let plan = site.plan;
    if (!plan) {
      const analysis = site.analysis ?? (await analyzeProjectAI(site.prompt, site.name, siteModel));
      plan = buildPlan(analysis);
      await db.update(sitesTable).set({ analysis, plan }).where(eq(sitesTable.id, siteId));
    }

    // Mark running
    await db.update(jobsTable).set({ status: "running", message: "Starting pipeline…", progress: 1 }).where(eq(jobsTable.id, job.id));
    await db.update(sitesTable).set({ status: "building", progress: 1, message: "Starting pipeline…", error: null, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
    await insertAgentMessage(job.userId, siteId, "build_started",
      job.kind === "edit" ? "Applying your edits…" : "Confirmed. Starting the 7-phase build pipeline.", null);

    // ── EDIT short-circuit ──────────────────────────────────────────────────
    if (job.kind === "edit" && job.instructions && site.files) {
      await setProgress(job.id, siteId, 20, "Applying edits…");
      const out = await editProjectAI(site.files, site.name, job.instructions, siteModel);
      const userSecrets = await getDecryptedSecrets(job.userId);
      const finalFiles = injectSecretsIntoFiles(out.files, userSecrets);
      await this.finalize(job, siteId, site, finalFiles, out.coverColor, plan, true);
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1 — Research design inspiration  (2 → 14%)
    // ═══════════════════════════════════════════════════════════════════════
    const ph1 = PIPELINE_STEPS[0];
    await setProgress(job.id, siteId, ph1.pctStart, `⟳ Step 1/7: ${ph1.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ Step 1/7: ${ph1.label}`, { phase: 1, progress: ph1.pctStart });

    void streamNarration({
      userId: job.userId, siteId, intent: "thinking",
      context: `Researching design inspiration for "${site.name}". Prompt: ${site.prompt.slice(0, 300)}.`,
      fallback: "Pulling design references — studying what makes great sites in this space tick.",
    });

    let research: ResearchBrief;
    try {
      research = await researchInspirationAI(site.prompt, site.analysis ?? { type: "website", intent: site.name, audience: null, features: [], pages: ["index"], styleHints: [] }, siteModel);
    } catch {
      research = {
        mood: "Modern and bold", palette: { background: "#0a0e14", surface: "#141920", primary: "#00ffc2", secondary: "#58a6ff", text: "#e6edf3", muted: "#8b949e" },
        typography: "Display: clamp(3rem,7vw,6rem) 800-weight. Body: 1.1rem Inter.", layout: "Full-bleed hero, sticky nav, card grid",
        competitors: ["vercel.com", "linear.app"], heroImagePrompt: `${site.name} hero image`, uniqueTwist: "Animated gradient hero", techStack: ["Chart.js 4", "Alpine.js 3", "Lucide icons"],
      };
    }

    await setProgress(job.id, siteId, ph1.pctEnd, `✓ Step 1/7: ${ph1.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✓ Step 1/7: ${ph1.label}\n   Mood: ${research.mood}\n   Stack: ${research.techStack.join(", ")}`,
      { phase: 1, progress: ph1.pctEnd, research });
    await saveCheckpoint(siteId, "Research complete", undefined, ph1.pctEnd);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2 — Parallel website build  (14 → 65%)
    // ═══════════════════════════════════════════════════════════════════════
    const ph2 = PIPELINE_STEPS[1];
    await setProgress(job.id, siteId, ph2.pctStart, `⟳ Step 2/7: ${ph2.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ Step 2/7: ${ph2.label}\n   Building ${plan.pages.length} pages in parallel…`,
      { phase: 2, progress: ph2.pctStart });

    void streamNarration({
      userId: job.userId, siteId, intent: "building",
      context: `Building "${site.name}" with ${plan.pages.length} pages in parallel. Style: ${research.mood}. Stack: ${research.techStack.join(", ")}.`,
      fallback: "Generating all pages simultaneously — shared CSS first, then every page in parallel.",
    });

    await db.update(sitesTable).set({ files: {}, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
    await saveCheckpoint(siteId, `Build started · ${plan.pages.length} pages · ${siteModel ?? "default model"}`, {}, ph2.pctStart);

    const availableSecretNames = Object.keys(await getDecryptedSecrets(job.userId));
    const promptWithSecrets = availableSecretNames.length > 0
      ? `${site.prompt}\n\n[Available secrets — reference as \${NAME}]: ${availableSecretNames.join(", ")}`
      : site.prompt;

    let lastReportedFile: string | null = null;
    const seenFiles = new Set<string>();
    const buildLog = new AgentBuildLog();

    const buildOut = await buildProjectAIParallel(
      plan, site.name, promptWithSecrets, research,
      async ({ coverColor, files, currentFile, bytes }) => {
        const fileCount = Object.keys(files).length;
        const byteProgress = Math.min(Math.round(bytes / 400), 45);
        const pct = Math.min(ph2.pctStart + byteProgress, ph2.pctEnd - 2);
        const label = currentFile ? streamLabel(currentFile) : "Streaming bytes…";
        await db.update(sitesTable).set({ status: "building", files: files as Record<string, string>, coverColor, progress: pct, message: label, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
        await db.update(jobsTable).set({ progress: pct, message: label }).where(eq(jobsTable.id, job.id));
        siteEventBus.emitSite({ type: "site_updated", siteId });
        siteEventBus.emitSite({ type: "file_progress", siteId, currentFile, bytes });
        if (currentFile && currentFile !== lastReportedFile) {
          lastReportedFile = currentFile;
          if (!seenFiles.has(currentFile)) {
            seenFiles.add(currentFile);
            void fileCount;
            buildLog.log(2, `File ready`, currentFile);
            await insertAgentMessage(job.userId, siteId, "build_progress", streamLabel(currentFile), { progress: pct, file: currentFile });
          }
        }
      },
      siteModel,
      // Quality gate callback — surfaced in chat
      async (report: BuildQualityReport) => {
        buildLog.log(2, report.passed ? "Quality gate PASSED" : "Quality gate FAILED", report.summary);
        if (!report.passed) {
          const issueLines = report.issues
            .filter(i => i.severity === "critical" || i.severity === "high")
            .slice(0, 5)
            .map(i => `   ✗ [${i.severity.toUpperCase()}] ${i.file}: ${i.detail}`)
            .join("\n");
          await insertAgentMessage(job.userId, siteId, "build_progress",
            `⚠ Quality gate — score ${report.score}/100\n${issueLines}\n   → Retrying weak pages…`,
            { qualityReport: report });
        } else {
          await insertAgentMessage(job.userId, siteId, "build_progress",
            `✓ Quality gate — score ${report.score}/100 · ${(report.totalBytes / 1024).toFixed(1)} KB · ${Object.keys(buildOut?.files ?? {}).length || "?"} files`,
            { qualityReport: report });
        }
      },
    );

    await setProgress(job.id, siteId, ph2.pctEnd, `✓ Step 2/7: ${ph2.label}`);
    const builtFileCount = Object.keys(buildOut.files).length;
    const builtBytes = Object.values(buildOut.files).reduce((s, v) => s + v.length, 0);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✓ Step 2/7: ${ph2.label}\n   ${builtFileCount} files · ${(builtBytes / 1024).toFixed(1)} KB`,
      { phase: 2, progress: ph2.pctEnd, fileCount: builtFileCount, bytes: builtBytes });
    await saveCheckpoint(siteId, `Build complete · ${builtFileCount} files · ${(builtBytes / 1024).toFixed(1)} KB`, buildOut.files, ph2.pctEnd);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3 — Quality audit  (65 → 73%)
    // ═══════════════════════════════════════════════════════════════════════
    const ph3 = PIPELINE_STEPS[2];
    await setProgress(job.id, siteId, ph3.pctStart, `⟳ Step 3/7: ${ph3.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ Step 3/7: ${ph3.label}`, { phase: 3, progress: ph3.pctStart });

    let issues: AuditIssue[] = [];
    try {
      issues = await auditProjectAI(buildOut.files, plan, siteModel);
    } catch (err) {
      logger.warn({ err: String(err) }, "Audit failed (non-fatal)");
    }

    await setProgress(job.id, siteId, ph3.pctEnd, `✓ Step 3/7: ${ph3.label}`, "building");
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✓ Step 3/7: ${ph3.label}\n   Found ${issues.length} issue${issues.length !== 1 ? "s" : ""}`,
      { phase: 3, progress: ph3.pctEnd, issueCount: issues.length });

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4 — Self-review / log issues  (73 → 78%)
    // ═══════════════════════════════════════════════════════════════════════
    const ph4 = PIPELINE_STEPS[3];
    await setProgress(job.id, siteId, ph4.pctStart, `⟳ Step 4/7: ${ph4.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ Step 4/7: ${ph4.label}`, { phase: 4, progress: ph4.pctStart });

    if (issues.length > 0) {
      const issueLines = issues
        .map((i, n) => `   ${n + 1}. [${i.severity.toUpperCase()}] ${i.file}: ${i.issue}`)
        .join("\n");
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `QA Report:\n${issueLines}`,
        { phase: 4, issues });
    }

    await setProgress(job.id, siteId, ph4.pctEnd, `✓ Step 4/7: ${ph4.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✓ Step 4/7: ${ph4.label}\n   ${issues.length > 0 ? `${issues.length} items queued for auto-fix` : "No issues found — site looks great"}`,
      { phase: 4, progress: ph4.pctEnd });

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5 — Auto-fix  (78 → 88%)
    // ═══════════════════════════════════════════════════════════════════════
    const ph5 = PIPELINE_STEPS[4];
    let finalBuildFiles = buildOut.files;

    if (issues.length > 0) {
      await setProgress(job.id, siteId, ph5.pctStart, `⟳ Step 5/7: ${ph5.label}`);
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `✦ Step 5/7: Fixing ${issues.length} issue${issues.length !== 1 ? "s" : ""}…`,
        { phase: 5, progress: ph5.pctStart });
      try {
        finalBuildFiles = await autoFixProjectAI(buildOut.files, issues, siteModel);
        const fixedCount = Object.keys(finalBuildFiles).filter(
          (k) => finalBuildFiles[k] !== buildOut.files[k]
        ).length;
        await setProgress(job.id, siteId, ph5.pctEnd, `✓ Step 5/7: ${ph5.label}`);
        await insertAgentMessage(job.userId, siteId, "build_progress",
          `✓ Step 5/7: ${ph5.label}\n   Patched ${fixedCount} file${fixedCount !== 1 ? "s" : ""}`,
          { phase: 5, progress: ph5.pctEnd });
        await saveCheckpoint(siteId, `Auto-fix complete · ${fixedCount} files patched`, finalBuildFiles, ph5.pctEnd);
      } catch (err) {
        logger.warn({ err: String(err) }, "Auto-fix failed (non-fatal)");
        await setProgress(job.id, siteId, ph5.pctEnd, `↷ Step 5/7: Fix skipped`);
      }
    } else {
      await setProgress(job.id, siteId, ph5.pctEnd, `✓ Step 5/7: No fixes needed`);
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `✓ Step 5/7: ${ph5.label} — nothing to fix`, { phase: 5, progress: ph5.pctEnd });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6 — Hero image  (88 → 92%)
    // ═══════════════════════════════════════════════════════════════════════
    const ph6 = PIPELINE_STEPS[5];
    await setProgress(job.id, siteId, ph6.pctStart, `⟳ Step 6/7: ${ph6.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ Step 6/7: ${ph6.label}`,
      { phase: 6, progress: ph6.pctStart });

    // Inject a theme-consistent hero image into index.html via picsum seed
    finalBuildFiles = injectHeroImage(finalBuildFiles, research, site.name);

    await setProgress(job.id, siteId, ph6.pctEnd, `✓ Step 6/7: ${ph6.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✓ Step 6/7: ${ph6.label}\n   Hero image embedded`,
      { phase: 6, progress: ph6.pctEnd });

    // ═══════════════════════════════════════════════════════════════════════
    // Inject secrets & finalize
    // ═══════════════════════════════════════════════════════════════════════
    const userSecrets = await getDecryptedSecrets(job.userId);
    const finalFiles = injectSecretsIntoFiles(finalBuildFiles, userSecrets);

    await this.finalize(job, siteId, site, finalFiles, buildOut.coverColor, plan, false);
  }

  // ─── Finalize (upload + mark done) ──────────────────────────────────────

  private async finalize(
    job: Job,
    siteId: string,
    site: { name: string; puterSubdomain?: string | null; puterRootDir?: string | null },
    finalFiles: SiteFiles,
    coverColor: string,
    plan: SitePlan,
    isEdit: boolean,
  ): Promise<void> {
    const ph7 = PIPELINE_STEPS[6];
    await setProgress(job.id, siteId, ph7.pctStart, `⟳ Step 7/7: ${ph7.label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ Step 7/7: ${ph7.label}`,
      { phase: 7, progress: ph7.pctStart });

    await db.update(sitesTable).set({
      status: "building", progress: ph7.pctStart,
      message: "Uploading to Puter cloud hosting…",
      files: finalFiles, coverColor,
      plan: isEdit ? { ...plan, notes: [...plan.notes, `Edit applied: ${new Date().toISOString()}`] } : plan,
      puterStatus: PUTER_CONFIGURED ? "uploading" : null,
      puterError: null, updatedAt: new Date(),
    }).where(eq(sitesTable.id, siteId));
    siteEventBus.emitSite({ type: "site_updated", siteId });

    let puterPublicUrl: string | null = null;
    let puterSubdomain: string | null = site.puterSubdomain ?? null;
    let puterRootDir: string | null = site.puterRootDir ?? null;
    let puterStatus: "hosted" | "failed" | null = null;
    let puterError: string | null = null;

    if (PUTER_CONFIGURED) {
      const totalFiles = Object.keys(finalFiles).length;
      let attempt = 0;
      const MAX_ATTEMPTS = 3;
      while (true) {
        attempt++;
        try {
          const uploaded = await uploadSite({
            userId: job.userId, siteId, files: finalFiles, subdomain: puterSubdomain,
            opts: {
              concurrency: 6,
              onFile: async (rel, idx) => {
                const pct = Math.min(98, ph7.pctStart + Math.round((idx / Math.max(totalFiles, 1)) * (98 - ph7.pctStart)));
                await db.update(sitesTable).set({ progress: pct, message: `Uploading ${rel} (${idx}/${totalFiles})`, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
                siteEventBus.emitSite({ type: "site_updated", siteId });
              },
            },
          });
          puterPublicUrl = uploaded.publicUrl;
          puterSubdomain = uploaded.subdomain;
          puterRootDir = uploaded.rootDir;
          puterStatus = "hosted";
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ err, attempt, siteId }, "Puter upload attempt failed");
          if (attempt >= MAX_ATTEMPTS) { puterStatus = "failed"; puterError = msg; break; }
          await sleep(750 * attempt);
        }
      }
    } else {
      puterStatus = "failed";
      puterError = "PUTER_USERNAME / PUTER_PASSWORD not configured";
    }

    const totalFiles = Object.keys(finalFiles).length;
    const totalBytes = Object.values(finalFiles).reduce((s, v) => s + v.length, 0);

    await db.update(sitesTable).set({
      status: "ready", progress: 100,
      message: puterStatus === "hosted" ? "Live on Puter" : "Ready",
      puterStatus, puterError, puterPublicUrl, puterSubdomain, puterRootDir,
      updatedAt: new Date(),
    }).where(eq(sitesTable.id, siteId));
    await db.update(jobsTable).set({ status: "done", progress: 100, message: "Done", finishedAt: new Date() }).where(eq(jobsTable.id, job.id));

    await saveCheckpoint(siteId,
      isEdit ? `Edit complete · ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
        : `Build complete · ${totalFiles} files · ${(totalBytes / 1024).toFixed(1)} KB`,
      finalFiles, 100);

    const stepSummary = isEdit
      ? `Applied edits to ${totalFiles} files`
      : `▰▰▰▰▰▰▰▰▰▰▰▰▰▰  100%\n${puterStatus === "hosted" ? "Live on Puter" : "Ready"}\n\n📄 ${totalFiles} files written\n${Object.keys(finalFiles).slice(0, 6).map(f => `  ✓ ${f}`).join("\n")}\n\n📊 Total size: ${(totalBytes / 1024).toFixed(1)} KB`;

    if (puterStatus === "hosted" && puterPublicUrl) {
      await insertAgentMessage(job.userId, siteId, "build_done",
        `✓ Step 7/7: ${ph7.label}\n\n${stepSummary}\n\n🎉 ${site.name} is LIVE!\n🌐 ${puterPublicUrl}`,
        { files: Object.keys(finalFiles), publicUrl: puterPublicUrl, totalBytes, phase: 7 });
    } else {
      await insertAgentMessage(job.userId, siteId, "build_done",
        `✓ Step 7/7: Build complete\n\n${stepSummary}`,
        { files: Object.keys(finalFiles), puterStatus, puterError, totalBytes, phase: 7 });
    }

    siteEventBus.emitSite({ type: "site_updated", siteId });
    siteEventBus.emitSite({ type: "site_ready", siteId, userId: job.userId, siteName: site.name, publicUrl: puterPublicUrl });

    void streamNarration({
      userId: job.userId, siteId, intent: "done",
      context: `Just shipped "${site.name}". ${totalFiles} files, ${(totalBytes / 1024).toFixed(1)} KB. Files: ${Object.keys(finalFiles).slice(0, 5).join(", ")}.`,
      fallback: "Shipped it. All 7 phases complete — tap Preview to see your site live.",
    });
  }

  private async failJob(job: Job, message: string): Promise<void> {
    await db.update(jobsTable).set({ status: "failed", message, finishedAt: new Date() }).where(eq(jobsTable.id, job.id));
    await db.update(sitesTable).set({ status: "failed", error: message, message, updatedAt: new Date() }).where(eq(jobsTable.id, job.siteId));
    await insertAgentMessage(job.userId, job.siteId, "build_failed", `Build failed: ${message}`, null);
  }
}

// ---------------------------------------------------------------------------
// Hero image injection
// ---------------------------------------------------------------------------

function injectHeroImage(files: SiteFiles, research: ResearchBrief, siteName: string): SiteFiles {
  const result = { ...files };
  const indexHtml = result["index.html"];
  if (!indexHtml) return result;

  // Generate a deterministic seed from site name for picsum
  const seed = encodeURIComponent(siteName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
  const heroUrl = `https://picsum.photos/seed/${seed}-hero/1600/900`;
  const heroAlt = research.heroImagePrompt.slice(0, 120);

  // Replace the first picsum.photos image with our themed hero (if not already seeded)
  const picsumPattern = /https:\/\/picsum\.photos\/(?:seed\/[^"'\s]+|\d+\/\d+)/;
  if (picsumPattern.test(indexHtml)) {
    result["index.html"] = indexHtml.replace(picsumPattern, heroUrl);
  }

  // Also inject Open Graph image tag if missing
  if (!indexHtml.includes('property="og:image"') && !indexHtml.includes("og:image")) {
    result["index.html"] = result["index.html"].replace(
      /<\/head>/i,
      `  <meta property="og:image" content="${heroUrl}">\n  <meta property="og:image:alt" content="${heroAlt}">\n</head>`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function planSummary(plan: SitePlan): string {
  const lines: string[] = [`Plan: ${plan.summary}`, "", "Pages:"];
  for (const p of plan.pages) lines.push(`  • ${p.title} — ${p.purpose}`);
  lines.push("", `Style: ${plan.styles.palette} (${plan.styles.mood})`);
  if (plan.features.length > 0) lines.push(`Features: ${plan.features.join(", ")}`);
  return lines.join("\n");
}

async function insertAgentMessage(
  userId: string,
  siteId: string,
  kind: "text" | "analysis" | "plan" | "awaiting_confirmation" | "log" | "build_started" | "build_progress" | "build_done" | "build_failed",
  content: string,
  data: Record<string, unknown> | null,
): Promise<void> {
  const [row] = await db.insert(messagesTable).values({ userId, siteId, role: "agent", kind, content, data }).returning();
  siteEventBus.emitSite({ type: "message_added", siteId, messageId: row.id });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function streamLabel(path: string): string {
  if (path.endsWith(".css")) return `Painting styles — ${path}`;
  if (path.endsWith(".js")) return `Wiring interactions — ${path}`;
  if (path === "index.html") return "Streaming home page";
  if (path.endsWith(".html")) return `Streaming ${path.replace(/\.html$/, "")} page`;
  return `Streaming ${path}`;
}

export { analyzeProject };
export const jobQueue = new JobQueue();

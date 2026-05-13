import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { clawPhase } from "./openclaw";

import {
  db,
  jobsTable,
  messagesTable,
  sitesTable,
  usersTable,
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
  AgentUnavailableError,
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

// ---------------------------------------------------------------------------
// Expo Push Notifications
// ---------------------------------------------------------------------------

async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    const [user] = await db
      .select({ expoPushToken: usersTable.expoPushToken })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const token = (user as { expoPushToken?: string | null } | undefined)?.expoPushToken;
    if (!token) return;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: token, title, body, data, sound: "default", priority: "high" }),
    });
  } catch (err) {
    logger.warn({ err }, "sendPushNotification failed (non-fatal)");
  }
}

const MAX_CONCURRENCY = 3;
const AUTO_BUILD_SENTINEL = "__AUTO_BUILD__";

// ---------------------------------------------------------------------------
// Dynamic phase labels — WebForge Core reasons about what phases are needed
// per project rather than following a fixed pipeline. Labels are generated
// contextually so every build feels architecturally intentional.
// ---------------------------------------------------------------------------

function getPhaseLabel(phase: "research" | "build" | "audit" | "review" | "fix" | "render" | "deploy", ctx: BuildContext): string {
  switch (phase) {
    case "research":
      return ctx.isGame
        ? "🎮 WebForge — analyzing game mechanics and interactive requirements"
        : ctx.isSimple
          ? "🔍 WebForge — reading brief and reasoning about architecture"
          : "🔍 WebForge — deep project analysis: domain, stack, UX patterns";
    case "build":
      return ctx.isGame
        ? "⚙️  WebForge — engineering game loop, physics, and AI opponents"
        : ctx.isSimple
          ? "⚙️  WebForge — building focused, intentional output"
          : `⚙️  WebForge — adaptive parallel build for ${ctx.pageCount}-surface project`;
    case "audit":
      return "🔬 WebForge — quality reasoning: SEO, accessibility, mobile, performance";
    case "review":
      return "🧠 WebForge — autonomous self-critique and architectural review";
    case "fix":
      return "🔧 WebForge — self-correcting detected issues";
    case "render":
      return "🖼️  WebForge — finalizing visual identity";
    case "deploy":
      return "🚀 WebForge — deploying engineered output to live URL";
  }
}

// Dynamic progress ranges — computed per-build based on project complexity
function getPhaseRange(phase: "research" | "build" | "audit" | "review" | "fix" | "render" | "deploy", ctx: BuildContext): { pctStart: number; pctEnd: number } {
  if (ctx.isGame) {
    return {
      research: { pctStart: 2,  pctEnd: 8  },
      build:    { pctStart: 8,  pctEnd: 78 },
      audit:    { pctStart: 78, pctEnd: 78 },
      review:   { pctStart: 78, pctEnd: 85 },
      fix:      { pctStart: 85, pctEnd: 90 },
      render:   { pctStart: 90, pctEnd: 93 },
      deploy:   { pctStart: 93, pctEnd: 100 },
    }[phase];
  }
  if (ctx.isSimple) {
    return {
      research: { pctStart: 2,  pctEnd: 10 },
      build:    { pctStart: 10, pctEnd: 72 },
      audit:    { pctStart: 72, pctEnd: 78 },
      review:   { pctStart: 78, pctEnd: 82 },
      fix:      { pctStart: 82, pctEnd: 88 },
      render:   { pctStart: 88, pctEnd: 92 },
      deploy:   { pctStart: 92, pctEnd: 100 },
    }[phase];
  }
  return {
    research: { pctStart: 2,  pctEnd: 14 },
    build:    { pctStart: 14, pctEnd: 65 },
    audit:    { pctStart: 65, pctEnd: 73 },
    review:   { pctStart: 73, pctEnd: 78 },
    fix:      { pctStart: 78, pctEnd: 88 },
    render:   { pctStart: 88, pctEnd: 92 },
    deploy:   { pctStart: 92, pctEnd: 100 },
  }[phase];
}

// ---------------------------------------------------------------------------
// Context detection — drives adaptive build behaviour
// ---------------------------------------------------------------------------

interface BuildContext {
  isGame: boolean;          // Canvas/interactive game (skip research, skip audit)
  isSimple: boolean;        // 1–2 page site (skip audit/fix when score good)
  isEdit: boolean;          // User is editing an existing site
  needsResearch: boolean;   // Whether design research adds value
  needsAudit: boolean;      // Whether SEO/a11y audit is worthwhile
  pageCount: number;
}

function detectBuildContext(prompt: string, plan: SitePlan | null, jobKind: string): BuildContext {
  const p = prompt.toLowerCase();
  const isEdit = jobKind === "edit";
  const pageCount = plan?.pages.length ?? 1;

  const gameKeywords = [
    "game", "chess", "tetris", "snake", "platformer", "fifa", "shooter",
    "puzzle", "arcade", "canvas", "sprite", "player", "level", "score",
    "jump", "shoot", "enemy", "boss fight", "multiplayer", "2d", "3d game",
  ];
  const isGame = gameKeywords.some((kw) => p.includes(kw));

  const isSimple = !isGame && pageCount <= 2;

  return {
    isGame,
    isSimple,
    isEdit,
    needsResearch: !isGame && !isEdit,
    needsAudit: !isGame && !isEdit && pageCount >= 2,
    pageCount,
  };
}

const ANALYSIS_STAGES = [
  { progress: 12, label: "🧠 WebForge — analyzing project intent and domain type",      ms: 250 },
  { progress: 28, label: "🧠 WebForge — detecting architecture, stack, and tradeoffs", ms: 250 },
  { progress: 50, label: "🧠 WebForge — reasoning about unique engineering approach",  ms: 250 },
  { progress: 75, label: "🧠 WebForge — finalizing adaptive architecture plan",        ms: 250 },
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

    // Jobs that were mid-flight when the server restarted: mark them failed
    // (not re-queued from scratch) so the user can decide to retry explicitly.
    // Re-queueing from progress 0 would blow away all the work already done and
    // show a confusing "restart" to the user.
    const stuck = await db.select().from(jobsTable).where(eq(jobsTable.status, "running"));
    for (const j of stuck) {
      await db.update(jobsTable).set({
        status: "failed",
        message: "Server restarted mid-build — tap Retry to rebuild",
        finishedAt: new Date(),
      }).where(eq(jobsTable.id, j.id));
      await db.update(sitesTable).set({
        status: "failed",
        error: "Server restarted mid-build",
        message: "Server restarted — tap Retry to rebuild",
        updatedAt: new Date(),
      }).where(eq(sitesTable.id, j.siteId));
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
      const isOffline = err instanceof AgentUnavailableError;
      const isQuota = isOffline && (err as AgentUnavailableError).isQuotaError;
      await this.failJob(job, isQuota ? "quota_exhausted" : isOffline ? "agent_offline" : (err instanceof Error ? err.message : "Unknown error"));
      if (isOffline && !isQuota) {
        // Auto-retry after 3 minutes — transient outages only (not quota exhaustion)
        void this.scheduleRetry(job, 3 * 60_000);
      }
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
    clawPhase("UNDERSTAND", name);
    await db.update(jobsTable).set({ status: "running", message: ANALYSIS_STAGES[0].label, progress: 1 }).where(eq(jobsTable.id, job.id));
    await db.update(sitesTable).set({ status: "analyzing", progress: 1, message: ANALYSIS_STAGES[0].label, error: null, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
    await insertAgentMessage(job.userId, siteId, "log", "🧠 WebForge Core initialising — analyzing project intent and domain type…", { stage: 0 });

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

    const typeLabel = analysis.type === "game" ? "🎮 game" : analysis.type === "art" ? "🎨 art" : analysis.type === "music" ? "🎵 music" : analysis.type === "tool" ? "🛠️ tool" : analysis.type === "saas" ? "🚀 SaaS" : analysis.type === "portfolio" ? "💼 portfolio" : analysis.type === "ecommerce" ? "🛒 store" : analysis.type === "restaurant" ? "🍽️ restaurant" : `🌐 ${analysis.type}`;
    const analysisMsg = [
      `${typeLabel} detected — ${analysis.intent}`,
      analysis.features.length > 0 ? `\nFeatures: ${analysis.features.slice(0, 4).join(", ")}` : "",
      analysis.pages.length === 1 ? "\nThis is a single-file build — everything goes into one powerful page." : `\nPages planned: ${analysis.pages.join(", ")}`,
    ].join("").trim();
    await insertAgentMessage(job.userId, siteId, "analysis", analysisMsg, { analysis });
    await insertAgentMessage(job.userId, siteId, "plan", planSummary(plan), { plan });
    await saveCheckpoint(siteId, "Analysis complete — plan ready");

    // ── CLARIFY SKILL — ask targeted questions for vague or short prompts ──
    // Only shown when user will manually confirm (not auto-build from Telegram)
    if (!autoBuild) {
      const clarifyQuestions = generateClarifyingQuestions(prompt, analysis);
      if (clarifyQuestions.length > 0) {
        const clarifyMsg = [
          "Before I start building, a few quick questions to get this exactly right:",
          ...clarifyQuestions.map((q, i) => `\n${i + 1}. ${q}`),
          "\n\nFeel free to answer any or all — or just tap **Confirm** to build with the defaults.",
        ].join("");
        await insertAgentMessage(job.userId, siteId, "log", clarifyMsg, { clarifyQuestions });
      }
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

  // ─── Adaptive Build Pipeline ─────────────────────────────────────────────

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

    // WebForge Core detects context to reason about what approach this project requires
    const ctx = detectBuildContext(site.prompt, plan, job.kind);

    const startMsg = job.kind === "edit"
      ? "🔧 WebForge Core — applying your edits with architectural awareness…"
      : ctx.isGame
        ? "🎮 WebForge Core — reasoning about game architecture, going straight to engine code."
        : ctx.isSimple
          ? "⚡ WebForge Core — reasoning about this project, building intentionally."
          : `⚡ WebForge Core — analyzing ${ctx.pageCount}-surface project, adapting architecture dynamically.`;

    // Mark running
    clawPhase("BUILD", site.name);
    await db.update(jobsTable).set({ status: "running", message: "⚡ WebForge Core initialising…", progress: 1 }).where(eq(jobsTable.id, job.id));
    await db.update(sitesTable).set({ status: "building", progress: 1, message: "⚡ WebForge Core initialising…", error: null, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
    await insertAgentMessage(job.userId, siteId, "build_started", startMsg, null);

    // ── RETRY short-circuit (resume partial build → skip AI, go straight to finalize) ──
    if (job.kind === "retry") {
      const existingFiles = (site.files ?? {}) as SiteFiles;
      const fileCount = Object.keys(existingFiles).length;
      if (fileCount >= 3) {
        logger.info({ siteId, fileCount }, "Retry with existing files — skipping to finalize");
        await db.update(jobsTable).set({ status: "running", message: "Resuming…", progress: 75 }).where(eq(jobsTable.id, job.id));
        await db.update(sitesTable).set({ status: "building", progress: 75, message: "Resuming build…", error: null, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
        await insertAgentMessage(job.userId, siteId, "build_progress",
          `⚡ Resume — ${fileCount} files already built. Skipping straight to deploy…`,
          { phase: 7, progress: 75 });
        const userSecrets = await getDecryptedSecrets(job.userId);
        const finalFiles = injectSecretsIntoFiles(existingFiles, userSecrets);
        await this.finalize(job, siteId, site, finalFiles, site.coverColor ?? "#00FFC2", plan, false);
        return;
      }
    }

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
    // PHASE 1 — Research / analysis (range determined dynamically per project)
    // WebForge Core reasons about whether research adds value for this project
    // ═══════════════════════════════════════════════════════════════════════
    const ph1Label = getPhaseLabel("research", ctx);
    const ph1Range = getPhaseRange("research", ctx);
    const GAME_FALLBACK_RESEARCH: ResearchBrief = {
      mood: "Dark cinematic game aesthetic", palette: { background: "#0a0a0f", surface: "#12121a", primary: "#00ffc2", secondary: "#ff6b6b", text: "#e6edf3", muted: "#8b949e" },
      typography: "Display: clamp(2rem,5vw,4rem) 900-weight monospace. Body: 1rem system-ui.", layout: "Full-screen canvas, minimal UI overlay, score/stats panel",
      competitors: [], heroImagePrompt: `${site.name} game screenshot`, uniqueTwist: "Immersive fullscreen gameplay", techStack: ["HTML5 Canvas", "Web Audio API", "RequestAnimationFrame"],
    };
    let research: ResearchBrief;

    if (ctx.needsResearch) {
      await setProgress(job.id, siteId, ph1Range.pctStart, `⟳ ${ph1Label}`);
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `✦ ${ph1Label}`, { phase: 1, progress: ph1Range.pctStart });
      void streamNarration({
        userId: job.userId, siteId, intent: "thinking",
        context: `Researching design inspiration for "${site.name}". Prompt: ${site.prompt.slice(0, 300)}.`,
        fallback: "Pulling design references — studying what makes great sites in this space tick.",
      });
      try {
        research = await researchInspirationAI(site.prompt, site.analysis ?? { type: "website", intent: site.name, audience: null, features: [], pages: ["index"], styleHints: [] }, siteModel);
      } catch {
        research = {
          mood: "Modern and bold", palette: { background: "#0a0e14", surface: "#141920", primary: "#00ffc2", secondary: "#58a6ff", text: "#e6edf3", muted: "#8b949e" },
          typography: "Display: clamp(3rem,7vw,6rem) 800-weight. Body: 1.1rem Inter.", layout: "Full-bleed hero, sticky nav, card grid",
          competitors: ["vercel.com", "linear.app"], heroImagePrompt: `${site.name} hero image`, uniqueTwist: "Animated gradient hero", techStack: ["Chart.js 4", "Alpine.js 3", "Lucide icons"],
        };
      }
      await setProgress(job.id, siteId, ph1Range.pctEnd, `✓ ${ph1Label}`);
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `✓ ${ph1Label}\n   Mood: ${research.mood}\n   Stack: ${research.techStack.join(", ")}`,
        { phase: 1, progress: ph1Range.pctEnd, research });
      await saveCheckpoint(siteId, "Research complete", undefined, ph1Range.pctEnd);
    } else {
      // Games / edits: skip research, use targeted fallback
      research = GAME_FALLBACK_RESEARCH;
      await setProgress(job.id, siteId, ph1Range.pctEnd, ctx.isGame ? "🎮 WebForge — reasoning about game architecture" : "⚡ WebForge — reasoning about architecture");
      await insertAgentMessage(job.userId, siteId, "build_progress",
        ctx.isGame ? "🎮 Game detected — WebForge reasoning about engine architecture, going straight to code." : "⚡ WebForge reasoning about architecture for this project type.",
        { phase: 1, progress: ph1Range.pctEnd });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2 — Adaptive build (range and label determined by project context)
    // WebForge Core engineers the output uniquely for each project type
    // ═══════════════════════════════════════════════════════════════════════
    const ph2Label = getPhaseLabel("build", ctx);
    const ph2Range = getPhaseRange("build", ctx);
    await setProgress(job.id, siteId, ph2Range.pctStart, `⟳ ${ph2Label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ ${ph2Label}\n   Building ${plan.pages.length} surface${plan.pages.length !== 1 ? "s" : ""}…`,
      { phase: 2, progress: ph2Range.pctStart });
    void streamNarration({
      userId: job.userId, siteId, intent: "building",
      context: `Building "${site.name}" (${ctx.isGame ? "game" : `${plan.pages.length} pages`}). Style: ${research.mood}. Stack: ${research.techStack.join(", ")}.`,
      fallback: ctx.isGame ? "Writing game engine, physics, and gameplay logic now." : "Generating pages simultaneously — shared CSS first, then every page in parallel.",
    });

    await db.update(sitesTable).set({ files: {}, updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
    await saveCheckpoint(siteId, `Build started · ${plan.pages.length} pages · ${siteModel ?? "default model"}`, {}, ph2Range.pctStart);

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
        const pct = Math.min(ph2Range.pctStart + byteProgress, ph2Range.pctEnd - 2);
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

    await setProgress(job.id, siteId, ph2Range.pctEnd, `✓ ${ph2Label}`);
    const builtFileCount = Object.keys(buildOut.files).length;
    const builtBytes = Object.values(buildOut.files).reduce((s, v) => s + v.length, 0);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✓ ${ph2Label}\n   ${builtFileCount} files · ${(builtBytes / 1024).toFixed(1)} KB`,
      { phase: 2, progress: ph2Range.pctEnd, fileCount: builtFileCount, bytes: builtBytes });
    await saveCheckpoint(siteId, `Build complete · ${builtFileCount} files · ${(builtBytes / 1024).toFixed(1)} KB`, buildOut.files, ph2Range.pctEnd);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASES 3-5 — Audit + Review + Fix (dynamically applied)
    // WebForge Core decides whether these add value for this project type.
    // Games and focused builds skip web audits (not applicable to canvas/engine).
    // ═══════════════════════════════════════════════════════════════════════
    const ph3Label = getPhaseLabel("audit", ctx);
    const ph3Range = getPhaseRange("audit", ctx);
    const ph4Label = getPhaseLabel("review", ctx);
    const ph4Range = getPhaseRange("review", ctx);
    const ph5Label = getPhaseLabel("fix", ctx);
    const ph5Range = getPhaseRange("fix", ctx);
    let finalBuildFiles = buildOut.files;

    if (ctx.needsAudit) {
      // Phase 3 — Audit
      await setProgress(job.id, siteId, ph3Range.pctStart, `⟳ ${ph3Label}`);
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `✦ ${ph3Label}`, { phase: 3, progress: ph3Range.pctStart });

      let issues: AuditIssue[] = [];
      try {
        issues = await auditProjectAI(buildOut.files, plan, siteModel);
      } catch (err) {
        logger.warn({ err: String(err) }, "Audit failed (non-fatal)");
      }

      await setProgress(job.id, siteId, ph3Range.pctEnd, `✓ ${ph3Label}`, "building");
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `✓ ${ph3Label}\n   Found ${issues.length} issue${issues.length !== 1 ? "s" : ""}`,
        { phase: 3, progress: ph3Range.pctEnd, issueCount: issues.length });

      // Phase 4 — Review
      await setProgress(job.id, siteId, ph4Range.pctStart, `⟳ ${ph4Label}`);
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `✦ ${ph4Label}`, { phase: 4, progress: ph4Range.pctStart });
      if (issues.length > 0) {
        const issueLines = issues
          .map((i, n) => `   ${n + 1}. [${i.severity.toUpperCase()}] ${i.file}: ${i.issue}`)
          .join("\n");
        await insertAgentMessage(job.userId, siteId, "build_progress",
          `QA Report:\n${issueLines}`, { phase: 4, issues });
      }
      await setProgress(job.id, siteId, ph4Range.pctEnd, `✓ ${ph4Label}`);
      await insertAgentMessage(job.userId, siteId, "build_progress",
        `✓ ${ph4Label}\n   ${issues.length > 0 ? `${issues.length} items queued for auto-fix` : "No issues found — engineered correctly"}`,
        { phase: 4, progress: ph4Range.pctEnd });

      // Phase 5 — Auto-fix
      if (issues.length > 0) {
        await setProgress(job.id, siteId, ph5Range.pctStart, `⟳ ${ph5Label}`);
        await insertAgentMessage(job.userId, siteId, "build_progress",
          `✦ ${ph5Label} — correcting ${issues.length} issue${issues.length !== 1 ? "s" : ""}…`,
          { phase: 5, progress: ph5Range.pctStart });
        try {
          finalBuildFiles = await autoFixProjectAI(buildOut.files, issues, siteModel);
          const fixedCount = Object.keys(finalBuildFiles).filter((k) => finalBuildFiles[k] !== buildOut.files[k]).length;
          await setProgress(job.id, siteId, ph5Range.pctEnd, `✓ ${ph5Label}`);
          await insertAgentMessage(job.userId, siteId, "build_progress",
            `✓ ${ph5Label}\n   Patched ${fixedCount} file${fixedCount !== 1 ? "s" : ""}`,
            { phase: 5, progress: ph5Range.pctEnd });
          await saveCheckpoint(siteId, `Auto-fix complete · ${fixedCount} files patched`, finalBuildFiles, ph5Range.pctEnd);
        } catch (err) {
          logger.warn({ err: String(err) }, "Auto-fix failed (non-fatal)");
          await setProgress(job.id, siteId, ph5Range.pctEnd, "↷ Fix skipped");
        }
      } else {
        await setProgress(job.id, siteId, ph5Range.pctEnd, "✓ Architecture clean — no fixes needed");
        await insertAgentMessage(job.userId, siteId, "build_progress",
          `✓ ${ph5Label} — architecture clean, no corrections needed`, { phase: 5, progress: ph5Range.pctEnd });
      }
    } else {
      // Games and focused builds skip audit — WebForge Core reasoned it adds no value here
      const skipMsg = ctx.isGame
        ? "🎮 WebForge — game engine complete, web audits not applicable"
        : "⚡ WebForge — focused build, audit overhead skipped";
      await setProgress(job.id, siteId, ph5Range.pctEnd, skipMsg);
      await insertAgentMessage(job.userId, siteId, "build_progress", skipMsg,
        { phase: 5, progress: ph5Range.pctEnd });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6 — Visual finalization (range dynamically computed)
    // ═══════════════════════════════════════════════════════════════════════
    const ph6Label = getPhaseLabel("render", ctx);
    const ph6Range = getPhaseRange("render", ctx);
    await setProgress(job.id, siteId, ph6Range.pctStart, `⟳ ${ph6Label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ ${ph6Label}`,
      { phase: 6, progress: ph6Range.pctStart });

    // Inject a theme-consistent hero image into index.html via picsum seed
    finalBuildFiles = injectHeroImage(finalBuildFiles, research, site.name);

    await setProgress(job.id, siteId, ph6Range.pctEnd, `✓ ${ph6Label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✓ ${ph6Label}\n   Visual identity finalized`,
      { phase: 6, progress: ph6Range.pctEnd });

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
    const finalCtx: BuildContext = { isGame: false, isSimple: false, isEdit, needsResearch: true, needsAudit: true, pageCount: plan.pages.length };
    const ph7Label = getPhaseLabel("deploy", finalCtx);
    const ph7Range = getPhaseRange("deploy", finalCtx);
    await setProgress(job.id, siteId, ph7Range.pctStart, `⟳ ${ph7Label}`);
    await insertAgentMessage(job.userId, siteId, "build_progress",
      `✦ ${ph7Label}`,
      { phase: 7, progress: ph7Range.pctStart });

    await db.update(sitesTable).set({
      status: "building", progress: ph7Range.pctStart,
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
                const pct = Math.min(98, ph7Range.pctStart + Math.round((idx / Math.max(totalFiles, 1)) * (98 - ph7Range.pctStart)));
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
        `✓ ${ph7Label}\n\n${stepSummary}\n\n🎉 ${site.name} is LIVE!\n🌐 ${puterPublicUrl}`,
        { files: Object.keys(finalFiles), publicUrl: puterPublicUrl, totalBytes, phase: 7 });
    } else {
      await insertAgentMessage(job.userId, siteId, "build_done",
        `✓ ${ph7Label}\n\n${stepSummary}`,
        { files: Object.keys(finalFiles), puterStatus, puterError, totalBytes, phase: 7 });
    }

    siteEventBus.emitSite({ type: "site_updated", siteId });
    siteEventBus.emitSite({ type: "site_ready", siteId, userId: job.userId, siteName: site.name, publicUrl: puterPublicUrl, isEdit, fileCount: totalFiles, changedFileCount: totalFiles });

    // Push notification — fires non-blocking after the site is ready
    if (!isEdit) {
      void sendPushNotification(
        job.userId,
        `🚀 ${site.name} is live!`,
        puterPublicUrl
          ? `Your site is ready. Tap to preview it live.`
          : `Your site finished building — tap to open it in WebForge.`,
        { siteId, publicUrl: puterPublicUrl ?? "" },
      );
    } else {
      void sendPushNotification(
        job.userId,
        `✓ ${site.name} updated`,
        `Your edits are live. Tap to preview.`,
        { siteId, publicUrl: puterPublicUrl ?? "" },
      );
    }

    void streamNarration({
      userId: job.userId, siteId, intent: "done",
      context: `Just shipped "${site.name}". ${totalFiles} files, ${(totalBytes / 1024).toFixed(1)} KB. Files: ${Object.keys(finalFiles).slice(0, 5).join(", ")}.`,
      fallback: "Shipped it. All 7 phases complete — tap Preview to see your site live.",
    });
  }

  private async failJob(job: Job, message: string): Promise<void> {
    const isOffline = message === "agent_offline";
    const isQuota = message === "quota_exhausted";
    const userMessage = isOffline
      ? "Agent temporarily offline — auto-retrying in 3 minutes…"
      : isQuota
      ? "Model quota exhausted — retry with a different model"
      : message;
    await db.update(jobsTable).set({ status: "failed", message: userMessage, finishedAt: new Date() }).where(eq(jobsTable.id, job.id));
    await db.update(sitesTable).set({ status: "failed", error: message, message: userMessage, updatedAt: new Date() }).where(eq(sitesTable.id, job.siteId));
    await insertAgentMessage(
      job.userId, job.siteId, "build_failed",
      isOffline
        ? "🤖 Agent temporarily offline — will auto-retry in 3 minutes."
        : isQuota
        ? "⚡ Model quota exhausted — pick a different model and retry."
        : `Build failed: ${message}`,
      null,
    );
  }

  /** Re-queue a job after a delay, but only if the site is still in failed state.
   *  If the site already has partial files, uses kind="retry" so runBuild can
   *  detect them and skip straight to finalize rather than starting from scratch. */
  private async scheduleRetry(job: Job, delayMs: number): Promise<void> {
    await sleep(delayMs);
    try {
      const [site] = await db
        .select({ status: sitesTable.status, files: sitesTable.files, progress: sitesTable.progress })
        .from(sitesTable)
        .where(eq(sitesTable.id, job.siteId))
        .limit(1);
      if (!site || site.status !== "failed") return; // user already retried manually

      // If the site already has a meaningful number of partial files, resume with
      // kind="retry" so we can finalize what was already built instead of starting over.
      const existingFileCount = Object.keys((site.files as Record<string, string>) ?? {}).length;
      const resumeKind = existingFileCount >= 3 ? "retry" : (job.kind === "analyze" ? "create" : job.kind);
      const resumeProgress = existingFileCount >= 3 ? Math.max(site.progress ?? 0, 50) : 0;
      const resumeMsg = existingFileCount >= 3
        ? "Resuming build — finalizing partial files…"
        : "Auto-retry — agent back online";

      const [newJob] = await db
        .insert(jobsTable)
        .values({
          userId: job.userId,
          siteId: job.siteId,
          kind: resumeKind,
          status: "queued",
          progress: resumeProgress,
          message: resumeMsg,
          instructions: job.instructions,
        })
        .returning();
      await db
        .update(sitesTable)
        .set({ status: "queued", progress: resumeProgress, message: resumeMsg, error: null, updatedAt: new Date() })
        .where(eq(sitesTable.id, job.siteId));
      siteEventBus.emitSite({ type: "site_updated", siteId: job.siteId });
      await insertAgentMessage(
        job.userId, job.siteId, "log",
        existingFileCount >= 3
          ? `🔄 Resuming build — ${existingFileCount} files already written, finalizing…`
          : "🔄 Auto-retry started — agent back online.",
        null,
      );
      await this.enqueue(newJob.id);
    } catch (err) {
      logger.warn({ err, siteId: job.siteId }, "scheduleRetry failed");
    }
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
  const isSingle = plan.pages.length === 1;
  const lines: string[] = [];
  lines.push(`✦ ${plan.summary}`);
  lines.push("");
  if (isSingle) {
    lines.push(`📄 Single-file build — all the magic in one page.`);
    lines.push(`   ${plan.pages[0].title}: ${plan.pages[0].purpose}`);
  } else {
    lines.push(`📄 ${plan.pages.length} pages:`);
    for (const p of plan.pages) lines.push(`   • ${p.title} — ${p.purpose}`);
  }
  lines.push("");
  lines.push(`🎨 ${plan.styles.palette} · ${plan.styles.mood}`);
  if (plan.features.length > 0) {
    lines.push(`⚡ ${plan.features.slice(0, 5).join(" · ")}`);
  }
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

/**
 * CLARIFY SKILL — Generate targeted clarifying questions for vague or short prompts.
 * Returns an empty array when the prompt is detailed enough to proceed without questions.
 */
function generateClarifyingQuestions(
  prompt: string,
  analysis: { type: string; features: string[]; pages: string[]; audience?: string | null },
): string[] {
  const p = prompt.toLowerCase();
  const questions: string[] = [];

  // Only fire for short/vague prompts — skip if the user gave rich detail
  const isVague = prompt.trim().length < 80 || analysis.features.length < 2;
  if (!isVague) return [];

  // Type-specific questions
  if (analysis.type === "ecommerce" && !p.match(/product|item|shop|sell|store|catalog/)) {
    questions.push("What products or services will be listed? (e.g. handmade jewellery, digital downloads, courses)");
  }
  if (analysis.type === "portfolio" && !p.match(/skill|project|work|experience|role/)) {
    questions.push("What role or skills should be highlighted? (e.g. frontend developer, photographer, UX designer)");
  }
  if (analysis.type === "restaurant" && !p.match(/cuisine|menu|food|dish/)) {
    questions.push("What cuisine or menu style? Any must-have sections like reservations or delivery?");
  }
  if (analysis.type === "saas" && !p.match(/feature|plan|pricing|trial/)) {
    questions.push("What's the core feature or problem this SaaS solves? Should it have pricing plans?");
  }

  // Universal style question — ask if no style hints provided
  if (!p.match(/dark|light|color|theme|minimal|bold|elegant|modern|retro|neon/)) {
    questions.push("Any style preference? (e.g. dark & technical, clean & minimal, bold & colorful)");
  }

  // Contact / CTA — ask if a contact page is planned but no details given
  if (analysis.pages.some(pg => pg.includes("contact")) && !p.match(/email|phone|contact|form/)) {
    questions.push("What contact details should appear? (email, phone number, booking link, social handles)");
  }

  return questions.slice(0, 3);
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

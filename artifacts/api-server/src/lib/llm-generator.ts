/**
 * LLM-powered WebForge generator — powered by Puter Codex.
 *
 * Pipeline phases:
 *   Phase 0 — researchInspirationAI : design brief from prompt
 *   Phase 1 — analyzeProjectAI      : classify project, draft plan
 *   Phase 1b— refinePlanAI          : user-driven plan iteration
 *   Phase 2 — buildProjectAIParallel: shared assets first, pages in parallel
 *   Phase 3 — auditProjectAI        : SEO / a11y / mobile / perf audit
 *   Phase 4 — autoFixProjectAI      : patch files based on audit
 *   Phase 5 — (queue) hero image    : Puter txt2img or CSS gradient
 */

import type { SiteAnalysis, SiteFiles, SitePlan, SitePlanPage } from "./db";
import {
  analyzeProject as analyzeProjectFallback,
  buildProject as buildProjectFallback,
  type BuildResult,
} from "./generator";
import { logger } from "./logger";
import {
  puterAIComplete,
  puterAIStream,
  type PuterAIMessage,
} from "./puter";
import {
  getFullSkillsContext,
  buildEnvironmentContext,
  validateBuildOutput,
  type AgentEnvironment,
  type BuildQualityReport,
} from "./agent-skills";

export type { BuildQualityReport };

const CODEX_MODEL = "gpt-4o-mini";

// ---------------------------------------------------------------------------
// PHASE 0 — Research / design inspiration
// ---------------------------------------------------------------------------

const RESEARCH_SYSTEM = `You are WebForge's creative director. Given a project brief and its analysis, produce a RICH DESIGN BRIEF that will guide the build engine to create a stunning, award-winning website.

Return ONLY a JSON object — no prose, no markdown:
{
  "mood": string,            // 1 sentence vibe: "Electric and bold — think neon terminals meet Stripe's precision"
  "palette": {
    "background": "#hex",   // dark or light base
    "surface": "#hex",      // card / elevated surface
    "primary": "#hex",      // dominant brand accent
    "secondary": "#hex",    // complementary accent
    "text": "#hex",         // body text
    "muted": "#hex"         // subdued labels
  },
  "typography": string,      // "Display: clamp(3.5rem,8vw,7rem) 800-weight gradient clip. Body: 1.125rem Inter."
  "layout": string,          // "Full-bleed hero, card-grid sections, asymmetric image-text rows, sticky frosted glass nav"
  "competitors": string[],   // 3-4 real sites with similar aesthetic: ["linear.app", "vercel.com", "stripe.com"]
  "heroImagePrompt": string, // Vivid 1-sentence image generation prompt for the hero visual
  "uniqueTwist": string,     // "What sets the visual apart: a live animated dashboard panel on the homepage"
  "techStack": string[]      // CDN libs to use: ["Chart.js 4", "Alpine.js 3", "Lucide icons"] or subset
}`;

export interface ResearchBrief {
  mood: string;
  palette: {
    background: string; surface: string; primary: string;
    secondary: string; text: string; muted: string;
  };
  typography: string;
  layout: string;
  competitors: string[];
  heroImagePrompt: string;
  uniqueTwist: string;
  techStack: string[];
}

export async function researchInspirationAI(
  prompt: string,
  analysis: SiteAnalysis,
  model?: string,
): Promise<ResearchBrief> {
  const fallback: ResearchBrief = {
    mood: "Modern, bold, and professional",
    palette: { background: "#0a0e14", surface: "#141920", primary: "#00ffc2", secondary: "#58a6ff", text: "#e6edf3", muted: "#8b949e" },
    typography: "Display: clamp(3rem,7vw,6rem) 800-weight. Body: 1.1rem Inter.",
    layout: "Full-bleed hero, section grid, sticky nav",
    competitors: ["vercel.com", "linear.app", "stripe.com"],
    heroImagePrompt: `Professional ${analysis.type} website hero image, ${analysis.styleHints.join(", ")}`,
    uniqueTwist: "Animated gradient hero with glassmorphism cards",
    techStack: ["Chart.js 4", "Alpine.js 3", "Lucide icons"],
  };
  try {
    const messages: PuterAIMessage[] = [
      { role: "system", content: RESEARCH_SYSTEM },
      { role: "user", content: `Project: ${prompt}\n\nAnalysis: ${JSON.stringify(analysis, null, 2)}\n\nReturn the JSON design brief.` },
    ];
    const text = await puterAIComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty research");
    const parsed = JSON.parse(text) as Partial<ResearchBrief>;
    return {
      mood: parsed.mood ?? fallback.mood,
      palette: { ...fallback.palette, ...(parsed.palette ?? {}) },
      typography: parsed.typography ?? fallback.typography,
      layout: parsed.layout ?? fallback.layout,
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors.slice(0, 5) : fallback.competitors,
      heroImagePrompt: parsed.heroImagePrompt ?? fallback.heroImagePrompt,
      uniqueTwist: parsed.uniqueTwist ?? fallback.uniqueTwist,
      techStack: Array.isArray(parsed.techStack) ? parsed.techStack : fallback.techStack,
    };
  } catch (err) {
    logger.warn({ err: String(err) }, "researchInspirationAI failed; using fallback");
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// PHASE 1 — Analysis
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM = `You are WebForge, a senior product designer + engineer that ships beautiful, modern, fully-functional one-page-or-multi-page websites for indie founders.

You will be given a short user prompt describing a project. Return a JSON object that classifies the project, names it, and outlines its structure. ONLY return JSON. No prose.

Schema:
{
  "type": "website" | "bot" | "backend" | "tool",
  "intent": string,                 // a clean human title (max 60 chars)
  "audience": string | null,        // e.g. "indie game developers", or null
  "features": string[],             // 3-8 concrete features (e.g. "Online booking with date picker")
  "pages": string[],                // page slugs: ["index","about","menu","contact"]
  "styleHints": string[]            // ["minimal","bold","playful","developer","editorial","luxury", ...]
}

Guidelines:
- Pages must always include "index". Other pages should match the project (e.g. menu for restaurants, gallery for photographers, services + pricing for SaaS).
- Use 3-6 pages typically. Avoid generic "about/services/contact" stuffing if it doesn't fit.
- Features should be specific and concrete, not generic ("Hero section" is too generic).`;

export async function analyzeProjectAI(
  prompt: string,
  name?: string,
  model?: string,
): Promise<SiteAnalysis> {
  try {
    const messages: PuterAIMessage[] = [
      { role: "system", content: ANALYSIS_SYSTEM },
      { role: "user", content: `Project prompt: ${prompt}\n${name ? `Suggested name: ${name}\n` : ""}Return the JSON.` },
    ];
    const text = await puterAIComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty analysis");
    const parsed = JSON.parse(text) as Partial<SiteAnalysis>;
    return normalizeAnalysis(parsed, prompt, name);
  } catch (err) {
    logger.warn({ err: String(err) }, "analyzeProjectAI failed; using fallback");
    return analyzeProjectFallback(prompt, name);
  }
}

function normalizeAnalysis(raw: Partial<SiteAnalysis>, prompt: string, name?: string): SiteAnalysis {
  const validTypes = ["website", "bot", "backend", "tool"] as const;
  const type = (validTypes as readonly string[]).includes(raw.type as string)
    ? (raw.type as SiteAnalysis["type"]) : "website";
  const features = Array.isArray(raw.features) && raw.features.length > 0
    ? raw.features.slice(0, 8).map(String) : ["Hero", "About", "Contact"];
  const pagesRaw = Array.isArray(raw.pages) && raw.pages.length > 0
    ? raw.pages.map((p) => String(p).toLowerCase().replace(/[^a-z0-9]/g, "")) : ["index", "about", "contact"];
  const pages = Array.from(new Set(["index", ...pagesRaw])).slice(0, 8);
  const styleHints = Array.isArray(raw.styleHints) ? raw.styleHints.slice(0, 5).map(String) : [];
  const intent = (typeof raw.intent === "string" && raw.intent.trim()) || name?.trim() || deriveTitle(prompt);
  return {
    type, intent: intent.slice(0, 60),
    audience: typeof raw.audience === "string" && raw.audience.trim() ? raw.audience.trim().slice(0, 80) : null,
    features, pages, styleHints,
  };
}

function deriveTitle(prompt: string): string {
  return prompt.trim().split(/[.,;:!?\n]/)[0].slice(0, 60) || "Untitled";
}

// ---------------------------------------------------------------------------
// PHASE 1b — Plan refinement
// ---------------------------------------------------------------------------

const REFINE_PLAN_SYSTEM = `${ANALYSIS_SYSTEM}

You are UPDATING an existing plan based on user feedback. Return the COMPLETE updated JSON — not a diff, not a partial — the full schema.

Rules:
- Keep everything the user did NOT ask to change.
- Apply ONLY the requested change(s).
- "index" MUST always remain in pages.
- Output ONLY the JSON object. No prose.`;

export async function refinePlanAI(
  currentAnalysis: SiteAnalysis,
  feedback: string,
  model?: string,
): Promise<SiteAnalysis> {
  try {
    const messages: PuterAIMessage[] = [
      { role: "system", content: REFINE_PLAN_SYSTEM },
      { role: "user", content: `Current plan:\n${JSON.stringify(currentAnalysis, null, 2)}\n\nUser feedback: "${feedback}"\n\nReturn the updated JSON.` },
    ];
    const text = await puterAIComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty refinement");
    const parsed = JSON.parse(text) as Partial<SiteAnalysis>;
    return normalizeAnalysis(parsed, currentAnalysis.intent);
  } catch (err) {
    logger.warn({ err: String(err) }, "refinePlanAI failed; returning original");
    return currentAnalysis;
  }
}

// ---------------------------------------------------------------------------
// PHASE 2 — Parallel build: shared assets first, then pages concurrently
// ---------------------------------------------------------------------------

const SHARED_ASSETS_SYSTEM = `You are WebForge's CSS/JS architect. Generate ONLY the two shared asset files for a multi-page website. No HTML.

OUTPUT FORMAT (markers on their OWN line):
===COLOR: #RRGGBB===
===FILE: assets/styles.css===
[minimum 700 lines of comprehensive CSS]
===FILE: assets/app.js===
[minimum 250 lines of JavaScript]
===END===

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CSS REQUIREMENTS (700+ lines mandatory)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
:root with 30+ CSS custom properties (colors, spacing, radii, shadows, transitions, typography scale).
Reset + base styles.
Typography scale: display (7vw clamped), h1-h4, body, mono, small — all with fluid clamp() sizes.
Layout utilities: .container, .grid-2, .grid-3, .grid-4, .flex-center, .stack, .cluster.
Component library (style EVERY one of these):
  .btn, .btn-primary, .btn-secondary, .btn-ghost — with hover, active, focus-visible, disabled states.
  .card, .card-glass (glassmorphism), .card-hover (3D tilt), .card-feature.
  .nav, .nav-sticky, .nav-glass, .nav-link, .nav-cta, .mobile-menu, .hamburger.
  .hero, .hero-content, .hero-badge, .hero-headline, .hero-sub, .hero-cta-group.
  .section, .section-alt, .section-dark.
  .badge, .tag, .chip.
  .logo-cloud, .logo-item.
  .feature-grid, .feature-card, .feature-icon.
  .testimonial-grid, .testimonial-card, .testimonial-avatar, .testimonial-quote.
  .pricing-grid, .pricing-card, .pricing-card--featured, .pricing-price, .pricing-features.
  .stats-band, .stat-item, .stat-number, .stat-label.
  .faq, .faq-item.
  .form-group, .form-label, .form-input, .form-textarea, .form-error, .form-success.
  .footer, .footer-grid, .footer-col, .footer-link, .footer-brand, .footer-divider.
  .tag-filter, .filter-bar.
  .modal, .modal-overlay, .modal-content, .modal-close.
  .progress-bar, .progress-fill.
  .alert, .alert-success, .alert-error, .alert-info.
  .table, .table-header, .table-row, .table-cell.
  .dashboard-grid, .stat-card, .chart-container.
  .timeline, .timeline-item, .timeline-dot.
  .gallery-grid, .gallery-item, .gallery-overlay.
Animations: @keyframes fadeUp, slideIn, gradientShift, pulse, countUp, shimmer, float, glowPulse.
Stagger: .stagger-children > * with nth-child delays.
3D card tilt: .card-hover:hover with perspective(900px) rotateX/rotateY.
Custom scrollbar: 6px, accent thumb.
Scroll parallax: .hero-bg at 0.4x speed.
Neon glow utilities: .glow-primary, .glow-accent, .glow-text.
Glassmorphism: .glass — rgba(255,255,255,0.06) + backdrop-filter:blur(14px).
Gradient text: .gradient-text — background-clip:text, text-fill-color:transparent.
Mobile responsive: breakpoints at 768px and 480px. Every component adapts.
Dark / light theme via [data-theme].
Print styles.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JS REQUIREMENTS (250+ lines mandatory)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Nav: hamburger toggle, scroll shadow, active link detection.
- Smooth scroll with offset for sticky nav.
- IntersectionObserver stagger fade-in for .stagger-children.
- Count-up animation: animateCount(el, target, duration).
- 3D card tilt on mousemove (perspective rotateX/Y, snap back).
- Form validation: required fields, email format, character count, localStorage save.
- Modal open/close via showModal() / close() on <dialog> elements.
- Filter bar: filter items by category attribute.
- Sortable table: click header to sort rows.
- Tab switcher: generic function for [data-tab] / [data-panel] patterns.
- Chart init stubs (initCharts()) that Chart.js pages will call.
- LocalStorage helpers: lsGet(key), lsSet(key, val).
- Toast notification system: showToast(msg, type).
- Lazy image loading with IntersectionObserver.
- Copy-to-clipboard utility.
- Scroll-to-top button.
- Theme toggle (data-theme).
- Alpine.js x-data helpers for common patterns.`;

const PAGE_BUILD_SYSTEM = `You are WebForge's HTML page builder. Generate ONE complete, production-quality HTML page.

OUTPUT FORMAT:
===FILE: {FILENAME}===
<!doctype html>
[all HTML content]
===END===

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Complete <!doctype html> with <head> containing:
   - <meta charset="UTF-8">
   - <meta name="viewport" content="width=device-width, initial-scale=1.0">
   - <meta name="description" content="[specific 150-char description]">
   - <meta property="og:title">, og:description, og:type, og:image (picsum.photos)
   - <meta name="theme-color" content="[brand primary]">
   - <link rel="icon" href="data:image/svg+xml,..."> (inline SVG favicon)
   - <link rel="canonical" href="[page URL]">
   - <title>[Page Title] — [Site Name]</title>
   - <link rel="stylesheet" href="assets/styles.css">
   - CDN libraries if needed (Chart.js, Alpine.js, Lucide — from the tech stack)
   - <script src="assets/app.js" defer></script>
   - JSON-LD schema markup for the page type

2. Use RELATIVE paths for all assets (no leading slash). href="assets/styles.css" not "/assets/styles.css".
3. Inter-page links: href="about.html" not "/about.html".
4. Use EXACT CSS class names from the shared stylesheet.
5. REAL content — no Lorem Ipsum. Invent plausible names, numbers, quotes.
6. Every interactive element has aria-label, role, tabindex where needed.
7. All images: <img src="https://picsum.photos/seed/[unique-word]/800/500" alt="[specific description]" loading="lazy">
8. WebForge credit in footer: <div class="webforge-credit" style="text-align:center;padding:20px 16px;font-size:12px;letter-spacing:0.04em;color:rgba(120,120,140,0.85);border-top:1px solid rgba(120,120,140,0.15);margin-top:24px">made with <strong style="color:inherit">WebForge</strong></div>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOME PAGE (index.html) — ALL 10 SECTIONS (MANDATORY, minimum 500 lines total)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Section 1: HERO — Full-bleed, animated gradient bg, badge pill, headline clamp(3.5rem,8vw,7rem), subhead (2-3 sentences), two CTA buttons, hero visual (right side image or animated Alpine.js component).
Section 2: SOCIAL PROOF — Logo cloud of 8-10 believable company names, muted, flex-wrap.
Section 3: FEATURE GRID — 6+ feature cards with Lucide icon + bold title + 3-sentence description each. Real features from the plan.
Section 4: HOW IT WORKS — Numbered 3-step or 4-step flow with icons, rich copy (2-3 sentences per step).
Section 5: INTERACTIVE SHOWCASE — For apps/tools: live working demo panel (Alpine.js + Chart.js). For brochure: 3 alternating image-text rows with picsum photos + 150-word copy each.
Section 6: TESTIMONIALS — 4+ cards with 2-3 sentence quotes, name, job title, company. Avatar CSS circles with initials.
Section 7: PRICING / STATS BAND — Either 3 pricing tiers (free/pro/enterprise with feature lists) OR a 4-number stats band with count-up animation.
Section 8: FAQ — 8+ items with <details><summary>. Cover real questions about the product.
Section 9: FINAL CTA BAND — 2-headline + subhead + primary button. Bold and full-width.
Section 10: FOOTER — 4-column grid: brand + tagline, navigation links, resources, social icons. WebForge credit.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INNER PAGES — minimum 350 lines each
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Each inner page must have:
- Sticky nav with all page links (active state on current page)
- Page hero (smaller than home, 120px padding, title + subtitle)
- 3+ substantial content sections using shared CSS components
- Footer matching home

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTERACTIVITY (for app/tool pages)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use Alpine.js x-data for: tabs, toggles, modals, accordions, cart counters, quiz flows.
Use Chart.js for: dashboards, analytics, results, comparisons.
All data must be realistic hardcoded JSON inline in <script> or app.js.`;

// Old streaming system (kept for edit/fallback)
const BUILD_STREAM_SYSTEM = `You are WebForge, a top-tier frontend engineer + designer. You build REAL, PRODUCTION-QUALITY, FULLY INTERACTIVE multi-page web experiences. Stream using a simple delimiter format.

OUTPUT FORMAT (each marker on its OWN line):
===COLOR: #RRGGBB===
===FILE: assets/styles.css===
[raw CSS - 700+ lines]
===FILE: assets/app.js===
[raw JS - 250+ lines]
===FILE: index.html===
<!doctype html>[raw HTML - 500+ lines]
===FILE: <other-page>.html===
[raw HTML - 350+ lines each]
===END===

CDN libraries allowed: Chart.js 4, Alpine.js 3, Lucide icons (same CDN URLs as the page builder).
FILE SIZE: exceed 120KB total. A 20KB output is a FAILURE.
All rules same as the page builder above — real content, all 10 home sections, 350+ lines per inner page.`;

export type StreamUpdate = {
  coverColor: string;
  files: SiteFiles;
  currentFile: string | null;
  bytes: number;
};

// ---------------------------------------------------------------------------
// Streaming shared assets generator
// ---------------------------------------------------------------------------

async function generateSharedAssetsStream(
  plan: SitePlan,
  intentName: string,
  originalPrompt: string,
  research: ResearchBrief,
  onUpdate: (u: StreamUpdate) => Promise<void> | void,
  model?: string,
  attempt = 1,
): Promise<{ files: SiteFiles; coverColor: string }> {
  const techStackNote = research.techStack.length > 0
    ? `\nCDN tech stack to use: ${research.techStack.join(", ")}`
    : "";
  const paletteNote = `\nBrand palette: ${JSON.stringify(research.palette)}\nMood: ${research.mood}\nLayout direction: ${research.layout}`;

  const env: AgentEnvironment = {
    model: model ?? CODEX_MODEL,
    siteName: intentName,
    siteType: plan.type,
    pageCount: plan.pages.length,
    features: plan.features,
    mood: research.mood,
    techStack: research.techStack,
    buildAttempt: attempt,
  };

  const skillsContext = getFullSkillsContext(plan, research);
  const envContext = buildEnvironmentContext(env);

  const messages: PuterAIMessage[] = [
    {
      role: "system",
      content: `${SHARED_ASSETS_SYSTEM}\n\n${skillsContext}\n\n${envContext}`,
    },
    {
      role: "user",
      content: `Site name: ${intentName}\nProject: ${originalPrompt}\nPlan summary: ${plan.summary}\nFeatures: ${plan.features.join(", ")}\nPages: ${plan.pages.map(p => p.path).join(", ")}${paletteNote}${techStackNote}\n\nGenerate the shared assets/styles.css and assets/app.js now. Remember: minimum 700 lines CSS, 250 lines JS.`,
    },
  ];

  return streamParseFiles(messages, {}, onUpdate, model ?? CODEX_MODEL);
}

// ---------------------------------------------------------------------------
// Individual page generator (used in parallel)
// ---------------------------------------------------------------------------

async function generatePageAI(
  page: SitePlanPage,
  allPages: SitePlanPage[],
  plan: SitePlan,
  intentName: string,
  originalPrompt: string,
  research: ResearchBrief,
  model?: string,
  attempt = 1,
  previousIssues?: string[],
): Promise<SiteFiles> {
  const filename = page.path === "index" ? "index.html"
    : page.path.endsWith(".html") ? page.path : `${page.path}.html`;
  const isHome = page.path === "index";

  const navLinks = allPages.map(p => {
    const href = p.path === "index" ? "index.html" : `${p.path}.html`;
    return `<a href="${href}">${p.title}</a>`;
  }).join(", ");

  const techNote = research.techStack.length > 0
    ? `\nCDN libraries to use: ${research.techStack.join(", ")}`
    : "";
  const paletteNote = `Palette: bg ${research.palette.background}, primary ${research.palette.primary}, secondary ${research.palette.secondary}. Mood: ${research.mood}. Unique twist: ${research.uniqueTwist}.`;

  const env: AgentEnvironment = {
    model: model ?? CODEX_MODEL,
    siteName: intentName,
    siteType: plan.type,
    pageCount: allPages.length,
    features: plan.features,
    mood: research.mood,
    techStack: research.techStack,
    buildAttempt: attempt,
    previousIssues,
  };

  const skillsContext = getFullSkillsContext(plan, research);
  const envContext = buildEnvironmentContext(env);

  const retryNote = attempt > 1 && previousIssues && previousIssues.length > 0
    ? `\n\nATTEMPT ${attempt} — PREVIOUS ISSUES TO FIX:\n${previousIssues.map(i => `  ✗ ${i}`).join("\n")}\nFix ALL of the above. Do not repeat them.`
    : "";

  const messages: PuterAIMessage[] = [
    {
      role: "system",
      content: `${PAGE_BUILD_SYSTEM}\n\n${skillsContext}\n\n${envContext}`,
    },
    {
      role: "user",
      content: `Generate the ${isHome ? "HOME (index.html)" : `"${page.title}" (${filename})`} page.

Site name: ${intentName}
Project description: ${originalPrompt}
Plan: ${plan.summary}
${paletteNote}${techNote}

THIS PAGE:
  Path: ${filename}
  Title: ${page.title}
  Purpose: ${page.purpose}
  Sections: ${page.sections.join(" | ")}

All pages (for nav): ${navLinks}
Features to mention: ${plan.features.slice(0, 6).join(", ")}
${isHome ? "\nThis is the HOME page — include ALL 10 mandatory sections. Minimum 500 lines of HTML." : `\nThis is an inner page — include nav, page hero, 3+ content sections, footer. Minimum 350 lines.`}
${retryNote}

Output the FILE marker then the complete HTML, then ===END===.`,
    },
  ];

  try {
    const result = await streamParseFiles(messages, {}, async () => {}, model ?? CODEX_MODEL);
    const files: SiteFiles = {};
    for (const [k, v] of Object.entries(result.files)) {
      if (v && v.trim().length > 100) files[k] = v;
    }
    if (files[page.path] && !files[filename]) {
      files[filename] = files[page.path];
      delete files[page.path];
    }
    return files;
  } catch (err) {
    logger.warn({ err: String(err), page: page.path }, "generatePageAI failed for page");
    return {};
  }
}

// ---------------------------------------------------------------------------
// PHASE 2 — Parallel build (main entry point)
// ---------------------------------------------------------------------------

export async function buildProjectAIParallel(
  plan: SitePlan,
  intentName: string,
  originalPrompt: string,
  research: ResearchBrief,
  onUpdate: (u: StreamUpdate) => Promise<void> | void,
  model?: string,
  onQualityReport?: (report: BuildQualityReport) => Promise<void> | void,
): Promise<BuildResult> {
  const MAX_ATTEMPTS = 2; // quality-gate retry attempts

  try {
    let attempt = 1;
    let allFiles: SiteFiles = {};
    let coverColor = "#7CC7FF";
    let qualityReport: BuildQualityReport | null = null;

    while (attempt <= MAX_ATTEMPTS) {
      const previousIssues = qualityReport
        ? qualityReport.issues.map(i => `[${i.severity.toUpperCase()}] ${i.file}: ${i.detail}`)
        : undefined;

      // ── Step A: Shared CSS + JS (only on first attempt or if CSS/JS were weak)
      const needsSharedRebuild = attempt === 1
        || (qualityReport?.weakPages ?? []).some(p => p.startsWith("assets/"));

      if (needsSharedRebuild) {
        const sharedResult = await generateSharedAssetsStream(
          plan, intentName, originalPrompt, research, onUpdate, model, attempt
        );
        coverColor = sharedResult.coverColor;
        for (const [k, v] of Object.entries(sharedResult.files)) {
          allFiles[k] = v;
        }
        const totalBytes = Object.values(allFiles).reduce((s, v) => s + v.length, 0);
        await onUpdate({ coverColor, files: { ...allFiles }, currentFile: null, bytes: totalBytes });
      }

      // ── Step B: Generate pages — on retry only regenerate weak pages
      const pagesToBuild = attempt === 1
        ? plan.pages
        : plan.pages.filter(p => {
            const filename = p.path === "index" ? "index.html"
              : p.path.endsWith(".html") ? p.path : `${p.path}.html`;
            return (qualityReport?.weakPages ?? []).includes(filename);
          });

      if (pagesToBuild.length > 0) {
        await Promise.all(
          pagesToBuild.map(async (page) => {
            const pageFiles = await generatePageAI(
              page, plan.pages, plan, intentName, originalPrompt, research,
              model, attempt, previousIssues
            );
            for (const [k, v] of Object.entries(pageFiles)) {
              allFiles[k] = v;
            }
            const totalBytes = Object.values(allFiles).reduce((s, v) => s + v.length, 0);
            const firstFile = Object.keys(pageFiles)[0] ?? null;
            await onUpdate({ coverColor, files: { ...allFiles }, currentFile: firstFile, bytes: totalBytes });
          })
        );
      }

      // ── Step C: Quality gate
      const cleaned = sanitizeFiles(allFiles, plan);
      qualityReport = validateBuildOutput(cleaned, plan);

      logger.info({
        attempt,
        score: qualityReport.score,
        passed: qualityReport.passed,
        weakPages: qualityReport.weakPages,
        totalKB: (qualityReport.totalBytes / 1024).toFixed(1),
      }, "Quality gate result");

      if (onQualityReport) await onQualityReport(qualityReport);

      if (qualityReport.passed || attempt >= MAX_ATTEMPTS) {
        if (Object.keys(cleaned).length === 0) throw new Error("no files produced");
        return { files: cleaned, coverColor, name: intentName };
      }

      // Not passed — retry weak pages
      logger.warn({ attempt, issues: qualityReport.issues.length, weakPages: qualityReport.weakPages }, "Quality gate failed — retrying weak pages");
      attempt++;
    }

    // Fallback (shouldn't reach here)
    const cleaned = sanitizeFiles(allFiles, plan);
    return { files: cleaned, coverColor, name: intentName };

  } catch (err) {
    logger.warn({ err: String(err) }, "buildProjectAIParallel failed; using streaming fallback");
    return buildProjectAIStream(plan, intentName, originalPrompt, onUpdate, model);
  }
}

// ---------------------------------------------------------------------------
// PHASE 2-STREAM — Fallback streaming build (also used by edit)
// ---------------------------------------------------------------------------

export async function buildProjectAIStream(
  plan: SitePlan,
  intentName: string,
  originalPrompt: string,
  onUpdate: (u: StreamUpdate) => Promise<void> | void,
  model?: string,
): Promise<BuildResult> {
  try {
    const planSummary = {
      name: intentName, type: plan.type, summary: plan.summary,
      pages: plan.pages.map(p => ({ path: p.path, title: p.title, purpose: p.purpose, sections: p.sections })),
      features: plan.features, palette: plan.styles.palette, mood: plan.styles.mood,
    };
    const messages: PuterAIMessage[] = [
      { role: "system", content: BUILD_STREAM_SYSTEM },
      { role: "user", content: `name: ${intentName}\n\nprompt: ${originalPrompt}\n\nplan: ${JSON.stringify(planSummary, null, 2)}` },
    ];
    const result = await streamParseFiles(messages, {}, onUpdate, model ?? CODEX_MODEL);
    const cleaned = sanitizeFiles(result.files, plan);
    if (Object.keys(cleaned).length === 0) throw new Error("no files produced");
    return { files: cleaned, coverColor: result.coverColor, name: intentName };
  } catch (err) {
    logger.warn({ err: String(err) }, "buildProjectAIStream failed; using fallback");
    return buildProjectFallback(plan, intentName);
  }
}

// ---------------------------------------------------------------------------
// Shared streaming parser (used by both shared-assets and stream-build)
// ---------------------------------------------------------------------------

async function streamParseFiles(
  messages: PuterAIMessage[],
  initialFiles: SiteFiles,
  onUpdate: (u: StreamUpdate) => Promise<void> | void,
  model: string,
): Promise<{ files: SiteFiles; coverColor: string }> {
  let buffer = "";
  let coverColor = "#7CC7FF";
  let currentFile: string | null = null;
  let bytes = 0;
  const files: Record<string, string> = { ...initialFiles };
  let lastFlush = 0;
  let pendingFlush = false;

  const flush = async (force: boolean) => {
    if (pendingFlush && !force) return;
    const now = Date.now();
    if (!force && now - lastFlush < 220) return;
    pendingFlush = true;
    try {
      await onUpdate({ coverColor, files: { ...files }, currentFile, bytes });
      lastFlush = Date.now();
    } finally { pendingFlush = false; }
  };

  const consumeLine = (rawLine: string): void => {
    const stripped = rawLine.replace(/^\uFEFF/, "").replace(/\r$/, "");
    const probe = stripped.trim();
    const colorMatch = probe.match(/^===COLOR:\s*(#[0-9a-fA-F]{6})\s*===$/);
    const fileMatch = probe.match(/^===FILE:\s*(.+?)\s*===$/);
    const endMatch = probe.match(/^===END===$/);
    if (colorMatch) { coverColor = colorMatch[1]; return; }
    if (fileMatch) {
      const sanitized = sanitizeOnePath(fileMatch[1]);
      currentFile = sanitized;
      if (sanitized && !(sanitized in files)) files[sanitized] = "";
      return;
    }
    if (endMatch) { currentFile = null; return; }
    if (/^```/.test(probe)) return;
    if (currentFile) {
      files[currentFile] = (files[currentFile] ?? "") + stripped + "\n";
      bytes += stripped.length + 1;
    }
  };

  await puterAIStream(
    messages,
    (delta: string) => {
      buffer += delta;
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        consumeLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
      }
      if (currentFile) {
        const transient = (files[currentFile] ?? "") + buffer;
        const now = Date.now();
        if (now - lastFlush > 220 && !pendingFlush) {
          pendingFlush = true;
          void Promise.resolve(onUpdate({ coverColor, files: { ...files, [currentFile!]: transient }, currentFile, bytes: bytes + buffer.length }))
            .then(() => { lastFlush = Date.now(); pendingFlush = false; })
            .catch(() => { pendingFlush = false; });
        }
      } else { void flush(false); }
    },
    { model },
  );

  if (buffer.length > 0) { consumeLine(buffer); buffer = ""; }
  await flush(true);
  return { files, coverColor };
}

// ---------------------------------------------------------------------------
// PHASE 3 — Quality audit
// ---------------------------------------------------------------------------

export interface AuditIssue {
  severity: "critical" | "high" | "medium" | "low";
  category: "seo" | "accessibility" | "mobile" | "performance" | "content" | "code";
  file: string;
  issue: string;
  fix: string;
}

const AUDIT_SYSTEM = `You are WebForge's senior QA engineer. Review this website's file list and HTML summaries, identify real issues.

Focus on:
- SEO: missing meta description, og tags, canonical URL, JSON-LD schema, heading hierarchy (h1 → h2 → h3 order)
- Accessibility: images without alt text, buttons without labels, missing ARIA roles, poor color contrast indicators, no skip-nav link, form inputs without labels
- Mobile: fixed pixel widths over 100vw, small tap targets (<44px), overflow:hidden missing on body
- Performance: render-blocking scripts in <head> without defer/async, missing lazy loading on images
- Content: Lorem ipsum found, placeholder [COMPANY] or [NAME] text, stub sections with < 50 words
- Code: invalid HTML structure, broken relative links, missing closing tags

Return ONLY a JSON array of up to 12 issues (prioritize critical and high):
[
  {
    "severity": "critical"|"high"|"medium"|"low",
    "category": "seo"|"accessibility"|"mobile"|"performance"|"content"|"code",
    "file": "<filename>",
    "issue": "<specific description of the problem>",
    "fix": "<specific fix instruction>"
  }
]

If no issues found, return [].`;

export async function auditProjectAI(
  files: SiteFiles,
  plan: SitePlan,
  model?: string,
): Promise<AuditIssue[]> {
  try {
    // Build a compact summary (first 3000 chars per HTML file, first 800 chars of CSS)
    const summary: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith(".html")) {
        summary[path] = content.slice(0, 3000) + (content.length > 3000 ? "\n...[truncated]" : "");
      } else if (path === "assets/styles.css") {
        summary[path] = content.slice(0, 800) + "...[truncated]";
      }
    }

    const messages: PuterAIMessage[] = [
      { role: "system", content: AUDIT_SYSTEM },
      {
        role: "user",
        content: `Site: ${plan.summary}\nFiles: ${Object.keys(files).join(", ")}\n\nFile summaries:\n${JSON.stringify(summary, null, 2)}\n\nReturn the JSON issues array.`,
      },
    ];

    const text = await puterAIComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) return [];
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x: unknown) =>
      x && typeof x === "object" && "severity" in (x as object) && "issue" in (x as object)
    ).slice(0, 12) as AuditIssue[];
  } catch (err) {
    logger.warn({ err: String(err) }, "auditProjectAI failed");
    return [];
  }
}

// ---------------------------------------------------------------------------
// PHASE 4 — Auto-fix
// ---------------------------------------------------------------------------

const AUTOFIX_SYSTEM = `You are WebForge's autonomous fixer. You will receive a website's files and a list of specific QA issues.

Fix ALL issues listed. Return a JSON object mapping filename → fixed content.
Return ONLY the files that need changes. Unchanged files should NOT be included.

Rules:
- Fix every issue in the list precisely
- Do NOT remove existing content or functionality
- Do NOT change visual design
- For SEO: add proper <meta> tags, JSON-LD, og: tags
- For accessibility: add aria-label, role, alt text, skip-nav link, focus styles
- For content issues: replace Lorem Ipsum / placeholder text with real content
- For mobile: replace fixed px widths with max-width or % equivalents
- Keep all existing HTML structure; only patch what's needed

Return JSON: { "<filename>": "<complete fixed file content>", ... }`;

export async function autoFixProjectAI(
  files: SiteFiles,
  issues: AuditIssue[],
  model?: string,
): Promise<SiteFiles> {
  if (issues.length === 0) return files;

  try {
    // Group issues by file and only pass those files
    const affectedFiles = new Set(issues.map((i) => i.file));
    const filesToFix: SiteFiles = {};
    for (const f of affectedFiles) {
      if (files[f]) {
        // Truncate very large files to avoid token overflow
        filesToFix[f] = files[f].slice(0, 12000);
      }
    }

    const issuesSummary = issues
      .map((i, n) => `${n + 1}. [${i.severity.toUpperCase()}] ${i.file}: ${i.issue} → Fix: ${i.fix}`)
      .join("\n");

    const messages: PuterAIMessage[] = [
      { role: "system", content: AUTOFIX_SYSTEM },
      {
        role: "user",
        content: `Issues to fix:\n${issuesSummary}\n\nFiles to update:\n${JSON.stringify(filesToFix, null, 2)}\n\nReturn JSON with fixed files only.`,
      },
    ];

    const text = await puterAIComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) return files;

    const fixedFiles = JSON.parse(text) as Record<string, unknown>;
    const result: SiteFiles = { ...files };
    for (const [path, content] of Object.entries(fixedFiles)) {
      if (typeof content === "string" && content.length > 100 && files[path] !== undefined) {
        result[path] = content;
      }
    }
    return result;
  } catch (err) {
    logger.warn({ err: String(err) }, "autoFixProjectAI failed; returning original files");
    return files;
  }
}

// ---------------------------------------------------------------------------
// Build non-streaming (used by editProjectAI)
// ---------------------------------------------------------------------------

const BUILD_SYSTEM = `You are WebForge, a top-tier frontend engineer + designer. Generate a complete, production-quality static website as JSON.

Return ONLY a JSON object:
{
  "coverColor": "#RRGGBB",
  "files": {
    "index.html": "<!doctype html>...",
    "about.html": "...",
    "assets/styles.css": "...",
    "assets/app.js": "..."
  }
}

Hard requirements:
1. Each HTML file MUST be a complete <!doctype html> document.
2. Every page links to "assets/styles.css" and "assets/app.js" with relative paths.
3. Inter-page links use relative paths. Mobile-responsive. Real content.
4. All 10 home sections for index.html. 350+ lines per inner page.
5. coverColor is a single hex. Valid JSON. No Lorem Ipsum.`;

export async function buildProjectAI(
  plan: SitePlan,
  intentName: string,
  originalPrompt: string,
  model?: string,
): Promise<BuildResult> {
  try {
    const planSummary = { name: intentName, type: plan.type, summary: plan.summary, pages: plan.pages, features: plan.features, palette: plan.styles.palette, mood: plan.styles.mood };
    const messages: PuterAIMessage[] = [
      { role: "system", content: BUILD_SYSTEM },
      { role: "user", content: `name: ${intentName}\n\nprompt: ${originalPrompt}\n\nplan: ${JSON.stringify(planSummary, null, 2)}` },
    ];
    const text = await puterAIComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty build response");
    const parsed = JSON.parse(text) as { coverColor?: string; files?: Record<string, unknown> };
    const files = sanitizeFiles(parsed.files, plan);
    if (Object.keys(files).length === 0) throw new Error("no files produced");
    const coverColor = isHex(parsed.coverColor) ? parsed.coverColor! : "#7CC7FF";
    return { files, coverColor, name: intentName };
  } catch (err) {
    logger.warn({ err: String(err) }, "buildProjectAI failed; using fallback");
    return buildProjectFallback(plan, intentName);
  }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

const EDIT_SYSTEM = `You are WebForge, modifying an existing static website based on a user's edit instructions.

Return ONLY a JSON object: { "coverColor": "#RRGGBB", "files": { "<path>": "<content>", ... } }

Rules:
- Return COMPLETE new file contents for any file you change.
- Include ALL files (even unchanged) for atomic replacement.
- Maintain valid HTML5 and the same nav structure across pages.
- Do not break inter-page links or asset links.`;

export async function editProjectAI(
  currentFiles: SiteFiles,
  intentName: string,
  instructions: string,
  model?: string,
): Promise<BuildResult> {
  try {
    const messages: PuterAIMessage[] = [
      { role: "system", content: EDIT_SYSTEM },
      { role: "user", content: `name: ${intentName}\n\nedit instructions: ${instructions}\n\ncurrent files:\n${JSON.stringify(currentFiles, null, 2)}` },
    ];
    const text = await puterAIComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty edit response");
    const parsed = JSON.parse(text) as { coverColor?: string; files?: Record<string, unknown> };
    const fallbackPlan: SitePlan = { type: "website", summary: "", pages: [{ path: "index.html", title: "Home", purpose: "", sections: [] }], styles: { palette: "neon", mood: "" }, features: [], notes: [] };
    const files = sanitizeFiles(parsed.files, fallbackPlan);
    if (Object.keys(files).length === 0) throw new Error("no files in edit");
    const coverColor = isHex(parsed.coverColor) ? parsed.coverColor! : "#7CC7FF";
    return { files, coverColor, name: intentName };
  } catch (err) {
    logger.warn({ err: String(err) }, "editProjectAI failed");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isHex(v: unknown): boolean {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function sanitizeOnePath(raw: string): string | null {
  const p = raw.trim().replace(/^\/+/, "");
  if (!p || p.length > 200) return null;
  if (p.includes("..")) return null;
  if (!/^[a-zA-Z0-9._\-/]+$/.test(p)) return null;
  return p;
}

function sanitizeFiles(raw: Record<string, unknown> | undefined, plan: SitePlan): SiteFiles {
  if (!raw || typeof raw !== "object") return {};
  const out: SiteFiles = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") continue;
    const path = k.replace(/^\/+/, "");
    if (path.length === 0 || path.length > 200 || path.includes("..")) continue;
    out[path] = v.replace(/^\uFEFF/, "");
  }
  if (!out["index.html"]) {
    const homePage = plan.pages[0];
    if (homePage && out[homePage.path]) { out["index.html"] = out[homePage.path]; }
  }
  return fillMissingFromFallback(out, plan);
}

function fillMissingFromFallback(files: SiteFiles, plan: SitePlan): SiteFiles {
  const out: SiteFiles = { ...files };
  let fallback: BuildResult | null = null;
  const ensureFallback = (): BuildResult => { if (!fallback) fallback = buildProjectFallback(plan, "site"); return fallback; };
  for (const page of plan.pages) {
    if (!page.path) continue;
    const existing = out[page.path];
    if (!existing || existing.trim().length < 200) {
      const fb = ensureFallback();
      if (fb.files[page.path]) out[page.path] = fb.files[page.path];
    }
  }
  for (const asset of ["assets/styles.css", "assets/app.js"]) {
    if (!out[asset] || out[asset].trim().length === 0) {
      const fb = ensureFallback();
      if (fb.files[asset]) out[asset] = fb.files[asset];
    }
  }
  return out;
}

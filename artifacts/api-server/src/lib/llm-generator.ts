/**
 * OpenClaw — WebForge AI Orchestration Pipeline
 *
 * OpenClaw is the central brain and orchestration engine of WebForge AI.
 * It doesn't simply generate code — it thinks, plans, builds, audits,
 * self-corrects, and publishes like a real autonomous engineering agent.
 *
 * Pipeline phases managed by OpenClaw:
 *   Phase 0 — UNDERSTAND  : researchInspirationAI  — design brief from prompt
 *   Phase 1 — PLAN        : analyzeProjectAI        — classify project, draft plan
 *   Phase 1b— PLAN        : refinePlanAI            — user-driven plan iteration
 *   Phase 2 — BUILD       : buildProjectAIParallel  — shared assets + pages in parallel
 *   Phase 3 — AUDIT       : auditProjectAI          — SEO / a11y / mobile / perf audit
 *   Phase 4 — FIX         : autoFixProjectAI        — autonomous self-correction pass
 *   Phase 5 — PUBLISH     : (queue) hero image + live URL deployment
 */

import type { SiteAnalysis, SiteFiles, SitePlan, SitePlanPage } from "./db";
import {
  analyzeProject as analyzeProjectFallback,
  buildProject as buildProjectFallback,
  type BuildResult,
} from "./generator";
import { logger } from "./logger";
import {
  aiComplete,
  aiStream,
  PRIMARY_MODEL,
  SECONDARY_MODEL,
  type AIMessage,
} from "./ai";
import {
  getFullSkillsContext,
  buildEnvironmentContext,
  validateBuildOutput,
  type AgentEnvironment,
  type BuildQualityReport,
} from "./agent-skills";
import {
  clawPhase,
  clawPrompt,
  OPENCLAW_SYSTEM_PREFIX,
} from "./openclaw";

export type { BuildQualityReport };

// WebForge brand logo URL — served from the API server's /static directory
// Falls back to a data-URI badge so generated sites always have branding.
const WEBFORGE_LOGO_URL: string = (() => {
  const domain = process.env["REPLIT_DEV_DOMAIN"] || process.env["PUBLIC_BASE_URL"];
  if (domain) {
    const base = domain.startsWith("http") ? domain : `https://${domain}`;
    return `${base}/static/webforge-logo.jpg`;
  }
  return ""; // CSS fallback badge used instead when no public URL
})();

type PuterAIMessage = AIMessage;
const CODEX_MODEL = PRIMARY_MODEL;
const FAST_MODEL = SECONDARY_MODEL;

// ---------------------------------------------------------------------------
// PHASE 0 — Research / design inspiration
// ---------------------------------------------------------------------------

const RESEARCH_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Phase 0 — 🔍 Research: You are OpenClaw's creative intelligence. Given a project brief, produce a RICH DESIGN BRIEF that makes this site genuinely remarkable — not another cookie-cutter template.

Be bold. Be specific. Think about what would actually impress someone who sees this site.
Consider: What makes this site category interesting? What visual metaphor fits the brand?
What tech stack would elevate the experience? What layout would be unexpected but right?

Return ONLY a JSON object — no prose, no markdown:
{
  "mood": string,            // 1 vivid sentence: "Raw and kinetic — Figma meets a Berlin techno poster"
  "creativeMode": string,    // ONE of: "standard" | "minimal" | "immersive" | "editorial" | "artistic" | "terminal" | "brutalist" | "3d" | "scrollytelling"
  "structureStyle": string,  // ONE of: "multi-page" | "single-page-scroll" | "fullscreen-sections" | "magazine-grid" | "canvas-based"
  "palette": {
    "background": "#hex",   // dark or light base — be decisive, don't default to black
    "surface": "#hex",      // card / elevated surface
    "primary": "#hex",      // dominant brand accent (make it memorable)
    "secondary": "#hex",    // complementary accent
    "text": "#hex",         // body text
    "muted": "#hex"         // subdued labels
  },
  "typography": string,      // Specific font choices from Google Fonts + size scale. E.g. "Display: Syne 900 clamp(4rem,10vw,9rem). Body: DM Sans 400/500 1.1rem."
  "layout": string,          // Specific layout description — be unusual if it fits. "Three-column editorial grid breaks into full-bleed hero sections"
  "competitors": string[],   // 3-4 real reference sites for this aesthetic
  "heroImagePrompt": string, // Vivid 1-sentence image prompt for the AI image generator
  "uniqueTwist": string,     // The one thing that makes this site different: specific, implementable
  "techStack": string[]      // CDN libs to actually use — only include what you'll USE. Examples: "GSAP 3 + ScrollTrigger", "Three.js r160", "Alpine.js 3", "Chart.js 4", "p5.js 1.9", "D3.js 7", "Vue 3 CDN", "React 18 CDN + Babel CDN", "Tone.js", "Lucide icons", etc.
}`;

export interface ResearchBrief {
  mood: string;
  creativeMode?: string;
  structureStyle?: string;
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
  clawPhase("RESEARCH", prompt.slice(0, 80));
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
    const text = await aiComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty research");
    const parsed = JSON.parse(text) as Partial<ResearchBrief>;
    const VALID_CREATIVE_MODES = ["standard","minimal","immersive","editorial","artistic","terminal","brutalist","3d","scrollytelling"];
    const VALID_STRUCTURES = ["multi-page","single-page-scroll","fullscreen-sections","magazine-grid","canvas-based"];
    return {
      mood: parsed.mood ?? fallback.mood,
      creativeMode: VALID_CREATIVE_MODES.includes(parsed.creativeMode ?? "") ? parsed.creativeMode : "standard",
      structureStyle: VALID_STRUCTURES.includes(parsed.structureStyle ?? "") ? parsed.structureStyle : "multi-page",
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

const ANALYSIS_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Phase 1 — 📐 Planning: You are OpenClaw's analytical core. You build ANY kind of website — from brutal portfolio sites to interactive music experiences, from three.js art to restaurant menus, from SaaS dashboards to scrollytelling stories.

Given a user prompt, classify the project and design its structure. ONLY return JSON. No prose.

Schema:
{
  "type": string,                   // Best-fit category — choose from: "saas" | "portfolio" | "restaurant" | "ecommerce" | "event" | "editorial" | "art" | "music" | "game" | "tool" | "bot" | "docs" | "nonprofit" | "personal" | "agency" | "directory" | "website"
  "intent": string,                 // Clean human title (max 60 chars)
  "audience": string | null,        // e.g. "indie game developers", or null
  "features": string[],             // 3-8 SPECIFIC features this site will have
  "pages": string[],                // page slugs — must include "index". Choose pages that make sense for this specific project.
  "styleHints": string[]            // ["minimal","bold","editorial","brutalist","dark","playful","luxury","terminal","3d","artistic","retro", ...]
}

IMPORTANT GUIDELINES:
- Pages must always include "index". Other pages should be specific to this project type.
- Single-page sites: just ["index"] is valid if the project suits it.
- Creative sites can have unusual page names: ["index","manifesto","work","contact"]
- Restaurants: ["index","menu","reservations","about"]
- Portfolio: ["index","work","about","contact"] or just ["index"] for minimal
- Features must be SPECIFIC: not "Hero section" but "Live audio waveform visualizer in hero"
- Let the user's prompt guide the creative direction — read it carefully.`;

export async function analyzeProjectAI(
  prompt: string,
  name?: string,
  model?: string,
): Promise<SiteAnalysis> {
  clawPhase("PLAN", name ?? prompt.slice(0, 60));
  try {
    const messages: PuterAIMessage[] = [
      { role: "system", content: ANALYSIS_SYSTEM },
      { role: "user", content: `Project prompt: ${prompt}\n${name ? `Suggested name: ${name}\n` : ""}Return the JSON.` },
    ];
    const text = await aiComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty analysis");
    const parsed = JSON.parse(text) as Partial<SiteAnalysis>;
    return normalizeAnalysis(parsed, prompt, name);
  } catch (err) {
    logger.warn({ err: String(err) }, "analyzeProjectAI failed; using fallback");
    return analyzeProjectFallback(prompt, name);
  }
}

function normalizeAnalysis(raw: Partial<SiteAnalysis>, prompt: string, name?: string): SiteAnalysis {
  const validTypes = [
    "saas","portfolio","restaurant","ecommerce","event","editorial","art","music",
    "game","tool","bot","docs","nonprofit","personal","agency","directory","website","backend",
  ] as const;
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
// Conversational chat — natural AI reply (no forced structure)
// ---------------------------------------------------------------------------

const CHAT_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

You are talking directly to the user in a conversational context. Behave like a senior engineer colleague — not a chatbot. Be friendly, confident, and natural.

Keep replies to 1–3 sentences. No bullet points, no formal structure, no corporate speak. Say what you mean. If a question naturally leads to building something, suggest it lightly at the end.`;

export async function chatAI(
  siteContext: { name: string; status: string; prompt: string },
  history: PuterAIMessage[],
  model?: string,
): Promise<string> {
  const fallbacks: Record<string, string> = {
    building: "Building it now — check back in a moment.",
    analyzing: "Analyzing your request, almost done.",
    queued: "Queued it up, will start shortly.",
    ready: "On it.",
    awaiting_confirmation: "Got it.",
    default: "Got it, working on that.",
  };
  try {
    const ctx = `Site: "${siteContext.name}" | Status: ${siteContext.status} | Original prompt: ${siteContext.prompt.slice(0, 200)}`;
    const messages: PuterAIMessage[] = [
      { role: "system", content: `${CHAT_SYSTEM}\n\n${ctx}` },
      ...history,
    ];
    const text = await aiComplete(messages, { model: model ?? FAST_MODEL });
    return text.trim() || fallbacks[siteContext.status] || fallbacks.default;
  } catch {
    return fallbacks[siteContext.status] || fallbacks.default;
  }
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
    const text = await aiComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
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

const SHARED_ASSETS_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Phase 2a — ⚙️ Shared Assets (GENERATION MODE): You are OpenClaw's CSS/JS architect. Generate the two shared asset files for this specific project — precisely tailored, not a generic template.

Read the design brief carefully. The CSS and JS you generate should be precisely tailored to:
  • The site's creative mode (minimal, immersive, brutalist, terminal, 3D, editorial, artistic...)
  • The color palette and typography chosen
  • The components the HTML pages will actually use
  • The tech stack (GSAP, Three.js, Alpine.js, Vue, Chart.js, p5.js, etc.)

OUTPUT FORMAT (markers on their OWN line):
===COLOR: #RRGGBB===
===FILE: assets/styles.css===
[comprehensive CSS for THIS project — 400+ lines]
===FILE: assets/app.js===
[focused JavaScript for THIS project — 150+ lines]
===END===

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CSS — DESIGN WHAT THIS SITE NEEDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Always include:
  :root with CSS custom properties (colors from the palette, spacing scale, font stacks)
  Reset + base styles (box-sizing, margin 0, font-family, line-height)
  Typography scale with clamp() for fluid sizing
  Mobile responsive — breakpoints at 768px and 480px minimum
  :focus-visible rings for all interactive elements
  prefers-reduced-motion media query for animations

Then build components specific to THIS creative brief:
  For STANDARD/SAAS: nav (sticky, glass), hero, cards, buttons, testimonials, pricing, footer
  For MINIMAL/PORTFOLIO: clean typography, lots of whitespace, grid for work, minimal nav
  For EDITORIAL: magazine grid, drop caps, pull quotes, reading progress, article cards
  For BRUTALIST: raw grid, oversized type, stark borders, limited palette
  For TERMINAL: monospace throughout, scanline effect, cursor animation, code blocks
  For IMMERSIVE: full-viewport sections, parallax, scroll-driven animations
  For ARTISTIC: canvas container, generative art classes, unconventional layout
  For 3D: Three.js canvas container, overlay UI classes, loading screen

Use CSS features appropriate to the mood:
  Glassmorphism: backdrop-filter:blur() + rgba() background
  Gradient text: background-clip:text, -webkit-text-fill-color:transparent
  Grid: complex CSS grid for editorial/brutalist layouts
  Custom scrollbar if using dark theme
  @keyframes for entrance animations, shimmer, pulse, float, typewriter

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JS — WRITE WHAT THE PAGES WILL CALL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Write JavaScript that the HTML pages will actually use. Examples:
  Nav: hamburger toggle, scroll shadow
  IntersectionObserver for scroll animations (stagger entrance)
  Count-up numbers on scroll
  Form validation with real feedback
  Modal / dialog open/close
  Filter/sort interactions
  Tab switcher pattern
  Theme toggle
  LocalStorage helpers (with try/catch for private browsing)
  Copy to clipboard

If using GSAP: set up ScrollTrigger defaults, common animation helpers
If using Three.js: initialize renderer, scene, camera; export helpers
If using p5.js: sketch factory function, exported for pages to call
If using Alpine.js: register shared component factories
If using Vue 3: register shared composables
If using Chart.js: initChart(id, config) helper, theme colors

Always: remove all console.log. Use event delegation where possible.
Keep only what the HTML pages will call — no dead code.`;

const PAGE_BUILD_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Phase 2b — ⚙️ Page Build (GENERATION MODE): You are OpenClaw's creative page builder. Generate ONE complete HTML page for this project. Apply PLANNING → GENERATION → internal REVIEW before outputting.

You have full creative freedom over structure, layout, and content. Read the design brief carefully:
  • creativeMode tells you the aesthetic approach
  • structureStyle tells you the layout pattern
  • techStack tells you what libraries to use
  • mood, palette, typography, uniqueTwist guide every visual decision

OUTPUT FORMAT:
===FILE: {FILENAME}===
<!doctype html>
[all HTML content]
===END===

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED — every page, no exceptions
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• <!doctype html> with <html lang="en">
• <meta charset="UTF-8">, <meta name="viewport" content="width=device-width, initial-scale=1.0">
• <title>[Page] — [Site]</title> (50-60 chars, keyword-first)
• <meta name="description" content="[specific 140-160 char benefit-led description]">
• og:title, og:description, og:image (picsum.photos URL), og:type, og:url
• <link rel="canonical"> pointing to this page's URL
• <meta name="theme-color" content="[primary color]">
• Inline SVG favicon: <link rel="icon" href="data:image/svg+xml,[your SVG]">
• <link rel="stylesheet" href="assets/styles.css"> (RELATIVE path, no leading slash)
• CDN libraries from the tech stack (GSAP, Three.js, Alpine, Vue, Chart.js, p5, etc.)
• <script src="assets/app.js" defer></script>
• JSON-LD schema (Organization on index, BreadcrumbList on inner pages)
• <a href="#main-content">Skip to main content</a> as first body element
• REAL content — invent specific, plausible details. No placeholders, no Lorem ipsum.
• All images: picsum.photos/seed/[unique-word]/800/500 with descriptive alt=""
• WebForge branding in footer — ALWAYS include this exact block at the bottom of <body>:
  <footer class="wf-credit" style="text-align:center;padding:24px 16px;border-top:1px solid rgba(255,255,255,0.08);margin-top:auto">
    <a href="https://t.me/mkystudiodev" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:10px;text-decoration:none;opacity:0.75;transition:opacity .2s" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.75">
      __WF_LOGO__
      <span style="font-size:12px;letter-spacing:.5px">Built with <strong>WebForge AI</strong> — powered by OpenClaw</span>
    </a>
  </footer>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL-STACK & INTERACTIVE FEATURES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OpenClaw builds COMPLETE, FULLY FUNCTIONAL applications — not just static brochures.

For sites with LOGIN / AUTH pages:
  • Build a fully working login form with email + password validation
  • Use localStorage to persist user sessions: localStorage.setItem('wf_user', JSON.stringify({email, name, loggedIn: true}))
  • On submit: validate fields → show loading state → simulate API call (setTimeout 800ms) → store session → redirect to dashboard
  • "Remember me" checkbox → sessionStorage vs localStorage
  • Logout button: localStorage.removeItem('wf_user') → redirect to login
  • Show/hide password toggle button with eye icon (⚡ actually works)
  • Form validation: required fields, email format, password length, real error messages
  • Auth guard on protected pages: check localStorage on DOMContentLoaded, redirect if not logged in

For sites with DASHBOARD / APP pages:
  • Real data displayed in cards, tables, charts — populated via JavaScript
  • Sidebar navigation with active state highlighting
  • Stats cards with count-up animations
  • Data tables with sorting/filtering capability
  • Chart.js charts with realistic mock data
  • User profile dropdown in nav (pulls from localStorage session)
  • Mobile-responsive sidebar (hamburger toggle)

For EXAM / QUIZ / LEARNING platforms (e.g. ExamAiBot style):
  • Question card interface with multiple-choice options (A/B/C/D)
  • Progress bar showing question X of Y
  • Timer countdown if timed exam (JavaScript setInterval)
  • Answer selection: highlight selected option, prevent re-selection after submit
  • Submit button → show correct/incorrect feedback with explanation
  • Score calculation and results summary page
  • Leaderboard table with mock student scores
  • Category/subject selector for different exam types
  • "Start Exam" → "Questions" → "Results" flow using JS state machine
  • Student registration form → practice history stored in localStorage

For E-COMMERCE sites:
  • Product grid with real product cards (image, name, price, "Add to Cart" button)
  • Shopping cart with localStorage persistence
  • Cart item count badge in navbar (updates live)
  • Add/remove from cart with quantity controls
  • Checkout form with validation
  • Order summary calculation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UI QUALITY — MANDATORY STANDARDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALL buttons MUST have:
  • onclick handler or href — no dead buttons
  • :hover state with visual feedback (background, shadow, scale transform)
  • :active state for press feedback
  • cursor: pointer
  • Minimum 44px tap target

ALL forms MUST have:
  • Input validation on submit (required fields, email format, etc.)
  • Real error messages displayed near the relevant field
  • Loading state on submit button ("Processing…" text + disabled)
  • Success feedback after submission
  • No form that just refreshes the page without handling

ALL navigation MUST:
  • Highlight the current page's nav link (active state)
  • Work on mobile (hamburger menu for screens < 768px)
  • Smooth scroll for anchor links

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATIVE DIRECTION — be specific, be bold
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read the brief. Design the page structure that ACTUALLY SERVES this project.

HOME PAGE (index.html): The homepage should make someone say "wow" in the first 3 seconds.
  Design sections that demonstrate the product/brand/art — not generic marketing sections.
  Use the uniqueTwist described in the brief.
  Apply the creativeMode faithfully:
    • STANDARD: polished hero → value prop → features → social proof → CTA → footer
    • MINIMAL: bold typography, negative space, let the work speak
    • IMMERSIVE: fullscreen sections, scroll-driven reveals, parallax, atmospheric
    • EDITORIAL: magazine grid, multiple content types, reading-first experience
    • ARTISTIC: break convention — p5.js/Three.js canvas, unexpected layout, visual poetry
    • TERMINAL: monospace, typewriter effects, command-prompt aesthetics
    • BRUTALIST: raw grid, oversized type, confrontational, stark
    • 3D: Three.js scene as hero, interactive 3D product/art
    • SCROLLYTELLING: narrative flow, sections that tell a story as you scroll

INNER PAGES: Build what this page actually needs.
  • Portfolio pages: large work grid, case study layout
  • Menu pages: scannable categories and items, visual food presentation  
  • About pages: team, story, mission — human and personal
  • Contact pages: human, accessible form + alternative contact methods
  • Docs pages: clear navigation, code blocks, examples
  Be creative with the layout — inner pages don't need to be boring.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTERACTIVITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If tech stack includes:
  Alpine.js: x-data, x-show, x-for, x-transition — tabs, toggles, modals, live demos
  Vue 3 CDN: createApp({setup(){...}}).mount('#app') — reactive UI, computed, watch
  React 18 CDN: <script type="text/babel"> with useState, useEffect — component UI
  Chart.js: responsive:true, maintainAspectRatio:false, fixed-height wrapper
  GSAP: timeline animations, ScrollTrigger for scroll-driven reveals
  Three.js: renderer, scene, camera, animate loop, resize handler
  p5.js: new p5(sketch, document.getElementById('canvas-container'))
  D3.js: data-driven SVG with scales, axes, transitions
  Tone.js: Synth, Player with play/stop UI controls`;



// ---------------------------------------------------------------------------
// Typed error — thrown when the AI model is genuinely unreachable.
// Callers that want to distinguish "AI offline" from other build errors
// can catch this specifically.
// ---------------------------------------------------------------------------

export class AgentUnavailableError extends Error {
  readonly isAgentUnavailable = true;
  readonly isQuotaError: boolean;
  constructor(reason: string, isQuota = false) {
    super(reason);
    this.name = "AgentUnavailableError";
    this.isQuotaError = isQuota;
  }
}

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
    creativeMode: research.creativeMode ?? "standard",
    structureStyle: research.structureStyle ?? "multi-page",
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
      content: `Site name: ${intentName}
Project: ${originalPrompt}
Plan summary: ${plan.summary}
Features: ${plan.features.join(", ")}
Pages: ${plan.pages.map(p => p.path).join(", ")}
Creative mode: ${research.creativeMode ?? "standard"}
Structure: ${research.structureStyle ?? "multi-page"}
Unique twist to implement: ${research.uniqueTwist}
${paletteNote}${techStackNote}

Generate the shared assets/styles.css and assets/app.js tailored to this specific creative brief.
CSS: comprehensive for this project's needs (400+ lines typical, more if complex).
JS: focused and practical — only what the pages will actually use.`,
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
    creativeMode: research.creativeMode ?? "standard",
    structureStyle: research.structureStyle ?? "multi-page",
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
Creative mode: ${research.creativeMode ?? "standard"}
Structure style: ${research.structureStyle ?? "multi-page"}
Unique twist: ${research.uniqueTwist}
Features to mention: ${plan.features.slice(0, 6).join(", ")}
${isHome ? `\nThis is the HOME page. Apply the creative mode faithfully. Make it impressive — use the uniqueTwist, the palette, the tech stack. Build sections that serve THIS project specifically.` : `\nThis is the ${page.title} inner page. Design it for its purpose — not a generic template.`}
${retryNote}

Output the FILE marker then the complete HTML, then ===END===.`,
    },
  ];

  try {
    const result = await streamParseFiles(messages, {}, async () => {}, model ?? CODEX_MODEL);
    const files: SiteFiles = {};
    const logoImg = WEBFORGE_LOGO_URL
      ? `<img src="${WEBFORGE_LOGO_URL}" alt="WebForge AI" style="height:28px;width:auto;vertical-align:middle">`
      : `<span style="font-weight:800;letter-spacing:-1px;background:linear-gradient(135deg,#3b82f6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent">WF</span>`;
    for (const [k, v] of Object.entries(result.files)) {
      if (v && v.trim().length > 100) {
        // Replace the __WF_LOGO__ placeholder with the actual logo element
        files[k] = v.replace(/__WF_LOGO__/g, logoImg);
      }
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
    logger.warn({ err: String(err) }, "buildProjectAIStream failed — agent unavailable");
    const isQuota = String(err).includes("insufficient_funds");
    throw new AgentUnavailableError(
      err instanceof Error ? err.message : String(err),
      isQuota,
    );
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

  await aiStream(
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

const AUDIT_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Phase 3 — 🔬 Quality Audit (REVIEW MODE): You are OpenClaw's autonomous QA engine. Review this website's file list and HTML summaries. Identify real, specific, actionable issues — not generic advice.

Focus on:
- SEO: missing meta description, og tags, canonical URL, JSON-LD schema, heading hierarchy (h1 → h2 → h3 order)
- Accessibility (WCAG 2.1 AA): images without alt text, buttons without labels, missing ARIA roles, no skip-nav link, form inputs without labels
- Mobile: fixed pixel widths over 100vw, small tap targets (<44px), overflow:hidden missing on body
- Performance: render-blocking scripts in <head> without defer/async, missing lazy loading on images
- Content: Lorem ipsum, placeholder [COMPANY] or [NAME] text, stub sections with < 50 words
- Code: invalid HTML structure, broken relative links, missing closing tags
- UI Quality — CRITICAL: buttons without onclick/href handlers (dead buttons), forms that don't call event.preventDefault() (causes page refresh), missing :hover/:focus styles on interactive elements, inputs without proper type attributes
- Login/Auth: login forms without client-side validation JS, no password show/hide toggle, no loading state on submit, no error message display
- Navigation: nav links that don't work (href="#" with no scroll handler), hamburger menu icon without toggle JS, active page not highlighted in nav
- Dashboard/App pages: empty data sections, charts without data, tables without rows, stats cards showing 0 or placeholder values

Return ONLY a JSON array of up to 12 issues (prioritize critical and high):
[
  {
    "severity": "critical"|"high"|"medium"|"low",
    "category": "seo"|"accessibility"|"mobile"|"performance"|"content"|"code",
    "file": "<filename>",
    "issue": "<specific description>",
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

    const text = await aiComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
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

const AUTOFIX_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Phase 4 — 🔧 Self-Correction (FIX MODE): You are OpenClaw's autonomous repair system. You receive a website's files and a prioritized list of QA issues. Fix them all — this is your autonomous self-correction pass.

Fix ALL issues listed. Return a JSON object mapping filename → complete fixed file content.
Return ONLY files that need changes. Unchanged files must NOT be included.

Rules:
- Fix every issue precisely and completely
- Do NOT remove existing content or functionality
- Do NOT change the visual design or layout
- For SEO: add proper <meta> tags, JSON-LD structured data, og: tags
- For accessibility: add aria-label, role, alt text, skip-nav link, :focus-visible styles
- For content: replace Lorem Ipsum / placeholder text with relevant real content
- For mobile: replace fixed px widths with max-width or % equivalents
- Keep all existing HTML structure; only patch what's needed

Return JSON: { "<filename>": "<complete fixed file content>", ... }`;

// Max chars to send per file in autofix. We only send HTML files for text/SEO
// fixes; JS and CSS files are skipped unless they are small enough to send
// whole — sending truncated JS/CSS and replacing the original with a partial
// response is the #1 cause of broken sites after the QA pass.
const AUTOFIX_MAX_FILE_CHARS = 20_000;

export async function autoFixProjectAI(
  files: SiteFiles,
  issues: AuditIssue[],
  model?: string,
): Promise<SiteFiles> {
  if (issues.length === 0) return files;

  try {
    // Only fix issues whose file is small enough to send whole.
    // Skip large JS/CSS files — a truncated fix is worse than no fix.
    const fixableIssues = issues.filter((i) => {
      const content = files[i.file];
      if (!content) return false;
      // Never send large JS/CSS through autofix (truncation breaks them)
      if ((i.file.endsWith(".js") || i.file.endsWith(".css")) && content.length > AUTOFIX_MAX_FILE_CHARS) {
        return false;
      }
      return true;
    });

    if (fixableIssues.length === 0) {
      logger.info("autoFixProjectAI: all issues are in large JS/CSS files — skipping to preserve site integrity");
      return files;
    }

    const affectedFiles = new Set(fixableIssues.map((i) => i.file));
    const filesToFix: SiteFiles = {};
    for (const f of affectedFiles) {
      if (files[f]) {
        // Send the complete file — never truncate. If it's too big skip it.
        if (files[f].length <= AUTOFIX_MAX_FILE_CHARS) {
          filesToFix[f] = files[f];
        }
      }
    }

    if (Object.keys(filesToFix).length === 0) return files;

    const issuesSummary = fixableIssues
      .map((i, n) => `${n + 1}. [${i.severity.toUpperCase()}] ${i.file}: ${i.issue} → Fix: ${i.fix}`)
      .join("\n");

    const messages: PuterAIMessage[] = [
      { role: "system", content: AUTOFIX_SYSTEM },
      {
        role: "user",
        content: `Issues to fix:\n${issuesSummary}\n\nFiles to update:\n${JSON.stringify(filesToFix, null, 2)}\n\nReturn JSON with fixed files only.`,
      },
    ];

    const text = await aiComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) return files;

    const fixedFiles = JSON.parse(text) as Record<string, unknown>;
    const result: SiteFiles = { ...files };
    for (const [path, content] of Object.entries(fixedFiles)) {
      if (typeof content !== "string") continue;
      if (files[path] === undefined) continue;
      const original = files[path];
      // Safety: never replace a file with a version that lost more than 25% of
      // its content — this catches the AI returning truncated output.
      const minAcceptableLength = Math.floor(original.length * 0.75);
      if (content.length < minAcceptableLength) {
        logger.warn({ path, originalLen: original.length, fixedLen: content.length },
          "autoFixProjectAI: rejected fix — too short vs original (likely truncated)");
        continue;
      }
      // For HTML: require closing </html> to catch mid-stream cuts
      if (path.endsWith(".html") && !content.toLowerCase().includes("</html>")) {
        logger.warn({ path }, "autoFixProjectAI: rejected HTML fix — missing </html>");
        continue;
      }
      result[path] = content;
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

const BUILD_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Phase 2 — ⚙️ Build (GENERATION MODE): You are OpenClaw's build engine. Generate a complete, production-quality static website as JSON. Apply PLANNING → GENERATION → internal REVIEW before outputting.

DECISION ENGINE:
- Landing page / promo / ad → single-page (index.html only)
- Business site / portfolio / service → multi-page structure
- SaaS / dashboard / tool → web application structure with clear navigation

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
1. Each HTML file MUST be a complete <!doctype html> document — never truncated.
2. Every page links to "assets/styles.css" and "assets/app.js" with relative paths.
3. Inter-page links use relative paths. Fully mobile-responsive. Real content — no Lorem Ipsum.
4. index.html: minimum 10 distinct sections. Inner pages: 350+ lines each.
5. coverColor: single hex color. Valid JSON only.
6. NEVER generate placeholder comments. NEVER skip navigation consistency.`;

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
    const text = await aiComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty build response");
    const parsed = JSON.parse(text) as { coverColor?: string; files?: Record<string, unknown> };
    const files = sanitizeFiles(parsed.files, plan);
    if (Object.keys(files).length === 0) throw new Error("no files produced");
    const coverColor = isHex(parsed.coverColor) ? parsed.coverColor! : "#7CC7FF";
    return { files, coverColor, name: intentName };
  } catch (err) {
    logger.warn({ err: String(err) }, "buildProjectAI failed — agent unavailable");
    const isQuota = String(err).includes("insufficient_funds");
    throw new AgentUnavailableError(
      err instanceof Error ? err.message : String(err),
      isQuota,
    );
  }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

const EDIT_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Phase — 🔧 Edit (FIX MODE + GENERATION MODE): You are OpenClaw's edit engine. A user wants to modify an existing website. Understand the instructions deeply, apply changes precisely, then internally review the result before outputting.

You NEVER rebuild blindly. You modify existing projects incrementally and intelligently.

Return ONLY a JSON object: { "coverColor": "#RRGGBB", "files": { "<path>": "<content>", ... } }

Rules:
- Return COMPLETE updated file contents for every file you change.
- Include ALL files (even unchanged ones) for atomic replacement.
- Keep the same nav structure and inter-page link consistency across all pages.
- Do not break existing working functionality.
- For "add dark mode", "make it more futuristic", "add a pricing section" — apply intelligently.
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
    const text = await aiComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
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

// ---------------------------------------------------------------------------
// ROADMAP GENERATOR — Multi-phase product roadmap with OpenClaw
// ---------------------------------------------------------------------------

export interface RoadmapPhase {
  phase: number;
  title: string;
  duration: string;
  priority: "must-have" | "should-have" | "nice-to-have";
  features: string[];
  milestone: string;
  techStack: string[];
}

export interface ProductRoadmap {
  productName: string;
  productType: string;
  tagline: string;
  summary: string;
  targetAudience: string;
  coreValueProp: string;
  phases: RoadmapPhase[];
  buildPrompt: string;        // Enhanced prompt to pass to the build pipeline
  estimatedBuildTime: string;
}

const ROADMAP_SYSTEM = `${OPENCLAW_SYSTEM_PREFIX}

Mode: PLANNING (Roadmap Generation). You are OpenClaw's product strategist and architect. A user has described a product idea. Generate a detailed, multi-phase product roadmap that will guide the build pipeline.

Think like a senior product manager + technical architect. Ask yourself:
- What is the core user problem being solved?
- What are the must-have features for MVP vs nice-to-have?
- What is the right tech stack for this product type?
- What makes this product special vs competitors?

Apply the DECISION ENGINE:
- "landing page / promo" → single-phase, 1 milestone, STANDARD build
- "business website / portfolio / blog" → 2-3 phases, MULTI-PAGE build
- "SaaS / dashboard / tool / AI platform" → 3-4 phases, WEB APPLICATION build
- "exam platform / quiz / learning app / education tech" → 3 phases with auth + content + analytics
- "e-commerce / store" → 3 phases with products + cart + checkout
- "social platform / community" → 4 phases with auth + content + social + moderation

Return ONLY a JSON object:
{
  "productName": string,
  "productType": string,
  "tagline": string,
  "summary": string,
  "targetAudience": string,
  "coreValueProp": string,
  "phases": [
    {
      "phase": 1,
      "title": string,
      "duration": "Week 1-2",
      "priority": "must-have",
      "features": ["specific feature 1", "specific feature 2", ...],
      "milestone": "What is working at end of this phase",
      "techStack": ["HTML5", "CSS3", "Alpine.js", ...]
    }
  ],
  "buildPrompt": "A comprehensive, detailed build prompt that captures all requirements",
  "estimatedBuildTime": "~3 minutes with OpenClaw"
}

Rules:
- Phase 1 is always the MVP / core product (must-have only)
- Later phases add depth, polish, advanced features
- Features must be SPECIFIC — not "add auth" but "Email + password login with localStorage session persistence"
- buildPrompt must be a rich, comprehensive description for the build pipeline
- Maximum 4 phases for any product
- Each phase has 3-7 features`;

export async function generateRoadmapAI(
  productIdea: string,
  model?: string,
): Promise<ProductRoadmap> {
  clawPhase("UNDERSTAND", productIdea.slice(0, 80));

  const fallback: ProductRoadmap = {
    productName: productIdea.slice(0, 40),
    productType: "website",
    tagline: "Built with WebForge AI",
    summary: productIdea,
    targetAudience: "General users",
    coreValueProp: productIdea,
    phases: [{
      phase: 1,
      title: "MVP Launch",
      duration: "Week 1",
      priority: "must-have",
      features: ["Homepage", "Core functionality", "Mobile responsive design", "Contact/CTA section"],
      milestone: "Fully working MVP deployed",
      techStack: ["HTML5", "CSS3", "JavaScript", "Alpine.js"],
    }],
    buildPrompt: productIdea,
    estimatedBuildTime: "~2 minutes with OpenClaw",
  };

  try {
    const messages: PuterAIMessage[] = [
      { role: "system", content: ROADMAP_SYSTEM },
      { role: "user", content: `Product idea: "${productIdea}"\n\nGenerate a multi-phase product roadmap. Return JSON only.` },
    ];
    const text = await aiComplete(messages, { model: model ?? CODEX_MODEL, jsonMode: true });
    if (!text) throw new Error("empty roadmap response");
    const parsed = JSON.parse(text) as Partial<ProductRoadmap>;

    return {
      productName: parsed.productName ?? fallback.productName,
      productType: parsed.productType ?? fallback.productType,
      tagline: parsed.tagline ?? fallback.tagline,
      summary: parsed.summary ?? fallback.summary,
      targetAudience: parsed.targetAudience ?? fallback.targetAudience,
      coreValueProp: parsed.coreValueProp ?? fallback.coreValueProp,
      phases: Array.isArray(parsed.phases) && parsed.phases.length > 0
        ? parsed.phases.slice(0, 4) as RoadmapPhase[]
        : fallback.phases,
      buildPrompt: parsed.buildPrompt ?? productIdea,
      estimatedBuildTime: parsed.estimatedBuildTime ?? fallback.estimatedBuildTime,
    };
  } catch (err) {
    logger.warn({ err: String(err) }, "generateRoadmapAI failed; using fallback");
    return fallback;
  }
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

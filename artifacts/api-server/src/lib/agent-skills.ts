/**
 * WebForge Agent Skills — the agent's accumulated experience and creative intelligence.
 *
 * The agent should feel FREE to build anything: artistic portfolios, Three.js experiences,
 * brutalist grids, terminal UIs, magazine layouts, interactive music players, game landing
 * pages, minimalist one-pagers, immersive scrollytelling — whatever serves the user best.
 *
 * These skills are guidelines, not templates. The agent reads the brief, picks the right
 * approach, and builds something that genuinely impresses.
 */

import type { SitePlan } from "./db";
import type { ResearchBrief } from "./llm-generator";

// ---------------------------------------------------------------------------
// Core design principles (guidelines, not rules)
// ---------------------------------------------------------------------------

export const DESIGN_PRINCIPLES = `
DESIGN PRINCIPLES:
• Visual hierarchy: one dominant element per screen, supporting elements, accents.
• Negative space is a design element — dense walls of text are bad design.
• Color contrast: readable text on all backgrounds (4.5:1 minimum WCAG).
• Type scale: use clamp() for fluid fluid sizing, never fixed px for headings.
• Every interactive element deserves :hover, :focus-visible, :active states.
• Motion: entrance ≤600ms, hover ≤250ms. Always respect prefers-reduced-motion.
• Images: picsum.photos with unique seed per image + descriptive alt text.
• When in doubt: go bolder. Timid design rarely impresses.
`;

// ---------------------------------------------------------------------------
// SEO knowledge
// ---------------------------------------------------------------------------

export const SEO_SKILLS = `
SEO (every page):
• <title>: 50-60 chars, keyword-first. Format: "Keyword — Brand Name"
• <meta name="description">: 140-160 chars, benefit-led.
• og:title, og:description, og:image, og:type, og:url
• <link rel="canonical"> on every page
• One <h1> per page. H1→H2→H3 hierarchy never skipped.
• JSON-LD: Organization on index.html, BreadcrumbList on inner pages.
• All images: descriptive alt= (or alt="" for purely decorative).
• <html lang="en">
`;

// ---------------------------------------------------------------------------
// Accessibility knowledge
// ---------------------------------------------------------------------------

export const A11Y_SKILLS = `
ACCESSIBILITY (WCAG 2.1 AA):
• <a href="#main-content">Skip to main content</a> as first body element.
• All images: non-empty alt text (or alt="" decorative only).
• Inputs: <label for="id"> linked. No placeholder-only labels.
• Buttons: aria-label if icon-only. All interactive elements keyboard-reachable.
• Color: never communicate meaning by color alone.
• <nav aria-label="Main navigation">. Semantic <header>, <main>, <footer>.
• [x-cloak] { display: none !important; } if using Alpine.js.
• Animated elements: @media (prefers-reduced-motion: reduce).
`;

// ---------------------------------------------------------------------------
// Expanded tech stack knowledge
// ---------------------------------------------------------------------------

export const TECH_STACK_SKILLS = `
AVAILABLE TECHNOLOGIES (pick what fits the project):

ANIMATION & 3D:
• GSAP 3 (CDN) — professional timeline animations, ScrollTrigger, SplitText
• Three.js r160 (CDN) — 3D scenes, WebGL, particles, shaders
• p5.js 1.9 (CDN) — generative art, creative coding, canvas art
• Anime.js 3 (CDN) — lightweight DOM/SVG animation
• Lottie (CDN) — JSON animation playback
• CSS-only: @keyframes, clip-path, custom properties, scroll-driven animations (2024)

DATA & INTERACTIVITY:
• Chart.js 4 (CDN) — bar, line, pie, radar, scatter charts
• D3.js 7 (CDN) — data-driven SVG visualizations, custom charts
• Alpine.js 3 (CDN) — lightweight reactivity, x-data, x-show, x-for
• React 18 (CDN + Babel CDN) — component-based UI in browser without build step
• Vue 3 (CDN) — createApp, ref, reactive, v-for, v-if — no build step needed
• Htmx (CDN) — HTML-first interactivity, hx-get, hx-swap

AUDIO & CREATIVE:
• Tone.js (CDN) — Web Audio API, synthesizers, samplers
• Howler.js (CDN) — audio playback with spatial audio
• Web Audio API (native) — no CDN needed, available in all browsers

ICONS & UI:
• Lucide icons (CDN) — clean SVG icon system
• Font Awesome 6 (CDN) — extensive icon library  
• Phosphor Icons (CDN) — flexible icon weights
• Hero Icons — inline SVG, no CDN needed
• Emoji — valid, zero-dependency icon choice for playful sites

FONTS (Google Fonts CDN):
• Any Google Font — Inter, Space Grotesk, DM Sans, Playfair Display, JetBrains Mono, Syne, Cabinet Grotesk, etc.
• Variable fonts preferred for performance

CHOOSE based on the project's mood and needs. Don't add libraries you won't use.
`;

// ---------------------------------------------------------------------------
// Creative modes
// ---------------------------------------------------------------------------

export const CREATIVE_MODES = `
CREATIVE APPROACHES — read the brief and choose:

STANDARD (business, SaaS, service sites):
  Sticky nav → hero → sections → footer. Polished, professional, converts well.

MINIMAL (portfolio, personal, editorial):
  Lots of whitespace. Typography-led. Maybe no nav at all. Let content breathe.

IMMERSIVE (games, entertainment, music, events):
  Full-viewport sections. Parallax. Sound. Video. GSAP scroll animations.

EDITORIAL (blog, magazine, publication, journalism):
  Magazine grid. Drop caps. Pull quotes. Reading progress indicator. Dark/light toggle.

ARTISTIC (art portfolio, creative studio, experimental):
  Break the grid. p5.js or Three.js canvas. Unexpected layouts. Be unconventional.

TERMINAL (developer tool, CLI, hacker aesthetic):
  Monospace fonts. Green-on-black or phosphor colors. Typewriter effects. Code blocks.

BRUTALIST (fashion, bold agency, counter-culture):
  Oversized type. Bold colors. No padding. Raw grid. Borders as design elements.

3D / IMMERSIVE (product showcase, metaverse, tech):
  Three.js hero scene. WebGL shaders. 3D product viewer. Particle effects.

GAME LANDING (game release, app launch, event):
  Cinematic header. Trailer video embed. Countdown timer. Discord/social widgets.

SCROLLYTELLING (story, narrative, journalism, case study):
  Long-form scroll. Sections that animate in on scroll. Narrative pacing.
`;

// ---------------------------------------------------------------------------
// Code quality patterns
// ---------------------------------------------------------------------------

export const CODE_PATTERNS = `
CODE PATTERNS THAT WORK:
• Nav hamburger: data-open attribute on <nav>, CSS [data-open] shows menu.
• Smooth scroll: scroll-behavior:smooth on :root.
• IntersectionObserver: threshold:0.15, rootMargin:'-60px'. Add class 'visible'.
• Count-up: requestAnimationFrame loop, easeOutQuart, trigger on intersect.
• Chart.js: responsive:true, maintainAspectRatio:false, fixed-height wrapper div.
• Alpine.js: x-cloak on hidden elements, x-data on container.
• Tab: x-data="{tab:'home'}" x-show="tab==='home'" x-transition on panels.
• Modal: <dialog id="m"> + btn.addEventListener('click', () => m.showModal()).
• Form: validate on 'submit'. Inline errors. localStorage save.
• Filter: data-category on cards, JS toggles display.
• GSAP ScrollTrigger: gsap.from(el, {y:60,opacity:0,scrollTrigger:{trigger:el,start:'top 85%'}})
• Three.js minimal: renderer, scene, camera, animate loop, resize handler.
• p5.js: new p5(sketch, containerEl) for embedded canvas (not fullscreen).
• Vue 3 CDN: const {createApp,ref,computed} = Vue; createApp({setup(){...}}).mount('#app')
• React CDN: const {useState,useEffect} = React; — works with Babel CDN in <script type="text/babel">
`;

// ---------------------------------------------------------------------------
// Lessons learned — absolute hard rules
// ---------------------------------------------------------------------------

export const LESSONS_LEARNED = `
NEVER DO THESE — they break the build or embarrass the user:
✗ Lorem ipsum, placeholder text, [COMPANY NAME], [YOUR NAME], TBD stubs.
✗ Generic copy: "We offer world-class solutions." Write specific, real, benefit-led copy.
✗ Empty sections with only a heading and no body content.
✗ Root-relative paths "/assets/styles.css" — always use relative "assets/styles.css".
✗ Inline CSS on every element instead of stylesheet classes.
✗ Missing doctype <!doctype html>.
✗ Broken inter-page links (wrong filename, leading slash).
✗ Charts without a canvas element — Chart.js needs <canvas>.
✗ Alpine.js without [x-cloak] CSS rule — content flashes.
✗ Icon-only buttons without aria-label.
✗ Images without alt attribute.
✗ JSON-LD without "@context":"https://schema.org".
✗ console.log() left in production JS.
✗ CSS transitions on width/height — use transform instead.
✗ Missing WebForge credit in footer.
✗ Adding CDN libraries you never actually use in the code.
`;

// ---------------------------------------------------------------------------
// Environment awareness
// ---------------------------------------------------------------------------

export interface AgentEnvironment {
  model: string;
  siteName: string;
  siteType: string;
  pageCount: number;
  features: string[];
  mood: string;
  techStack: string[];
  buildAttempt: number;
  creativeMode?: string;
  structureStyle?: string;
  previousIssues?: string[];
}

export function buildEnvironmentContext(env: AgentEnvironment): string {
  const lines: string[] = [
    `AGENT ENVIRONMENT:`,
    `  Model: ${env.model}`,
    `  Site: "${env.siteName}" (${env.siteType})`,
    `  Pages to build: ${env.pageCount}`,
    `  Features: ${env.features.join(", ")}`,
    `  Visual mood: ${env.mood}`,
    `  Tech stack: ${env.techStack.join(", ")}`,
    `  Creative mode: ${env.creativeMode ?? "standard"}`,
    `  Structure: ${env.structureStyle ?? "multi-page"}`,
    `  Build attempt: ${env.buildAttempt}`,
  ];
  if (env.previousIssues && env.previousIssues.length > 0) {
    lines.push(`  Previous build issues to fix:`);
    for (const issue of env.previousIssues) lines.push(`    - ${issue}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Full skills context (injected into build prompts)
// ---------------------------------------------------------------------------

export function getFullSkillsContext(
  plan: SitePlan,
  research: ResearchBrief,
  _env?: Partial<AgentEnvironment>,
): string {
  const sections: string[] = [
    DESIGN_PRINCIPLES,
    SEO_SKILLS,
    A11Y_SKILLS,
    TECH_STACK_SKILLS,
    CREATIVE_MODES,
    CODE_PATTERNS,
    LESSONS_LEARNED,
  ];

  const typeSpecific = getTypeSpecificSkills(plan.type, research);
  if (typeSpecific) sections.push(typeSpecific);

  return sections.join("\n");
}

function getTypeSpecificSkills(type: string, research: ResearchBrief): string {
  const mode = research.creativeMode ?? "standard";
  const base = getBaseTypeSkills(type);
  const modeSkills = getModeSkills(mode);
  return [base, modeSkills].filter(Boolean).join("\n");
}

function getBaseTypeSkills(type: string): string {
  switch (type) {
    case "saas":
    case "website":
      return `
SAAS / STARTUP EXPERIENCE:
• Social proof is everything: logos, testimonials, case study snippets, press quotes.
• CTAs must be specific: "Start free trial" > "Get started" > "Learn more".
• Pricing tables: yearly/monthly toggle (Alpine.js). Highlight recommended plan.
• FAQ: cover real objections users have before buying.
• Show the dashboard/product — don't just describe it.
`;
    case "portfolio":
      return `
PORTFOLIO EXPERIENCE:
• Let the WORK speak — large images, minimal UI chrome.
• Case study format: problem → approach → solution → outcome.
• Typography is the personality. Choose fonts that reflect the creator's aesthetic.
• The "About" section should feel personal, not corporate.
• Contact section: make it easy and human. No "send message" corporate forms.
`;
    case "restaurant":
    case "food":
      return `
RESTAURANT / FOOD EXPERIENCE:
• Food photography is everything — large, appetizing images dominate.
• Menu must be scannable: categories, items, prices, dietary icons.
• Reservations: link to OpenTable or build a simple date-picker form.
• Hours, address, phone — above the fold, always visible.
• Use warm color palettes. Food looks best with warm tones.
`;
    case "ecommerce":
    case "shop":
      return `
ECOMMERCE EXPERIENCE:
• Product grid: image, name, price, add-to-cart. Clean, scannable.
• Product detail: multiple angles, description, reviews, trust badges.
• Trust signals: secure checkout badge, return policy, reviews count.
• Alpine.js cart: x-data cart state, add/remove/total — no backend needed for demo.
• Show real products with plausible prices, not "Product Name - $XX.XX".
`;
    case "event":
    case "conference":
      return `
EVENT EXPERIENCE:
• Countdown timer to event date is mandatory.
• Speaker grid: photo, name, title, company, talk title.
• Schedule: day/track grid with session times.
• Ticket tiers: early bird, standard, VIP with clear value differentiation.
• Venue: embedded map or illustrated location card.
`;
    case "editorial":
    case "blog":
    case "publication":
      return `
EDITORIAL / BLOG EXPERIENCE:
• Reading experience: optimal line length (60-75ch), generous line-height (1.7).
• Article cards: image, category tag, title, excerpt, author, read time.
• Dark/light toggle — readers prefer choice.
• Progress bar on article pages (CSS or JS scroll tracker).
• Typography hierarchy: pull quotes, drop caps, subheadings that aid scanning.
`;
    case "art":
    case "creative":
    case "experimental":
      return `
CREATIVE / ART EXPERIENCE:
• Break conventional layout rules intentionally and skillfully.
• Use the canvas (Three.js, p5.js, WebGL) as the hero if it fits.
• Typography can be oversized, rotated, layered, or masked.
• Color can be brutal, monochrome, or carefully curated.
• Let the user feel something — surprise, delight, intrigue.
• Navigation can be unconventional (floating, minimal, hidden until hover).
`;
    case "music":
    case "audio":
      return `
MUSIC / AUDIO EXPERIENCE:
• Audio visualizer: Web Audio API or p5.js frequency analysis.
• Album art: full-bleed, high-impact visuals.
• Track listing: play/pause controls, progress bar, track info.
• Tone.js for in-browser audio playback demos.
• Dark themes work best for music — the music is the light.
`;
    case "game":
      return `
GAME / INTERACTIVE EXPERIENCE:
• Cinematic header: video background or Three.js particle scene.
• Trailer section: embedded YouTube/iframe, autoplay muted, lazy load.
• Feature breakdown: illustrated cards for game mechanics.
• Community: Discord widget or link, player count stats.
• Release countdown or launch CTA with Steam/App Store links.
`;
    case "tool":
    case "app":
      return `
TOOL / APP EXPERIENCE:
• Show the tool WORKING — live interactive demo on the homepage (Alpine.js / Vue).
• "How it works" with 3-4 numbered steps, specific and clear.
• Show before/after or input/output to demonstrate value instantly.
• User roles or use cases — show different people using it differently.
`;
    case "bot":
      return `
BOT EXPERIENCE:
• Example conversation in a chat-bubble UI — show it working.
• Commands/capabilities: specific list of what it does.
• Integration logos: which platforms (Slack, Discord, Telegram, etc.).
• Pricing: free tier, usage limits, paid plan features.
`;
    case "docs":
    case "documentation":
      return `
DOCUMENTATION EXPERIENCE:
• Sidebar navigation: collapsible sections, current page indicator.
• Code blocks: syntax highlighted (Prism.js CDN or highlight.js CDN), copy button.
• Breadcrumbs, next/prev navigation at bottom of each page.
• Search bar (even if visual-only for static sites).
• Clear version indicator if versioned product.
`;
    case "nonprofit":
    case "charity":
      return `
NONPROFIT EXPERIENCE:
• Lead with impact: numbers, stories, faces of people helped.
• Donation CTA: prominent, frequent, emotionally framed.
• Transparency: show where money goes (pie chart or illustrated breakdown).
• Volunteer section: low-friction sign-up, show volunteer stories.
• Mission statement: clear, specific, not generic.
`;
    default:
      return `
GENERAL EXPERIENCE:
• Build what the user actually asked for, not a generic template.
• Read the prompt carefully — the user's words contain the design direction.
• If in doubt about what sections to include, ask "does this help the user achieve their goal?"
`;
  }
}

function getModeSkills(mode: string): string {
  switch (mode) {
    case "immersive":
      return `
IMMERSIVE MODE:
• Full-viewport sections (100vh). Smooth scroll snapping.
• GSAP ScrollTrigger for section entrance animations.
• Parallax backgrounds on hero and section dividers.
• Sound design consideration: provide play/mute toggle if using audio.
`;
    case "minimal":
      return `
MINIMAL MODE:
• Typography IS the design. Choose one beautiful font family and use it masterfully.
• Maximum 2 colors + white/black. Every pixel earns its place.
• Generous whitespace — sections can be 120px+ padding.
• No decorative elements that don't carry meaning.
`;
    case "3d":
      return `
3D MODE:
• Three.js scene as hero: basic renderer, scene, camera, animate loop.
• Keep polygon count manageable — use BoxGeometry, SphereGeometry, TorusGeometry.
• OrbitControls for interactive rotation if appropriate.
• Particle system: Points with BufferGeometry for starfields or data viz.
• Resize handler: renderer.setSize + camera.aspect update.
`;
    case "artistic":
      return `
ARTISTIC MODE:
• p5.js sketch embedded in the hero — generative art that responds to mouse/time.
• SVG animations using CSS custom properties as animation drivers.
• Clip-path: polygon() for unusual shapes and reveals.
• Mix-blend-mode for creative color overlapping effects.
• Cursor: custom cursor that reacts to hovering elements.
`;
    case "terminal":
      return `
TERMINAL MODE:
• JetBrains Mono or similar monospace throughout.
• Background: #0d1117 or true #000000. Text: #00ff41 or #d4d4d4.
• Typewriter effect on key text elements (JS setInterval).
• Fake terminal prompts for section headers: "$ cat about.txt"
• ASCII art or box-drawing characters for decorative elements.
• Scanline CSS overlay for CRT effect.
`;
    case "brutalist":
      return `
BRUTALIST MODE:
• Oversized type. Font-size: clamp(4rem, 15vw, 14rem) for main headings.
• Bold borders (4px+ solid), raw grid, no border-radius.
• Limited palette: black, white, one bold accent (red, yellow, electric blue).
• No drop shadows. No gradients. Flat and confrontational.
• Asymmetric layouts: text over images, overlapping elements.
`;
    case "editorial":
      return `
EDITORIAL MODE:
• Magazine grid: CSS grid with irregular column/row spans.
• Drop cap on first paragraph: float:left, font-size:4.5em, line-height:0.85.
• Pull quotes: large (2rem+), accented border-left, italic.
• Reading progress bar: fixed top, width driven by scroll%.
• Category tags: uppercase, letter-spacing:0.12em, small.
`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Build output validator — content-quality focused, not line-count focused
// ---------------------------------------------------------------------------

export interface QualityIssue {
  type: "missing_file" | "stub_page" | "placeholder_content" | "too_small" | "missing_meta" | "broken_pattern";
  file: string;
  detail: string;
  severity: "critical" | "high" | "medium";
}

export interface BuildQualityReport {
  passed: boolean;
  score: number; // 0–100
  totalBytes: number;
  issues: QualityIssue[];
  weakPages: string[]; // pages that need regeneration
  summary: string;
}

export function validateBuildOutput(
  files: Record<string, string>,
  plan: SitePlan,
): BuildQualityReport {
  const issues: QualityIssue[] = [];
  const weakPages: string[] = [];

  // Check each page — content quality, not line count
  for (const page of plan.pages) {
    const filename =
      page.path === "index"
        ? "index.html"
        : page.path.endsWith(".html")
          ? page.path
          : `${page.path}.html`;
    const content = files[filename] ?? "";
    const bytes = content.length;

    // Absolute minimum: must exist and have substance
    const minBytes = page.path === "index" ? 6_000 : 3_000;

    if (!content || bytes < 500) {
      issues.push({
        type: "missing_file",
        file: filename,
        detail: `Page was not generated (${bytes} bytes)`,
        severity: "critical",
      });
      weakPages.push(filename);
      continue;
    }

    if (bytes < minBytes) {
      issues.push({
        type: "stub_page",
        file: filename,
        detail: `Only ${(bytes / 1024).toFixed(1)} KB — this page needs more content`,
        severity: "critical",
      });
      weakPages.push(filename);
      continue;
    }

    // Content quality checks
    const hasLorem = /lorem ipsum/i.test(content);
    const hasPlaceholder = /\[COMPANY\]|\[NAME\]|\[PLACEHOLDER\]|\[YOUR/i.test(content)
      || /\bTBD\b|Coming Soon\.|Placeholder Content|TODO:/i.test(content);
    const hasMissingDoctype = !content.toLowerCase().startsWith("<!doctype");
    const hasMissingH1 = !/<h1[\s>]/i.test(content);

    if (hasLorem) {
      issues.push({ type: "placeholder_content", file: filename, detail: "Lorem ipsum found — replace with real content", severity: "high" });
      if (bytes < minBytes * 1.5) weakPages.push(filename);
    }
    if (hasPlaceholder) {
      issues.push({ type: "placeholder_content", file: filename, detail: "Unfilled placeholder text [BRACKETS] found", severity: "high" });
    }
    if (hasMissingDoctype) {
      issues.push({ type: "broken_pattern", file: filename, detail: "Missing <!doctype html>", severity: "critical" });
      weakPages.push(filename);
    }
    if (hasMissingH1 && page.path === "index") {
      issues.push({ type: "missing_meta", file: filename, detail: "No <h1> on home page", severity: "high" });
    }
  }

  // Check CSS — must exist and have substance
  const css = files["assets/styles.css"] ?? "";
  if (css.length < 1_500) {
    issues.push({
      type: "too_small",
      file: "assets/styles.css",
      detail: `Only ${(css.length / 1024).toFixed(1)} KB — stylesheet is too thin`,
      severity: "critical",
    });
    weakPages.push("assets/styles.css");
  }

  // Check JS — must exist
  const js = files["assets/app.js"] ?? "";
  if (js.length < 300) {
    issues.push({
      type: "too_small",
      file: "assets/app.js",
      detail: `Only ${js.length} bytes — JS file is missing or stub`,
      severity: "critical",
    });
  }

  // Total size sanity check
  const totalBytes = Object.values(files).reduce((s, v) => s + v.length, 0);
  if (totalBytes < 15_000) {
    issues.push({
      type: "too_small",
      file: "all files",
      detail: `Total ${(totalBytes / 1024).toFixed(1)} KB — site is too thin`,
      severity: "critical",
    });
  }

  // Score
  let deduction = 0;
  for (const issue of issues) {
    if (issue.severity === "critical") deduction += 25;
    else if (issue.severity === "high") deduction += 10;
    else deduction += 5;
  }
  const score = Math.max(0, 100 - deduction);
  const passed = weakPages.length === 0 && score >= 70;

  const criticals = issues.filter((i) => i.severity === "critical").length;
  const highs = issues.filter((i) => i.severity === "high").length;
  const summary = passed
    ? `Quality gate passed — ${(totalBytes / 1024).toFixed(1)} KB, ${Object.keys(files).length} files, score ${score}/100`
    : `Quality gate FAILED — score ${score}/100 · ${criticals} critical · ${highs} high · ${weakPages.length} pages need rebuild · ${(totalBytes / 1024).toFixed(1)} KB total`;

  return { passed, score, totalBytes, issues, weakPages, summary };
}

// ---------------------------------------------------------------------------
// Agent build log
// ---------------------------------------------------------------------------

export interface BuildLogEntry {
  timestamp: string;
  phase: number;
  event: string;
  detail?: string;
}

export class AgentBuildLog {
  private entries: BuildLogEntry[] = [];
  private startTime = Date.now();

  log(phase: number, event: string, detail?: string): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      phase,
      event,
      detail,
    });
  }

  getSummary(): string {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const lines = [`Build log (${elapsed}s elapsed):`];
    for (const e of this.entries.slice(-20)) {
      lines.push(`  [Phase ${e.phase}] ${e.event}${e.detail ? `: ${e.detail}` : ""}`);
    }
    return lines.join("\n");
  }

  getIssues(): string[] {
    return this.entries
      .filter((e) => e.event.startsWith("ISSUE") || e.event.startsWith("RETRY") || e.event.startsWith("FAILED"))
      .map((e) => `${e.event}: ${e.detail ?? ""}`);
  }

  toJSON(): BuildLogEntry[] {
    return [...this.entries];
  }
}

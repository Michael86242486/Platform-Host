/**
 * WebForge Agent Skills — the agent's accumulated experience and domain
 * knowledge. This gets injected into every build prompt so the AI
 * "knows" what great looks like before it starts building.
 *
 * Think of this file as the agent's training manual. Add to it over time
 * to continuously improve output quality without touching any other code.
 */

import type { SitePlan } from "./db";
import type { ResearchBrief } from "./llm-generator";

// ---------------------------------------------------------------------------
// Core design principles
// ---------------------------------------------------------------------------

export const DESIGN_PRINCIPLES = `
DESIGN PRINCIPLES (always apply):
• Every page needs visual hierarchy: one dominant element, 2-3 supporting, rest are accents.
• Negative space is content. Dense walls of text = bad design.
• Color contrast: text on dark bg must be ≥4.5:1. Use rgba(255,255,255,0.85) not rgba(255,255,255,0.4).
• Type scale: use clamp() for fluid sizing. Never fixed px for font-size on headings.
• Spacing: use a 8px base grid. 8, 16, 24, 32, 48, 64, 96, 128px.
• Every interactive element must have :hover, :focus-visible, and :active states.
• Images: always picsum.photos with a UNIQUE seed per image + descriptive alt text.
• Motion: entrance animations ≤600ms. Hover transitions ≤250ms.
`;

// ---------------------------------------------------------------------------
// SEO knowledge
// ---------------------------------------------------------------------------

export const SEO_SKILLS = `
SEO REQUIREMENTS (every page, no exceptions):
• <title>: 50-60 chars, keyword-first. Format: "Keyword — Brand Name"
• <meta name="description">: 140-160 chars. Benefit-led, no keyword stuffing.
• <meta property="og:title">, og:description, og:image (picsum URL), og:type, og:url
• <link rel="canonical"> pointing to the page's own URL
• One <h1> per page. H1 → H2 → H3 hierarchy — never skip levels.
• Inline JSON-LD: Organization schema on index.html, BreadcrumbList on inner pages.
• All <img> have descriptive alt= attributes. Decorative images: alt="".
• <meta name="robots" content="index, follow"> on all pages.
• <html lang="en">
`;

// ---------------------------------------------------------------------------
// Accessibility knowledge
// ---------------------------------------------------------------------------

export const A11Y_SKILLS = `
ACCESSIBILITY REQUIREMENTS (WCAG 2.1 AA):
• <a href="#main-content">Skip to main content</a> as first element in <body>.
• All images: non-empty alt text (or alt="" for decorative only).
• All form inputs: <label for="id"> linked to <input id="id">. No placeholder-only labels.
• All buttons: aria-label if they contain only an icon, or visible text.
• All interactive elements reachable via Tab key. Visible :focus-visible ring.
• Color: never communicate meaning by color alone (add icon/text too).
• <nav> has aria-label="Main navigation". <main> has role="main" or is <main>.
• <header>, <main>, <footer> as semantic landmarks.
• Dialogs: <dialog> with role="dialog" aria-modal="true" aria-labelledby.
• [x-cloak] { display: none !important; } MUST be in CSS for Alpine.js.
• Animated elements: respect prefers-reduced-motion media query.
`;

// ---------------------------------------------------------------------------
// Performance knowledge
// ---------------------------------------------------------------------------

export const PERFORMANCE_SKILLS = `
PERFORMANCE REQUIREMENTS:
• All <img> tags: loading="lazy" (except above-fold hero image which gets loading="eager").
• CDN scripts in <head>: Chart.js, Lucide with no defer needed (they're fast).
• Alpine.js: use defer attribute: <script defer src="...alpinejs..."></script>
• Custom <script> at bottom of <body> or use defer.
• assets/app.js: one JS file, keep dependencies minimal, use event delegation.
• CSS: avoid @import inside stylesheet (use <link> tags instead).
• Animate with transform/opacity only (GPU-composited). Avoid animating width/height/top/left.
`;

// ---------------------------------------------------------------------------
// Code quality patterns
// ---------------------------------------------------------------------------

export const CODE_PATTERNS = `
CODE PATTERNS THAT WORK:
• Nav hamburger: data-open attribute on <nav>, CSS [data-open] shows menu. JS toggles attribute.
• Smooth scroll: scroll-behavior:smooth on :root + JS with scrollIntoView({behavior:'smooth',block:'start'}).
• IntersectionObserver: threshold:0.15, rootMargin:'0px 0px -60px 0px'. Add class 'visible'.
• Count-up: requestAnimationFrame loop, easeOutQuart easing, trigger on intersect.
• Chart.js: always set responsive:true, maintainAspectRatio:false, and wrap canvas in a div with fixed height.
• Alpine.js: x-cloak on hidden elements, x-data on container, x-show with transitions.
• Tab pattern: x-data="{tab:'home'}" with x-show="tab==='home'" x-transition on panels.
• Modal: <dialog id="myModal"> + btn.addEventListener('click', () => modal.showModal()).
• Form: validate on 'submit' event. Show inline errors. Store success to localStorage.
• Filter: data-category attribute on cards. JS hides/shows based on filter value.
• Sort: map → sort → append pattern on a container's children.
• LocalStorage: always try/catch (private browsing throws).
`;

// ---------------------------------------------------------------------------
// Lessons learned — what to AVOID
// ---------------------------------------------------------------------------

export const LESSONS_LEARNED = `
LESSONS LEARNED — NEVER DO THESE:
✗ Lorem ipsum, placeholder text, [COMPANY NAME], [YOUR NAME], TBD, Coming Soon stubs.
✗ Generic copy: "We are a leading company offering solutions." Write specific, benefit-led copy.
✗ Empty sections: every section must have real content, not just a heading.
✗ index.html under 400 lines — it will fail QA and be rejected.
✗ assets/styles.css under 400 lines — use ALL the component classes the JS depends on.
✗ Missing :root CSS variables — they make theming consistent and are required.
✗ Root-relative paths: "/assets/styles.css" — ALWAYS use relative: "assets/styles.css".
✗ Inline CSS on every element — use CSS classes from the stylesheet.
✗ Missing nav on inner pages — every page shares the same sticky nav.
✗ Fixed pixel widths > 600px in mobile CSS — use max-width or %.
✗ Charts without canvas elements — Chart.js NEEDS a <canvas id="myChart">.
✗ Alpine.js without x-cloak CSS rule — content flashes on load.
✗ Buttons with no accessible text — screen readers will announce "button" with no context.
✗ Images with no alt= attribute — accessibility failure.
✗ JSON-LD with invalid schema — always use "@context":"https://schema.org".
✗ console.log in production JS — remove all debug logs.
✗ CSS transitions on width/height — use transform:scaleX/scaleY instead.
✗ Missing WebForge credit in footer — it's legally required.
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
  env?: Partial<AgentEnvironment>,
): string {
  const usesCharts = research.techStack.some((s) => s.includes("Chart"));
  const usesAlpine = research.techStack.some((s) => s.includes("Alpine"));

  const sections: string[] = [
    DESIGN_PRINCIPLES,
    SEO_SKILLS,
    A11Y_SKILLS,
    PERFORMANCE_SKILLS,
    CODE_PATTERNS,
    LESSONS_LEARNED,
  ];

  if (usesCharts) {
    sections.push(`
CHART.JS EXPERIENCE:
• Always: <canvas id="uniqueId" style="max-height:300px"></canvas> inside a div.
• Always: { responsive: true, maintainAspectRatio: false } in options.
• Call Chart.js AFTER the DOM is ready (DOMContentLoaded or end of body).
• Multiple charts: each needs its own canvas ID.
• Dark mode: use rgba(255,255,255,0.1) for gridlines, rgba(255,255,255,0.7) for labels.
• Real data: generate 6-12 realistic data points. Name months/labels specifically.
`);
  }

  if (usesAlpine) {
    sections.push(`
ALPINE.JS EXPERIENCE:
• [x-cloak] { display: none !important; } MUST be in CSS.
• Tab pattern: x-data="{active:'tab1'}" on container, x-show="active==='tab1'" on panels.
• Click handlers: x-on:click="active='tab2'" or shorthand @click.
• Conditionals: x-if removes from DOM. x-show only hides (prefer x-show for animations).
• Loops: x-for="item in items" :key="item.id" on <template>.
• Two-way binding: x-model on inputs.
• Lifecycle: x-init runs on mount.
• Keep x-data objects on parent, reference in children with $data.
`);
  }

  const typeSpecific = getTypeSpecificSkills(plan.type);
  if (typeSpecific) sections.push(typeSpecific);

  return sections.join("\n");
}

function getTypeSpecificSkills(type: string): string {
  switch (type) {
    case "website":
      return `
WEBSITE EXPERIENCE:
• Brochure sites need social proof (logos, testimonials, case studies) to build trust.
• CTAs must be specific: "Start free trial" > "Get started" > "Learn more" > "Click here".
• Pricing tables: show yearly/monthly toggle. Highlight the recommended plan.
• FAQ reduces support burden — include real questions users would actually ask.
`;
    case "tool":
      return `
TOOL/APP EXPERIENCE:
• Show the tool actually WORKING on the homepage — not just a screenshot.
• Use Alpine.js to build a live interactive demo with sample data.
• Onboarding: "How it works" section with 3-4 numbered steps is essential.
• Show different user roles or views if applicable (free/pro, admin/user).
`;
    case "bot":
      return `
BOT EXPERIENCE:
• Show example conversations in a chat-bubble UI on the homepage.
• List the specific use cases / commands the bot handles.
• Integration logos: show which platforms it connects to (Slack, Discord, etc).
`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Build output validator
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
  weakPages: string[]; // pages that need to be regenerated
  summary: string;
}

export function validateBuildOutput(
  files: Record<string, string>,
  plan: SitePlan,
): BuildQualityReport {
  const issues: QualityIssue[] = [];
  const weakPages: string[] = [];

  // Check each page
  for (const page of plan.pages) {
    const filename =
      page.path === "index"
        ? "index.html"
        : page.path.endsWith(".html")
          ? page.path
          : `${page.path}.html`;
    const content = files[filename] ?? "";
    const lines = content.split("\n").length;
    const minLines = page.path === "index" ? 350 : 200;

    if (!content || content.trim().length < 100) {
      issues.push({
        type: "missing_file",
        file: filename,
        detail: `Page was not generated (${content.length} bytes)`,
        severity: "critical",
      });
      weakPages.push(filename);
    } else if (lines < minLines) {
      issues.push({
        type: "stub_page",
        file: filename,
        detail: `Only ${lines} lines — minimum ${minLines} required`,
        severity: "critical",
      });
      weakPages.push(filename);
    } else {
      // Check for placeholder content
      const hasLorem = /lorem ipsum/i.test(content);
      const hasPlaceholder =
        /\[COMPANY\]|\[NAME\]|\[PLACEHOLDER\]|\[YOUR/i.test(content) ||
        /TBD\b|Coming Soon|Placeholder|TODO/i.test(content);
      const hasMissingDoctype = !content.toLowerCase().startsWith("<!doctype");
      const hasMissingH1 = !/<h1[\s>]/i.test(content);

      if (hasLorem) {
        issues.push({ type: "placeholder_content", file: filename, detail: "Lorem ipsum found", severity: "high" });
        if (lines < minLines * 1.5) weakPages.push(filename);
      }
      if (hasPlaceholder) {
        issues.push({ type: "placeholder_content", file: filename, detail: "Placeholder text [BRACKETS] found", severity: "high" });
      }
      if (hasMissingDoctype) {
        issues.push({ type: "broken_pattern", file: filename, detail: "Missing <!doctype html>", severity: "critical" });
        weakPages.push(filename);
      }
      if (hasMissingH1 && page.path === "index") {
        issues.push({ type: "missing_meta", file: filename, detail: "No <h1> found on home page", severity: "high" });
      }
    }
  }

  // Check CSS
  const css = files["assets/styles.css"] ?? "";
  const cssLines = css.split("\n").length;
  if (cssLines < 150) {
    issues.push({ type: "too_small", file: "assets/styles.css", detail: `Only ${cssLines} lines — minimum 400 required`, severity: "critical" });
    weakPages.push("assets/styles.css");
  } else if (cssLines < 300) {
    issues.push({ type: "too_small", file: "assets/styles.css", detail: `Only ${cssLines} lines — should be 600+`, severity: "high" });
  }

  // Check JS
  const js = files["assets/app.js"] ?? "";
  const jsLines = js.split("\n").length;
  if (jsLines < 50) {
    issues.push({ type: "too_small", file: "assets/app.js", detail: `Only ${jsLines} lines — minimum 120 required`, severity: "critical" });
  }

  // Total bytes
  const totalBytes = Object.values(files).reduce((s, v) => s + v.length, 0);
  if (totalBytes < 20_000) {
    issues.push({ type: "too_small", file: "all files", detail: `Total ${(totalBytes / 1024).toFixed(1)} KB — minimum 20 KB. Site is too thin.`, severity: "critical" });
  }

  // Score: start at 100, deduct per issue severity
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
// Self-inspection: read logs + environment state
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

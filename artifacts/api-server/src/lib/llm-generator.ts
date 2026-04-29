/**
 * LLM-powered WebForge generator. Wraps the deterministic fallbacks from
 * generator.ts with calls to OpenAI for high-quality output.
 *
 * - analyzeProjectAI: ask the model to classify the project, name it,
 *   list features, pages, and style hints. Falls back to rules on error.
 * - buildProjectAI: ask the model to produce a complete multi-page static
 *   site (HTML + shared CSS + tiny JS) from the plan. Falls back to the
 *   template renderer on error.
 */

import { openai } from "@workspace/integrations-openai-ai-server";

import type { SiteAnalysis, SiteFiles, SitePlan } from "./db";
import {
  analyzeProject as analyzeProjectFallback,
  buildProject as buildProjectFallback,
  type BuildResult,
} from "./generator";
import { logger } from "./logger";

const TEXT_MODEL = "gpt-4o";
const MAX_TOKENS = 16384;

// ---------------------------------------------------------------------------
// PHASE 1 — Analysis (LLM)
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
): Promise<SiteAnalysis> {
  try {
    const completion = await openai.chat.completions.create({
      model: TEXT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM },
        {
          role: "user",
          content: `Project prompt: ${prompt}\n${
            name ? `Suggested name: ${name}\n` : ""
          }Return the JSON.`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("empty analysis");
    const parsed = JSON.parse(text) as Partial<SiteAnalysis>;
    return normalizeAnalysis(parsed, prompt, name);
  } catch (err) {
    logger.warn({ err: String(err) }, "analyzeProjectAI failed; using fallback");
    return analyzeProjectFallback(prompt, name);
  }
}

function normalizeAnalysis(
  raw: Partial<SiteAnalysis>,
  prompt: string,
  name?: string,
): SiteAnalysis {
  const validTypes = ["website", "bot", "backend", "tool"] as const;
  const type = (validTypes as readonly string[]).includes(raw.type as string)
    ? (raw.type as SiteAnalysis["type"])
    : "website";
  const features =
    Array.isArray(raw.features) && raw.features.length > 0
      ? raw.features.slice(0, 8).map(String)
      : ["Hero", "About", "Contact"];
  const pagesRaw =
    Array.isArray(raw.pages) && raw.pages.length > 0
      ? raw.pages.map((p) => String(p).toLowerCase().replace(/[^a-z0-9]/g, ""))
      : ["index", "about", "contact"];
  const pages = Array.from(new Set(["index", ...pagesRaw])).slice(0, 8);
  const styleHints = Array.isArray(raw.styleHints)
    ? raw.styleHints.slice(0, 5).map(String)
    : [];
  const intent =
    (typeof raw.intent === "string" && raw.intent.trim()) ||
    name?.trim() ||
    deriveTitle(prompt);
  return {
    type,
    intent: intent.slice(0, 60),
    audience:
      typeof raw.audience === "string" && raw.audience.trim()
        ? raw.audience.trim().slice(0, 80)
        : null,
    features,
    pages,
    styleHints,
  };
}

function deriveTitle(prompt: string): string {
  const t = prompt.trim().split(/[.,;:!?\n]/)[0].slice(0, 60);
  return t || "Untitled";
}

// ---------------------------------------------------------------------------
// PHASE 2 — Build (LLM produces real multi-file static site)
// ---------------------------------------------------------------------------

const BUILD_SYSTEM = `You are WebForge, a top-tier frontend engineer + designer. Generate a complete, production-quality static website as JSON.

You receive:
- name: the brand/site name
- prompt: the user's original description (use it as the source of truth for tone, content, and details)
- plan: structured analysis (features, pages, palette/mood)

Return ONLY a JSON object of this shape:
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
2. Every page links to "assets/styles.css" and "assets/app.js" with relative paths (no leading slash).
3. Inter-page links use relative paths (e.g. href="about.html"), NEVER root-relative.
4. Include a shared <header> nav on every page that links every page in the plan.
5. Mobile-responsive. Modern CSS (flex, grid, clamp). Beautiful gradients, generous spacing, large headings.
6. Real, specific copy that matches the prompt — no generic Lorem Ipsum, no placeholder names. Reference the user's actual idea.
7. Add subtle interactivity (form handling, smooth scroll, fade-in via IntersectionObserver) in assets/app.js. Keep JS small and dependency-free.
8. coverColor is a single hex (the dominant accent for the brand card).
9. NO external CDN scripts/fonts/images. Use system fonts and CSS-only visuals (gradients, SVG inlined sparingly). Emojis as accents are OK.
10. Output must be valid JSON. Escape strings properly.
11. Add a footer to every HTML page with EXACTLY this snippet just before </body>: <footer class="webforge-credit" style="text-align:center;padding:20px 16px;font-size:12px;letter-spacing:0.04em;color:rgba(120,120,140,0.85);border-top:1px solid rgba(120,120,140,0.15);margin-top:48px">made with <strong style="color:inherit">(kidderboy)</strong></footer>

Aim for a polished, modern aesthetic — think Linear, Vercel, Stripe, Bolt.new, Apple. Dark or light is fine; pick what fits the prompt.`;

// ---------------------------------------------------------------------------
// PHASE 2-STREAM — Build with token-by-token streaming using a simple
// delimiter format so the client can render partial HTML in real time.
// ---------------------------------------------------------------------------

const BUILD_STREAM_SYSTEM = `You are WebForge, a top-tier frontend engineer + designer. You are building a REAL, SUBSTANTIAL, PRODUCTION-QUALITY multi-page website — the kind a paying client would accept and a YC team would ship. You stream the whole project using a simple delimiter format. NO JSON. NO markdown code fences.

OUTPUT FORMAT (each marker on its OWN line, NO extra text):
===COLOR: #RRGGBB===
===FILE: assets/styles.css===
<raw file contents>
===FILE: assets/app.js===
<raw file contents>
===FILE: index.html===
<!doctype html>
<raw file contents>
===FILE: <other-page>.html===
...
===END===

Rules:
1. Start with ONE ===COLOR: #XXXXXX=== line — a single hex (the dominant brand accent).
2. For each file, emit ===FILE: <relative-path>=== on its own line then the raw file contents until the next ===FILE: or ===END=== marker.
3. STREAM FILES IN THIS ORDER: assets/styles.css FIRST, then assets/app.js, then index.html, then other pages alphabetically.
4. Each HTML file is a complete <!doctype html> document with proper <head> (title, meta description, og:title, og:description, og:image, theme-color, favicon as inline data:image/svg+xml).
5. Pages link to "assets/styles.css" and "assets/app.js" via RELATIVE paths (no leading slash).
6. Inter-page links use relative paths (e.g. href="about.html"), NEVER root-relative.
7. Shared sticky <header> nav on every page links every page in the plan, plus a primary CTA button. Shared <footer> with three+ link columns + contact line on every page.
8. Mobile-responsive (clamp, grid, flex). Beautiful gradients, generous spacing, large display headings (clamp(2.5rem, 6vw, 5rem)).
9. End with ===END=== on its OWN line.
10. Add the WebForge credit footer EXACTLY (place it inside the regular <footer>, just above the closing tag): <div class="webforge-credit" style="text-align:center;padding:20px 16px;font-size:12px;letter-spacing:0.04em;color:rgba(120,120,140,0.85);border-top:1px solid rgba(120,120,140,0.15);margin-top:24px">made with <strong style="color:inherit">(kidderboy)</strong></div>

DEPTH & SIZE — THIS IS NOT NEGOTIABLE:
- Build AT LEAST 4 pages (index + 3 more drawn from the plan). 5-7 is ideal.
- index.html MUST contain ALL of these distinct full-width sections, in order:
  1. Hero (display headline, subhead, two CTAs, hero visual on the right — inline SVG illustration OR a gradient-card mockup. NO external image URLs.)
  2. Logo cloud / social proof row (6-10 fake-but-believable customer/partner names typeset in muted style — NO real images, just styled text in a flex row).
  3. Feature grid: 6+ feature cards (icon SVG + title + 2-3 sentence description each).
  4. "How it works" — 3 or 4 numbered steps with rich paragraph copy.
  5. Showcase / product walkthrough — 2-3 alternating left/right image-text rows. The "image" is a designed CSS card (gradient + shapes + typography), not a placeholder.
  6. Testimonials — 3+ quote cards with name, role, company, avatar (CSS circle with initials).
  7. Pricing OR comparison table OR stats band (pick whichever fits the project) — at least 3 columns / 4 stats.
  8. FAQ — 6+ questions with substantive answers (use <details><summary> for native accordions).
  9. Final CTA band — heading, subhead, primary button.
  10. Footer (with the credit block above).
- Every other HTML page MUST be at least 250 LINES of meaningful, prompt-specific content (never a stub).
- assets/styles.css MUST be 400+ lines: CSS variables, fluid type scale, design tokens, utility classes, hero, header, nav, buttons, cards, grid, sections, forms, footer, dark-on-default OR light-on-default theme — pick one and execute it well, with hover/focus states everywhere.
- assets/app.js: 80+ lines. Handles: mobile nav toggle, smooth-scroll, IntersectionObserver fade-ins on .reveal, simple form validation with inline error messages, header shadow on scroll.

CONTENT QUALITY:
- Every word is specific to the user's prompt. Names, numbers, quotes — invent plausible real-feeling specifics. Zero Lorem Ipsum, zero "Your Company Here", zero "Lorem", zero "Insert text".
- Headlines are punchy and benefit-led. Subheads are 1-2 sentences max.
- Body copy uses concrete nouns and verbs.
- Reference real-feeling customer names ("Maya from Form & Fold", "the team at Halcyon Labs"), real-feeling cities, real-feeling industry terminology.

VISUALS WITHOUT EXTERNAL FILES:
- NO external CDN scripts, fonts, or image URLs. System font stack only. All visuals are inline SVG, CSS gradients, CSS shapes, or unicode/emoji glyphs (used sparingly as accents).
- Inline SVG icons for every feature card (24x24 stroked icons, currentColor).
- The hero "screenshot" is a designed CSS card (gradient background + faux UI chrome made from flex rows + typography) — NOT a placeholder image.

FILE-SIZE TARGET: the FULL output (all files combined) must exceed 30KB of source. A 5KB site is a failure. Aim for 60-120KB across the whole project.

If the user prompt sounds like a SaaS, ship it like Linear/Vercel/Stripe. If it's editorial/blog-y, ship it like Ghost/Substack with real article snippets and bylines. If it's an agency or studio, ship it like Pentagram or Locomotive (case-study cards). If it's a restaurant/local biz, ship menus, hours, location card, gallery built from CSS.`;

export type StreamUpdate = {
  coverColor: string;
  files: SiteFiles;
  currentFile: string | null;
  bytes: number;
};

export async function buildProjectAIStream(
  plan: SitePlan,
  intentName: string,
  originalPrompt: string,
  onUpdate: (u: StreamUpdate) => Promise<void> | void,
): Promise<BuildResult> {
  try {
    const planSummary = {
      name: intentName,
      type: plan.type,
      summary: plan.summary,
      pages: plan.pages.map((p) => ({
        path: p.path,
        title: p.title,
        purpose: p.purpose,
        sections: p.sections,
      })),
      features: plan.features,
      palette: plan.styles.palette,
      mood: plan.styles.mood,
    };

    const stream = await openai.chat.completions.create({
      model: TEXT_MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: [
        { role: "system", content: BUILD_STREAM_SYSTEM },
        {
          role: "user",
          content: `name: ${intentName}\n\nprompt: ${originalPrompt}\n\nplan: ${JSON.stringify(planSummary, null, 2)}`,
        },
      ],
    });

    let buffer = "";
    let coverColor = "#7CC7FF";
    let currentFile: string | null = null;
    let bytes = 0;
    const files: Record<string, string> = {};
    let lastFlush = 0;
    let pendingFlush = false;

    const flush = async (force: boolean) => {
      if (pendingFlush && !force) return;
      const now = Date.now();
      if (!force && now - lastFlush < 220) return;
      pendingFlush = true;
      try {
        // Snapshot files (drop fences/markdown if model misbehaved)
        const snapshot: SiteFiles = {};
        for (const [k, v] of Object.entries(files)) snapshot[k] = v;
        await onUpdate({
          coverColor,
          files: snapshot,
          currentFile,
          bytes,
        });
        lastFlush = now;
      } finally {
        pendingFlush = false;
      }
    };

    const consumeLine = (rawLine: string): void => {
      const line = rawLine;
      const colorMatch = line.match(/^===COLOR:\s*(#[0-9a-fA-F]{6})\s*===\s*$/);
      const fileMatch = line.match(/^===FILE:\s*(.+?)\s*===\s*$/);
      const endMatch = line.match(/^===END===\s*$/);
      if (colorMatch) {
        coverColor = colorMatch[1];
        return;
      }
      if (fileMatch) {
        const sanitized = sanitizeOnePath(fileMatch[1]);
        currentFile = sanitized;
        if (sanitized && !(sanitized in files)) files[sanitized] = "";
        return;
      }
      if (endMatch) {
        currentFile = null;
        return;
      }
      if (currentFile) {
        files[currentFile] = (files[currentFile] ?? "") + line + "\n";
        bytes += line.length + 1;
      }
    };

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (!delta) continue;
      buffer += delta;

      // Process all completed lines.
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        consumeLine(line);
        nl = buffer.indexOf("\n");
      }

      // Also append the in-flight (pre-newline) buffer as a transient tail
      // to the current file so the iframe shows live partial HTML. We undo
      // it on the next iteration by re-overwriting the same key.
      if (currentFile) {
        const stable = files[currentFile] ?? "";
        const transient = stable + buffer;
        // Don't permanently store the transient tail in `files` (would
        // double-count when we later consume the line). Instead temporarily
        // patch a snapshot for the flush.
        const now = Date.now();
        if (now - lastFlush > 220 && !pendingFlush) {
          pendingFlush = true;
          try {
            const snapshot: SiteFiles = { ...files, [currentFile]: transient };
            await onUpdate({
              coverColor,
              files: snapshot,
              currentFile,
              bytes: bytes + buffer.length,
            });
            lastFlush = now;
          } finally {
            pendingFlush = false;
          }
        }
      } else {
        await flush(false);
      }
    }

    // Final newline-less remainder
    if (buffer.length > 0) {
      consumeLine(buffer);
      buffer = "";
    }
    await flush(true);

    const cleaned = sanitizeFiles(files, plan);
    if (Object.keys(cleaned).length === 0) throw new Error("no files produced");
    return { files: cleaned, coverColor, name: intentName };
  } catch (err) {
    logger.warn(
      { err: String(err) },
      "buildProjectAIStream failed; using fallback",
    );
    return buildProjectFallback(plan, intentName);
  }
}

function sanitizeOnePath(raw: string): string | null {
  const p = raw.trim().replace(/^\/+/, "");
  if (!p || p.length > 200) return null;
  if (p.includes("..")) return null;
  if (!/^[a-zA-Z0-9._\-/]+$/.test(p)) return null;
  return p;
}

export async function buildProjectAI(
  plan: SitePlan,
  intentName: string,
  originalPrompt: string,
): Promise<BuildResult> {
  try {
    const planSummary = {
      name: intentName,
      type: plan.type,
      summary: plan.summary,
      pages: plan.pages.map((p) => ({
        path: p.path,
        title: p.title,
        purpose: p.purpose,
        sections: p.sections,
      })),
      features: plan.features,
      palette: plan.styles.palette,
      mood: plan.styles.mood,
    };

    const completion = await openai.chat.completions.create({
      model: TEXT_MODEL,
      response_format: { type: "json_object" },
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: BUILD_SYSTEM },
        {
          role: "user",
          content: `name: ${intentName}\n\nprompt: ${originalPrompt}\n\nplan: ${JSON.stringify(planSummary, null, 2)}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("empty build response");

    const parsed = JSON.parse(text) as {
      coverColor?: string;
      files?: Record<string, unknown>;
    };
    const files = sanitizeFiles(parsed.files, plan);
    if (Object.keys(files).length === 0) throw new Error("no files produced");

    const coverColor = isHex(parsed.coverColor) ? parsed.coverColor! : "#7CC7FF";
    return { files, coverColor, name: intentName };
  } catch (err) {
    logger.warn({ err: String(err) }, "buildProjectAI failed; using fallback");
    return buildProjectFallback(plan, intentName);
  }
}

function isHex(v: unknown): boolean {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function sanitizeFiles(
  raw: Record<string, unknown> | undefined,
  plan: SitePlan,
): SiteFiles {
  if (!raw || typeof raw !== "object") return {};
  const out: SiteFiles = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") continue;
    // Strip leading slashes to keep paths relative.
    const path = k.replace(/^\/+/, "");
    if (path.length === 0 || path.length > 200) continue;
    if (path.includes("..")) continue;
    out[path] = v;
  }
  // Guarantee an index.html exists.
  if (!out["index.html"]) {
    const homePage = plan.pages[0];
    if (homePage && out[homePage.path]) {
      out["index.html"] = out[homePage.path];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PHASE 3 — Edit (LLM patches existing files based on edit instructions)
// ---------------------------------------------------------------------------

const EDIT_SYSTEM = `You are WebForge, modifying an existing static website based on a user's edit instructions.

You receive the current files (path -> content) and edit instructions.
Return ONLY a JSON object with the SAME shape:
{ "coverColor": "#RRGGBB", "files": { "<path>": "<content>", ... } }

Rules:
- Return the COMPLETE new file contents for any file you change.
- Include ALL files (even unchanged ones) so we can replace the site atomically.
- Keep the same file structure unless the edit clearly requires new pages.
- Maintain valid HTML5 and the same nav structure across pages.
- Do not break inter-page links or asset links (relative paths).`;

export async function editProjectAI(
  currentFiles: SiteFiles,
  intentName: string,
  instructions: string,
): Promise<BuildResult> {
  try {
    const completion = await openai.chat.completions.create({
      model: TEXT_MODEL,
      response_format: { type: "json_object" },
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: EDIT_SYSTEM },
        {
          role: "user",
          content: `name: ${intentName}\n\nedit instructions: ${instructions}\n\ncurrent files:\n${JSON.stringify(currentFiles, null, 2)}`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("empty edit response");
    const parsed = JSON.parse(text) as {
      coverColor?: string;
      files?: Record<string, unknown>;
    };
    const files = sanitizeFiles(parsed.files, {
      type: "website",
      summary: "",
      pages: [{ path: "index.html", title: "Home", purpose: "", sections: [] }],
      styles: { palette: "neon", mood: "" },
      features: [],
      notes: [],
    });
    if (Object.keys(files).length === 0) throw new Error("no files in edit");
    const coverColor = isHex(parsed.coverColor) ? parsed.coverColor! : "#7CC7FF";
    return { files, coverColor, name: intentName };
  } catch (err) {
    logger.warn({ err: String(err) }, "editProjectAI failed");
    throw err;
  }
}

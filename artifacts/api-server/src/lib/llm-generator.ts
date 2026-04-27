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
const MAX_TOKENS = 16000;

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

Aim for a polished, modern aesthetic — think Linear, Vercel, Stripe, Bolt.new, Apple. Dark or light is fine; pick what fits the prompt.`;

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

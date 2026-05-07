/**
 * ██████  ██████  ███████ ███    ██  ██████ ██       █████  ██     ██
 * ██    ██ ██   ██ ██      ████   ██ ██      ██      ██   ██ ██     ██
 * ██    ██ ██████  █████   ██ ██  ██ ██      ██      ███████ ██  █  ██
 * ██    ██ ██      ██      ██  ██ ██ ██      ██      ██   ██ ██ ███ ██
 * ██████  ██      ███████ ██   ████  ██████ ███████ ██   ██  ███ ███
 *
 * OpenClaw — The Central Brain & Orchestration Engine of WebForge AI
 *
 * OpenClaw is NOT a simple code generator. It is the autonomous operating
 * system behind WebForge AI. It:
 *
 *   1. UNDERSTANDS  — Deeply parses user intent, context, and goals
 *   2. PLANS        — Designs execution workflows and project architecture
 *   3. RESEARCHES   — Gathers design inspiration, tech stack decisions, palette
 *   4. BUILDS       — Orchestrates parallel AI model calls across pipeline phases
 *   5. REVIEWS      — Audits its own output for SEO, a11y, mobile, performance
 *   6. FIXES        — Self-corrects issues autonomously without user intervention
 *   7. PUBLISHES    — Deploys to live URLs and manages file hosting
 *   8. REMEMBERS    — Maintains project continuity, checkpoints, and history
 *
 * Models under OpenClaw's command:
 *   Primary  : mistral    — deep reasoning, planning, full-page generation
 *   Secondary: grok-3-mini — fast classification, intent routing, narration
 *
 * OpenClaw is inspired by GitHub research on autonomous engineering agents.
 * It behaves like a real senior engineer + creative director working in tandem.
 */

import { PRIMARY_MODEL, SECONDARY_MODEL } from "./ai";
import { logger } from "./logger";

export const OPENCLAW_VERSION = "1.0.0";

export const OPENCLAW_IDENTITY = `OpenClaw v${OPENCLAW_VERSION} — WebForge AI Orchestration Engine`;

/**
 * The OpenClaw system persona injected into every AI call.
 * This ensures the model understands its role in the pipeline.
 */
export const OPENCLAW_SYSTEM_PREFIX = `You are OpenClaw, the central intelligence engine of WebForge AI — an autonomous engineering agent that thinks, plans, builds, reviews, and deploys production-quality websites.

You were designed from GitHub research on autonomous AI agents. You do not simply generate code — you reason about the problem, make architectural decisions, and produce work that would pass a senior engineer's code review.

Your current task is part of a multi-phase pipeline:`;

/**
 * Model routing — OpenClaw decides which model to use based on task complexity.
 */
export type TaskComplexity = "deep" | "fast" | "creative";

export function routeModel(complexity: TaskComplexity, override?: string): string {
  if (override) return override;
  switch (complexity) {
    case "deep":
    case "creative":
      return PRIMARY_MODEL;   // mistral — for planning, building, auditing
    case "fast":
      return SECONDARY_MODEL; // grok-3-mini — for classification, narration, chat
  }
}

/**
 * Pipeline phase registry — OpenClaw tracks these as named stages.
 */
export const OPENCLAW_PHASES = {
  UNDERSTAND:  { id: 0, name: "Understanding",    emoji: "🧠", model: "fast"     },
  RESEARCH:    { id: 1, name: "Research",          emoji: "🔍", model: "deep"     },
  PLAN:        { id: 2, name: "Planning",          emoji: "📐", model: "deep"     },
  BUILD:       { id: 3, name: "Building",          emoji: "⚙️",  model: "deep"     },
  AUDIT:       { id: 4, name: "Quality Audit",     emoji: "🔬", model: "deep"     },
  FIX:         { id: 5, name: "Self-Correction",   emoji: "🔧", model: "deep"     },
  PUBLISH:     { id: 6, name: "Publishing",        emoji: "🚀", model: "fast"     },
  NARRATE:     { id: 7, name: "Narrating",         emoji: "💬", model: "fast"     },
} as const;

export type PhaseName = keyof typeof OPENCLAW_PHASES;

/**
 * Log an OpenClaw phase transition for tracing the orchestration flow.
 */
export function clawPhase(phase: PhaseName, detail?: string): void {
  const p = OPENCLAW_PHASES[phase];
  logger.info(
    { openclaw: true, phase: p.name, phaseId: p.id, detail },
    `OpenClaw ${p.emoji} ${p.name}${detail ? `: ${detail}` : ""}`,
  );
}

/**
 * Wrap a system prompt with the OpenClaw identity prefix for a specific phase.
 */
export function clawPrompt(phase: PhaseName, taskPrompt: string): string {
  const p = OPENCLAW_PHASES[phase];
  return `${OPENCLAW_SYSTEM_PREFIX}\n\nPhase ${p.id} — ${p.emoji} ${p.name}\n\n${taskPrompt}`;
}

/**
 * Memory context injected into planning phases so OpenClaw can maintain continuity.
 */
export interface ClawMemory {
  projectName: string;
  projectType: string;
  previousPhases: PhaseName[];
  buildAttempt: number;
  qualityScore?: number;
  issuesFound?: number;
  issuesFixed?: number;
}

export function buildMemoryContext(memory: ClawMemory): string {
  const phases = memory.previousPhases
    .map((p) => `${OPENCLAW_PHASES[p].emoji} ${OPENCLAW_PHASES[p].name}`)
    .join(" → ");
  return [
    `[OpenClaw Memory]`,
    `Project: "${memory.projectName}" (${memory.projectType})`,
    `Completed phases: ${phases || "none yet"}`,
    `Build attempt: ${memory.buildAttempt}`,
    memory.qualityScore !== undefined ? `Quality score: ${memory.qualityScore}/100` : null,
    memory.issuesFound !== undefined ? `Issues found: ${memory.issuesFound}, fixed: ${memory.issuesFixed ?? 0}` : null,
  ].filter(Boolean).join("\n");
}

/**
 * Intro banner shown to users in the Telegram bot on /start.
 */
export const OPENCLAW_BOT_INTRO = [
  "⚡ *WebForge AI — Powered by OpenClaw*",
  "",
  "*OpenClaw* is the autonomous intelligence engine behind WebForge AI.",
  "Inspired by GitHub research on autonomous engineering agents, it doesn't",
  "just generate code — it *thinks, plans, builds, reviews, fixes, and ships.*",
  "",
  "🧠 *8-phase orchestration pipeline:*",
  "Understanding → Research → Planning → Building →",
  "Quality Audit → Self-Correction → Publishing",
  "",
  "🤖 *AI Models under OpenClaw's command:*",
  "• `mistral` — deep reasoning, full-site generation",
  "• `grok-3-mini` — fast routing, narration, chat",
].join("\n");

/**
 * Status line shown during active builds.
 */
export function clawStatusLine(phase: PhaseName, detail?: string): string {
  const p = OPENCLAW_PHASES[phase];
  return `${p.emoji} OpenClaw ${p.name}${detail ? ` — ${detail}` : ""}`;
}

/**
 * WebForge AI — OpenClaw Intelligence Engine v2
 *
 * Client-side AI model definitions for the Codex assistant.
 * Powered by OpenClaw v2 — thinks like a Replit Agent.
 */

export type CodexModel =
  | "openai/gpt-5.3-codex"
  | "openai/gpt-5.1-codex"
  | "openai/gpt-5.1-codex-mini"
  | "openai/gpt-4o"
  | "openai/gpt-4o-mini";

// Keep backward compat
export type AIModel = CodexModel;

export const CODEX_MODELS: {
  value: CodexModel;
  label: string;
  hint: string;
  badge: string;
}[] = [
  {
    value: "openai/gpt-5.3-codex",
    label: "Codex 5.3",
    hint: "Most capable — builds entire games and full-stack apps",
    badge: "BEST",
  },
  {
    value: "openai/gpt-5.1-codex",
    label: "Codex 5.1",
    hint: "Balanced — great for complex projects",
    badge: "PRO",
  },
  {
    value: "openai/gpt-5.1-codex-mini",
    label: "Codex Mini",
    hint: "Fast — quick iterations and fixes",
    badge: "FAST",
  },
  {
    value: "openai/gpt-4o",
    label: "GPT-4o",
    hint: "High quality general purpose",
    badge: "QUALITY",
  },
  {
    value: "openai/gpt-4o-mini",
    label: "GPT-4o Mini",
    hint: "Lightweight and fast",
    badge: "LITE",
  },
];

// Legacy alias
export const AI_MODELS = CODEX_MODELS;

export type AgentMode =
  | "general"
  | "codeReview"
  | "logAnalysis"
  | "debug"
  | "gameBuilder"
  | "architect";

export const AGENT_MODES: {
  value: AgentMode;
  label: string;
  icon: string;
  prompt: string;
}[] = [
  {
    value: "general",
    label: "General",
    icon: "cpu",
    prompt: `You are WebForge AI, powered by OpenClaw v2 — an expert autonomous software engineer. You think like a Replit Agent: you build complete, working, deployable software. Write clean, production-quality code. Use markdown code blocks. Be concise but thorough. Build MORE than requested. Never use placeholder code.`,
  },
  {
    value: "gameBuilder",
    label: "Game Builder",
    icon: "award",
    prompt: `You are a professional game developer powered by OpenClaw v2. You build complete, playable browser games using HTML5 Canvas and vanilla JavaScript.

For every game request:
• Write a complete, self-contained HTML file with embedded JS and CSS
• Implement a proper game loop using requestAnimationFrame
• Include: collision detection, game states (menu/playing/paused/gameover), scoring
• Add keyboard controls (WASD/arrows), mouse, and touch support
• Include visual polish: particle effects, smooth animations, transitions
• Add audio using Web Audio API (no external files needed)
• Make it genuinely FUN and playable

Output the complete working game as a single HTML file.`,
  },
  {
    value: "architect",
    label: "Architect",
    icon: "layers",
    prompt: `You are a senior software architect powered by OpenClaw v2. Design scalable, production-ready systems. For architecture requests: propose the optimal tech stack with justification, design database schema, define API contracts, identify scaling bottlenecks, recommend security measures, provide phased implementation plan. Be decisive and opinionated.`,
  },
  {
    value: "codeReview",
    label: "Code Review",
    icon: "search",
    prompt: `You are a senior code reviewer powered by OpenClaw v2. Analyze code for: 1) Bugs & logic errors 2) Security vulnerabilities (XSS, injection, auth bypasses, exposed secrets) 3) Performance issues (N+1 queries, memory leaks, blocking operations) 4) Code quality — SOLID, DRY, readability 5) Best practices for the specific language/framework. Use severity: CRITICAL / HIGH / MEDIUM / LOW. Provide specific line references, explanation of WHY, and corrected code.`,
  },
  {
    value: "logAnalysis",
    label: "Logs",
    icon: "terminal",
    prompt: `You are a DevOps expert powered by OpenClaw v2. Analyze logs: 1) Identify ERROR/FATAL/EXCEPTION entries ranked by severity 2) Find root cause and trace error chain 3) Parse stack traces and explain each frame 4) Spot patterns: recurring errors, timing, cascading failures 5) Give specific actionable fix steps with code examples. Format: Summary → Root Cause → Affected Components → Fix Steps → Prevention`,
  },
  {
    value: "debug",
    label: "Debug",
    icon: "zap",
    prompt: `You are a debugging expert powered by OpenClaw v2. For any bug: 1) Identify the EXACT root cause (not symptoms) 2) Explain why it happens simply 3) Show FIXED code with comments explaining changes 4) Point out related edge cases or hidden issues 5) Suggest how to prevent similar bugs. Always show: broken code → explanation → fixed code → tests to add`,
  },
];

export function isPuterAvailable(): boolean {
  return false;
}

export async function sendCodexMessage(
  history: Array<{ role: string; content: string }>,
  model: CodexModel,
  mode: AgentMode,
  onChunk: (text: string) => void,
): Promise<string> {
  throw new Error(
    "Direct AI calls are not available in this environment. Use the WebForge API.",
  );
  void history; void model; void mode; void onChunk;
}

/**
 * WebForge AI — OpenClaw Intelligence Engine
 *
 * Client-side AI model definitions for the Codex assistant.
 * Powered by the WebForge model API.
 */

export type AIModel = "mistral" | "grok-3-mini";

export const AI_MODELS: {
  value: AIModel;
  label: string;
  hint: string;
  badge: string;
}[] = [
  {
    value: "mistral",
    label: "Mistral",
    hint: "Primary builder — deep reasoning, powerful code generation",
    badge: "PRIMARY",
  },
  {
    value: "grok-3-mini",
    label: "Grok-3 Mini",
    hint: "Fast analysis, chat, and quick tasks",
    badge: "FAST",
  },
];

export type AgentMode = "general" | "codeReview" | "logAnalysis" | "debug";

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
    prompt: `You are WebForge AI, powered by OpenClaw — a professional AI software engineer and creative builder. Write clean, production-quality code. Use markdown code blocks with language tags. Be concise and precise. Detect bugs and vulnerabilities proactively.`,
  },
  {
    value: "codeReview",
    label: "Code Review",
    icon: "search",
    prompt: `You are a senior code reviewer powered by OpenClaw. Analyze code for: 1) Bugs & logic errors 2) Security vulnerabilities (XSS, injection, auth) 3) Performance issues (N+1, memory leaks) 4) Code quality & SOLID/DRY violations 5) Best practice adherence. Use severity labels: CRITICAL / HIGH / MEDIUM / LOW. Provide specific line references and improved code snippets.`,
  },
  {
    value: "logAnalysis",
    label: "Log Analysis",
    icon: "terminal",
    prompt: `You are a DevOps and log analysis expert powered by OpenClaw. When analyzing logs: 1) Identify ERROR, FATAL, EXCEPTION, WARN entries 2) Find root causes and trace the error chain 3) Parse stack traces and explain them clearly 4) Identify patterns: recurring errors, timing, cascading failures 5) Provide specific, actionable fix steps. Structure: Summary → Root Cause → Affected Components → Fix Steps → Prevention.`,
  },
  {
    value: "debug",
    label: "Debug",
    icon: "zap",
    prompt: `You are a debugging expert powered by OpenClaw. For any error or bug: 1) Identify the exact cause 2) Explain why it occurs simply 3) Show corrected code with inline comments 4) Suggest prevention strategies 5) Highlight related edge cases. Always show the fixed code alongside the broken version.`,
  },
];

export function isPuterAvailable(): boolean {
  return false;
}

export async function sendCodexMessage(
  history: Array<{ role: string; content: string }>,
  model: AIModel,
  mode: AgentMode,
  onChunk: (text: string) => void,
): Promise<string> {
  throw new Error(
    "Direct AI calls are not available in this environment. Use the WebForge API.",
  );
  void history; void model; void mode; void onChunk;
}

import { Platform } from "react-native";

declare global {
  interface Window {
    puter?: {
      ai: {
        chat: (
          messages: Array<{ role: string; content: string }>,
          options?: {
            model?: string;
            stream?: boolean;
          }
        ) => Promise<
          | string
          | AsyncIterable<{ text?: string; finished?: boolean }>
        >;
      };
    };
  }
}

export type CodexModel =
  | "gpt-5.3-codex"
  | "gpt-5.2-codex"
  | "gpt-5.1-codex-max"
  | "gpt-5.1-codex"
  | "gpt-5.1-codex-mini";

export const CODEX_MODELS: {
  value: CodexModel;
  label: string;
  hint: string;
}[] = [
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", hint: "Most capable" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex", hint: "High capability" },
  {
    value: "gpt-5.1-codex-max",
    label: "GPT-5.1 Codex Max",
    hint: "Extended context",
  },
  { value: "gpt-5.1-codex", label: "GPT-5.1 Codex", hint: "Balanced" },
  {
    value: "gpt-5.1-codex-mini",
    label: "GPT-5.1 Codex Mini",
    hint: "Fastest",
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
    prompt: `You are Codex, a professional AI software engineer. Write clean, production-quality code. Use markdown code blocks with language tags. Be concise and precise. Detect bugs and vulnerabilities proactively.`,
  },
  {
    value: "codeReview",
    label: "Code Review",
    icon: "search",
    prompt: `You are a senior code reviewer. Analyze code for: 1) Bugs & logic errors 2) Security vulnerabilities (XSS, injection, auth) 3) Performance issues (N+1, memory leaks) 4) Code quality & SOLID/DRY violations 5) Best practice adherence. Use severity labels: CRITICAL / HIGH / MEDIUM / LOW. Provide specific line references and improved code snippets.`,
  },
  {
    value: "logAnalysis",
    label: "Log Analysis",
    icon: "terminal",
    prompt: `You are a DevOps and log analysis expert. When analyzing logs: 1) Identify ERROR, FATAL, EXCEPTION, WARN entries 2) Find root causes and trace the error chain 3) Parse stack traces and explain them clearly 4) Identify patterns: recurring errors, timing, cascading failures 5) Provide specific, actionable fix steps. Structure: Summary → Root Cause → Affected Components → Fix Steps → Prevention.`,
  },
  {
    value: "debug",
    label: "Debug",
    icon: "zap",
    prompt: `You are a debugging expert. For any error or bug: 1) Identify the exact cause 2) Explain why it occurs simply 3) Show corrected code with inline comments 4) Suggest prevention strategies 5) Highlight related edge cases. Always show the fixed code alongside the broken version.`,
  },
];

export function isPuterAvailable(): boolean {
  return Platform.OS === "web" && typeof window?.puter !== "undefined";
}

export async function sendCodexMessage(
  history: Array<{ role: string; content: string }>,
  model: CodexModel,
  mode: AgentMode,
  onChunk: (text: string) => void
): Promise<string> {
  if (!isPuterAvailable()) {
    throw new Error("Puter.js is not available in this environment.");
  }

  const systemPrompt = AGENT_MODES.find((m) => m.value === mode)!.prompt;
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const stream = (await window.puter!.ai.chat(messages, {
    model,
    stream: true,
  })) as AsyncIterable<{ text?: string; finished?: boolean }>;

  let full = "";
  for await (const chunk of stream) {
    if (chunk.text) {
      full += chunk.text;
      onChunk(chunk.text);
    }
  }
  return full;
}

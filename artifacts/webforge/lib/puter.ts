/**
 * WebForge AI — OpenClaw Intelligence Engine v2
 *
 * Client-side AI model definitions for the Codex assistant.
 * Calls the WebForge API server (/api/ai/chat) — no direct Puter dependency.
 */

import { Platform } from "react-native";

export type CodexModel =
  | "openai/gpt-5.3-codex"
  | "openai/gpt-5.1-codex"
  | "openai/gpt-5.1-codex-mini"
  | "openai/gpt-4o"
  | "openai/gpt-4o-mini";

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

/** AI engine is always available — uses the WebForge API server. */
export function isPuterAvailable(): boolean {
  return true;
}

async function getAuthToken(): Promise<string | null> {
  const AUTH_KEY = "auth_session_token";
  try {
    if (Platform.OS === "web") {
      return globalThis.localStorage?.getItem(AUTH_KEY) ?? null;
    }
    const SecureStore = await import("expo-secure-store");
    return await SecureStore.getItemAsync(AUTH_KEY);
  } catch {
    return null;
  }
}

/**
 * Send a message through the WebForge AI API with SSE streaming.
 * Falls back to a non-stream response if streaming fails.
 */
export async function sendCodexMessage(
  history: Array<{ role: string; content: string }>,
  model: CodexModel,
  mode: AgentMode,
  onChunk: (text: string) => void,
): Promise<string> {
  const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  const token = await getAuthToken();

  const modeConfig = AGENT_MODES.find(m => m.value === mode);
  const systemPrompt = modeConfig?.prompt ?? AGENT_MODES[0].prompt;

  const modelId = model.replace("openai/", "");

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const res = await fetch(`${apiBase}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, model: modelId, stream: true }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI error (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.body) throw new Error("No response body from AI");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: string;
          };
          if (chunk.error) throw new Error(chunk.error);
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) { full += delta; onChunk(delta); }
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== "SyntaxError") {
            throw parseErr;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return full;
}

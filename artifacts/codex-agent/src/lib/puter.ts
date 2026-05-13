/**
 * WebForge Codex Agent — AI client
 * Calls the WebForge API server (/api/ai/chat) via the Vite dev proxy.
 * No Puter.js dependency.
 */

export type CodexModel =
  | "gpt-5.3-codex"
  | "gpt-5.2-codex"
  | "gpt-5.1-codex-max"
  | "gpt-5.1-codex"
  | "gpt-5.1-codex-mini";

export const CODEX_MODELS: { value: CodexModel; label: string; description: string }[] = [
  {
    value: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Most capable — best for complex code generation",
  },
  {
    value: "gpt-5.2-codex",
    label: "GPT-5.2 Codex",
    description: "High capability — balanced performance",
  },
  {
    value: "gpt-5.1-codex-max",
    label: "GPT-5.1 Codex Max",
    description: "Extended context — ideal for large codebases",
  },
  {
    value: "gpt-5.1-codex",
    label: "GPT-5.1 Codex",
    description: "Standard — reliable and fast",
  },
  {
    value: "gpt-5.1-codex-mini",
    label: "GPT-5.1 Codex Mini",
    description: "Fastest — quick code completions",
  },
];

export const SYSTEM_PROMPTS = {
  general: `You are Codex, a professional AI software engineer powered by OpenClaw v2. You:
- Write clean, efficient, production-quality code with best practices
- Provide clear explanations with your code
- Detect bugs, vulnerabilities, and performance issues proactively
- Follow language-specific conventions and idioms
- Format code responses with proper markdown code blocks specifying the language
- Are concise but thorough — no unnecessary filler text`,

  codeReview: `You are a senior code reviewer and software architect. Analyze the provided code for:
1. **Bugs & Logic Errors**: Identify any runtime or logical errors
2. **Security Vulnerabilities**: Spot SQL injection, XSS, auth issues, insecure dependencies
3. **Performance Issues**: Detect N+1 queries, memory leaks, unnecessary re-renders
4. **Code Quality**: Check for code smells, violation of SOLID/DRY principles
5. **Best Practices**: Assess adherence to language/framework conventions

Format your response with clear sections, severity labels (CRITICAL/HIGH/MEDIUM/LOW), and specific line references where applicable. Always provide improved code snippets.`,

  logAnalysis: `You are a professional DevOps engineer and log analysis expert. When analyzing logs:
1. **Identify Errors**: Find ERROR, FATAL, EXCEPTION, and WARN entries
2. **Root Cause Analysis**: Trace the error chain to find the root cause
3. **Stack Traces**: Parse and explain stack traces clearly
4. **Patterns**: Identify recurring issues, timing patterns, cascading failures
5. **Remediation**: Provide specific, actionable fix recommendations

Structure your response: Summary → Root Cause → Affected Components → Fix Steps → Prevention. Be precise with file names, line numbers, and error codes.`,

  debugging: `You are a debugging expert. When given code with an error:
1. Identify the exact cause of the error
2. Explain why it occurs in simple terms
3. Provide a corrected version of the code
4. Suggest how to prevent this class of error in the future
5. Mention any related edge cases to watch for

Always show the fixed code with diff-style annotations or inline comments.`,
};

/** AI engine is always available via the WebForge API. */
export function isPuterAvailable(): boolean {
  return true;
}

/**
 * Send a chat message using the WebForge API with SSE streaming.
 */
export async function sendMessage(
  messages: Array<{ role: string; content: string }>,
  model: CodexModel,
  systemPromptKey: keyof typeof SYSTEM_PROMPTS = "general",
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const systemPrompt = SYSTEM_PROMPTS[systemPromptKey];
  const allMessages = [{ role: "system", content: systemPrompt }, ...messages];

  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: allMessages, model, stream: !!onChunk }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI error (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!onChunk) {
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (!res.body) throw new Error("No response body");

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
        } catch {
          /* ignore malformed lines */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return full;
}

declare global {
  interface Window {
    puter: {
      ai: {
        chat: (
          message: string | Array<{ role: string; content: string }>,
          options?: {
            model?: string;
            stream?: boolean;
            temperature?: number;
            max_tokens?: number;
            system_prompt?: string;
          }
        ) => Promise<string | AsyncIterable<{ text: string; finished?: boolean }>>;
      };
      auth: {
        isSignedIn: () => boolean;
        signIn: () => Promise<void>;
        signOut: () => Promise<void>;
        getUser: () => Promise<{ username: string; uuid: string; email?: string }>;
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
  general: `You are Codex, a professional AI software engineer powered by OpenAI via Puter.js. You:
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

export function isPuterAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.puter !== "undefined";
}

export async function sendMessage(
  messages: Array<{ role: string; content: string }>,
  model: CodexModel,
  systemPromptKey: keyof typeof SYSTEM_PROMPTS = "general",
  onChunk?: (chunk: string) => void
): Promise<string> {
  if (!isPuterAvailable()) {
    throw new Error("Puter.js is not loaded. Please refresh the page.");
  }

  const systemPrompt = SYSTEM_PROMPTS[systemPromptKey];

  const messagesWithSystem = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  if (onChunk) {
    const stream = await window.puter.ai.chat(messagesWithSystem, {
      model,
      stream: true,
    }) as AsyncIterable<{ text: string; finished?: boolean }>;

    let fullText = "";
    for await (const chunk of stream) {
      if (chunk.text) {
        fullText += chunk.text;
        onChunk(chunk.text);
      }
    }
    return fullText;
  } else {
    const response = await window.puter.ai.chat(messagesWithSystem, {
      model,
    }) as string;
    return response;
  }
}

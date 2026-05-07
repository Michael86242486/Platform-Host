/**
 * WebForge AI — powered by OpenClaw Engine
 *
 * Custom AI client connecting to the WebForge model API.
 * Primary builder: Mistral  |  Secondary / fast tasks: Grok-3-mini
 */

import { logger } from "./logger";

const AI_BASE_URL = "https://aimodelapi.onrender.com/v1";
const AI_API_KEY = process.env["WEBFORGE_AI_API_KEY"] ?? "";

export const PRIMARY_MODEL = "mistral";
export const SECONDARY_MODEL = "grok-3-mini";
export const FAST_MODEL = SECONDARY_MODEL;

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class AIError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status = 0, body = "") {
    super(message);
    this.name = "AIError";
    this.status = status;
    this.body = body;
  }
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AI_API_KEY}`,
  };
}

/**
 * Non-streaming AI completion.
 * Calls the OpenAI-compatible /chat/completions endpoint.
 */
export async function aiComplete(
  messages: AIMessage[],
  opts: { model?: string; jsonMode?: boolean; timeout?: number } = {},
): Promise<string> {
  const model = opts.model ?? PRIMARY_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (opts.jsonMode) {
    body["response_format"] = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeout ?? 120_000,
  );

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new AIError(
        `AI API error (${res.status}): ${text.slice(0, 300)}`,
        res.status,
        text,
      );
    }

    let parsed: { choices?: Array<{ message?: { content?: string } }> } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AIError(`AI API returned invalid JSON: ${text.slice(0, 200)}`);
    }

    const content = parsed.choices?.[0]?.message?.content ?? "";
    if (!content) throw new AIError("AI API returned empty content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming AI completion — fires onChunk for each token, returns full text.
 */
export async function aiStream(
  messages: AIMessage[],
  onChunk: (text: string) => void,
  opts: { model?: string; timeout?: number } = {},
): Promise<string> {
  const model = opts.model ?? PRIMARY_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeout ?? 180_000,
  );

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AIError(
        `AI stream error (${res.status}): ${text.slice(0, 300)}`,
        res.status,
        text,
      );
    }

    if (!res.body) throw new AIError("AI stream: no response body");

    const decoder = new TextDecoder();
    let full = "";
    let sseBuffer = "";
    const reader = res.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data) as Record<string, unknown>;
            const delta =
              (
                chunk["choices"] as Array<{
                  delta?: { content?: string };
                }>
              )?.[0]?.delta?.content ?? "";
            if (delta) {
              full += delta;
              onChunk(delta);
            }
          } catch {
            /* ignore malformed SSE lines */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return full;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health check — verifies the AI API is reachable.
 */
export async function aiPing(): Promise<{ ok: boolean; model?: string; error?: string }> {
  if (!AI_API_KEY) {
    return { ok: false, error: "WEBFORGE_AI_API_KEY not set" };
  }
  try {
    const result = await aiComplete(
      [{ role: "user", content: "ping" }],
      { model: SECONDARY_MODEL, timeout: 15_000 },
    );
    return { ok: true, model: SECONDARY_MODEL, error: result ? undefined : "empty response" };
  } catch (err) {
    logger.warn({ err: String(err) }, "aiPing failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

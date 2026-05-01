import OpenAI from "openai";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

const _primary = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

/**
 * Optional fallback provider (aimodelapi.onrender.com).
 * Used automatically when the primary hits a quota/spend-limit error.
 */
const _fallback =
  process.env.FALLBACK_AI_API_KEY && process.env.FALLBACK_AI_BASE_URL
    ? new OpenAI({
        apiKey: process.env.FALLBACK_AI_API_KEY,
        baseURL: process.env.FALLBACK_AI_BASE_URL,
        timeout: 90_000,
        maxRetries: 1,
      })
    : null;

/**
 * Map a primary model name to the best available fallback model.
 * grok-3-mini is the only model on the fallback API that correctly
 * honours `response_format: { type: "json_object" }` and supports
 * streaming. It is also the fastest (≈1.7 s TTFT in tests).
 */
function mapModel(_model: string, _useJsonMode: boolean): string {
  return "grok-3-mini";
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const inner = e["error"] as Record<string, unknown> | undefined;
  const code = inner?.["code"] ?? e["code"];
  if (code === "FREE_TIER_BUDGET_EXCEEDED") return true;
  const status = e["status"];
  if (status === 429) return true;
  if (status === 403) {
    const msg = String(inner?.["message"] ?? e["message"] ?? "");
    if (/budget|spend.*limit|quota|tier/i.test(msg)) return true;
  }
  return false;
}

/** Adapt params from primary format to fallback format. */
function adaptParams<T extends Record<string, unknown>>(
  params: T,
  model: string,
): T {
  const adapted: Record<string, unknown> = { ...params, model };
  // gpt-5 family uses max_completion_tokens; fallback models use max_tokens
  if ("max_completion_tokens" in adapted) {
    adapted["max_tokens"] = adapted["max_completion_tokens"];
    delete adapted["max_completion_tokens"];
  }
  return adapted as T;
}

/**
 * Wrap `chat.completions.create` so that on a quota error it transparently
 * retries against the fallback provider with a mapped model name.
 * Handles both streaming (returns AsyncIterable) and non-streaming responses.
 */
function wrapCreate(
  primaryFn: OpenAI["chat"]["completions"]["create"],
  fallbackClient: OpenAI | null,
): OpenAI["chat"]["completions"]["create"] {
  return async function wrappedCreate(params: any, options?: any): Promise<any> {
    try {
      return await primaryFn(params, options);
    } catch (err: unknown) {
      if (!fallbackClient || !isQuotaError(err)) throw err;
      const useJsonMode =
        (params as any)?.response_format?.type === "json_object";
      const fallbackModel = mapModel((params as any).model ?? "", useJsonMode);
      console.warn(
        `[ai-fallback] quota on "${(params as any).model}"; retrying with "${fallbackModel}"`,
      );
      return await fallbackClient.chat.completions.create(
        adaptParams(params, fallbackModel),
        options,
      );
    }
  } as OpenAI["chat"]["completions"]["create"];
}

const _wrappedCreate = wrapCreate(
  _primary.chat.completions.create.bind(_primary.chat.completions),
  _fallback,
);

/**
 * Drop-in OpenAI client with automatic fallback on quota errors.
 * All `.chat.completions.create(...)` calls (streaming or not) will
 * transparently retry against aimodelapi.onrender.com when the Replit
 * OpenAI integration exhausts its free-tier budget.
 */
export const openai = new Proxy(_primary, {
  get(target, prop) {
    if (prop === "chat") {
      return new Proxy(target.chat, {
        get(chatTarget, chatProp) {
          if (chatProp === "completions") {
            return new Proxy(chatTarget.completions, {
              get(compTarget, compProp) {
                if (compProp === "create") return _wrappedCreate;
                return (compTarget as any)[compProp];
              },
            });
          }
          return (chatTarget as any)[chatProp];
        },
      });
    }
    return (target as any)[prop];
  },
});

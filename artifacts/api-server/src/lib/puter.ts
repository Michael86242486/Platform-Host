import crypto from "node:crypto";

import { logger } from "./logger";

const PUTER_API = "https://api.puter.com";
const PUTER_USERNAME = process.env.PUTER_USERNAME ?? null;
const PUTER_PASSWORD = process.env.PUTER_PASSWORD ?? null;

export const PUTER_CONFIGURED: boolean = Boolean(
  PUTER_USERNAME && PUTER_PASSWORD,
);

interface PuterError {
  status: number;
  body: string;
  message: string;
}

class PuterAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PuterAuthError";
  }
}

interface CachedAuth {
  token: string;
  username: string;
  expiresAt: number;
}

let cachedAuth: CachedAuth | null = null;

async function login(): Promise<CachedAuth> {
  if (!PUTER_CONFIGURED) {
    throw new PuterAuthError(
      "Puter is not configured. Set PUTER_USERNAME and PUTER_PASSWORD secrets.",
    );
  }
  const res = await fetch(`${PUTER_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: PUTER_USERNAME,
      password: PUTER_PASSWORD,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PuterAuthError(
      `Puter login failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    proceed?: boolean;
    token?: string;
    user?: { username?: string };
  };
  if (!data?.token) {
    throw new PuterAuthError("Puter login returned no token");
  }
  cachedAuth = {
    token: data.token,
    username: data.user?.username ?? PUTER_USERNAME!,
    // Puter session tokens are long-lived; cache for ~6h to be safe.
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  };
  return cachedAuth;
}

async function getAuth(): Promise<CachedAuth> {
  if (cachedAuth && cachedAuth.expiresAt > Date.now() + 60_000) {
    return cachedAuth;
  }
  return login();
}

async function callPuter<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  opts: { retryAuth?: boolean } = {},
): Promise<T> {
  const auth = await getAuth();
  const res = await fetch(`${PUTER_API}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    if (opts.retryAuth !== false) {
      cachedAuth = null;
      return callPuter<T>(endpoint, body, { retryAuth: false });
    }
    throw new PuterAuthError(`Puter ${endpoint} auth failed (${res.status})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err: PuterError = {
      status: res.status,
      body: text.slice(0, 500),
      message: `Puter ${endpoint} failed (${res.status}): ${text.slice(0, 200)}`,
    };
    throw Object.assign(new Error(err.message), { puter: err });
  }
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * Call a Puter "driver" — these are how Puter exposes most non-FS APIs
 * (subdomains/hosting, KV, etc). Always returns the unwrapped `result` field.
 */
async function callDriver<T = unknown>(
  iface: string,
  method: string,
  args: Record<string, unknown> = {},
  opts: { retryAuth?: boolean } = {},
): Promise<T> {
  const auth = await getAuth();
  const res = await fetch(`${PUTER_API}/drivers/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ interface: iface, method, args }),
  });
  if (res.status === 401 || res.status === 403) {
    if (opts.retryAuth !== false) {
      cachedAuth = null;
      return callDriver<T>(iface, method, args, { retryAuth: false });
    }
    throw new PuterAuthError(`Puter driver ${iface}.${method} auth failed`);
  }
  const text = await res.text().catch(() => "");
  let parsed: { success?: boolean; result?: T; error?: unknown } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* noop */
  }
  if (!res.ok || parsed?.success === false) {
    const err: PuterError = {
      status: res.status,
      body: text.slice(0, 500),
      message: `Puter ${iface}.${method} failed (${res.status}): ${text.slice(0, 200)}`,
    };
    throw Object.assign(new Error(err.message), { puter: err });
  }
  return parsed.result as T;
}

/**
 * Sanitize a path segment so Puter accepts it. Puter file/folder names allow
 * letters, digits, dots, dashes, underscores. We reject anything else.
 */
function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Validate a relative path inside a site. No traversal, no leading slash, no
 * absolute paths. Splits on `/` for nested folders.
 */
export function sanitizeRelPath(rel: string): string | null {
  const trimmed = rel.replace(/^\/+/, "").trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (trimmed.includes("..") || trimmed.includes("\0")) return null;
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  for (const p of parts) {
    if (p === "." || p === ".." || p.length === 0 || p.length > 80) {
      return null;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(p)) return null;
  }
  return parts.join("/");
}

/** Build the per-site root directory inside Puter. */
function siteRoot(username: string, userId: string, siteId: string): string {
  const u = safeSegment(userId);
  const s = safeSegment(siteId);
  return `/${username}/webforge/users/${u}/sites/${s}`;
}

async function mkdirP(fullPath: string): Promise<void> {
  await callPuter("/mkdir", {
    path: fullPath,
    create_missing_parents: true,
    overwrite: false,
    dedupe_name: false,
  }).catch((err: Error & { puter?: PuterError }) => {
    // If folder already exists, Puter returns 409. Treat as success.
    const status = err.puter?.status;
    if (status === 409) return;
    if (err.puter?.body?.includes("already_exists")) return;
    throw err;
  });
}

interface UploadOpts {
  /** Called once per file as it finishes uploading (for progress UI). */
  onFile?: (rel: string, idx: number, total: number) => void | Promise<void>;
  /** Number of files to upload concurrently. */
  concurrency?: number;
}

export interface UploadedSite {
  /** The puter username that owns the files. */
  username: string;
  /** The full puter root path for this site. */
  rootDir: string;
  /** The unique subdomain we created for this site. */
  subdomain: string;
  /** The public, browser-shareable URL for index.html. */
  publicUrl: string;
}

/**
 * Generate a globally-unique-ish Puter subdomain for a site. The site id and
 * username are folded in so the same site always tries the same subdomain
 * (idempotent re-uploads keep the same URL).
 */
function deterministicSubdomain(userId: string, siteId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${userId}:${siteId}`)
    .digest("hex")
    .slice(0, 10);
  return `wf-${hash}`;
}

/**
 * Upload (or re-upload) a complete site to Puter and ensure it has a public
 * static-hosting subdomain pointed at it.
 */
export async function uploadSite(args: {
  userId: string;
  siteId: string;
  files: Record<string, string>;
  /** Reuse this subdomain if provided; otherwise generate a deterministic one. */
  subdomain?: string | null;
  opts?: UploadOpts;
}): Promise<UploadedSite> {
  if (!PUTER_CONFIGURED) {
    throw new PuterAuthError(
      "Puter not configured: set PUTER_USERNAME and PUTER_PASSWORD",
    );
  }
  const { userId, siteId, files } = args;
  const fileEntries = Object.entries(files).filter(([rel]) =>
    sanitizeRelPath(rel),
  );
  if (fileEntries.length === 0) {
    throw new Error("uploadSite: no valid files to upload");
  }
  if (!fileEntries.some(([rel]) => rel === "index.html")) {
    throw new Error("uploadSite: missing required index.html");
  }

  const auth = await getAuth();
  const username = auth.username;
  const root = siteRoot(username, userId, siteId);

  // Ensure all directories (root + each subdirectory used by uploaded files)
  // exist before we start writing.
  await mkdirP(root);
  const dirs = new Set<string>();
  for (const [rel] of fileEntries) {
    const parts = rel.split("/");
    if (parts.length > 1) {
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        cur += "/" + parts[i];
        dirs.add(cur);
      }
    }
  }
  for (const d of Array.from(dirs).sort()) {
    await mkdirP(d);
  }

  // Upload files with limited concurrency and retries.
  const total = fileEntries.length;
  const concurrency = Math.max(1, Math.min(args.opts?.concurrency ?? 4, 8));
  let nextIdx = 0;
  let completed = 0;
  const errors: string[] = [];

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= fileEntries.length) return;
      const [rel, content] = fileEntries[idx];
      const fullPath = `${root}/${rel}`;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await uploadOne(fullPath, content);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          // Backoff before retry.
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
      if (lastErr) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        errors.push(`${rel}: ${msg}`);
        continue;
      }
      completed++;
      if (args.opts?.onFile) {
        try {
          await args.opts.onFile(rel, completed, total);
        } catch {
          // ignore observer failures
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker()),
  );
  if (errors.length > 0) {
    throw new Error(
      `Puter upload had ${errors.length} failed file(s): ${errors
        .slice(0, 3)
        .join("; ")}`,
    );
  }

  // Ensure a public static-hosting subdomain is attached to this site root.
  const desired = args.subdomain ?? deterministicSubdomain(userId, siteId);
  const subdomain = await ensureHosting(desired, root);
  const publicUrl = `https://${subdomain}.puter.site/`;
  return { username, rootDir: root, subdomain, publicUrl };
}

/**
 * Write one file to Puter using the /batch endpoint. Puter's /batch takes a
 * multipart form where each `operation` (write op JSON) is paired with a
 * `fileinfo` (file metadata JSON) and a `file` (binary blob). The pairing
 * uses `item_upload_id` — we use 0 here since we send one op at a time.
 */
async function uploadOne(fullPath: string, content: string): Promise<void> {
  const slash = fullPath.lastIndexOf("/");
  const dir = fullPath.slice(0, slash);
  const name = fullPath.slice(slash + 1);
  const contentType = guessContentType(name);
  const blob = new Blob([content], { type: contentType });

  const operation = {
    op: "write",
    path: dir,
    name,
    overwrite: true,
    dedupe_name: false,
    operation_id: crypto.randomUUID(),
    item_upload_id: 0,
  };
  const fileinfo = {
    name,
    type: contentType,
    size: blob.size,
    item_upload_id: 0,
  };

  const form = new FormData();
  form.append("operation", JSON.stringify(operation));
  form.append("fileinfo", JSON.stringify(fileinfo));
  form.append("file", blob, name);

  const auth = await getAuth();
  const res = await fetch(`${PUTER_API}/batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}` },
    body: form,
  });
  // Puter /batch returns 200 or 218 (multistatus). Check the body for per-op errors.
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) {
    cachedAuth = null;
    throw new PuterAuthError(`Puter /batch auth failed (${res.status})`);
  }
  if (!res.ok && res.status !== 218) {
    throw new Error(
      `Puter /batch failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  let parsed: { results?: Array<{ error?: unknown; message?: string }> } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* noop */
  }
  const opErr = parsed.results?.find((r) => r?.error);
  if (opErr) {
    throw new Error(
      `Puter /batch op error: ${opErr.message ?? JSON.stringify(opErr).slice(0, 200)}`,
    );
  }
}

function guessContentType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "html":
      return "text/html; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "js":
      return "application/javascript; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

interface SubdomainEntry {
  uid?: string;
  subdomain?: string;
  root_dir?: { path?: string } | string;
}

/**
 * Make sure there is a static-hosting subdomain pointed at `rootDir`. If the
 * desired subdomain is already taken (by us or anyone else), generate a fresh
 * one and try again. Idempotent: existing hosting at the same root_dir is
 * returned unchanged.
 */
async function ensureHosting(
  desiredSubdomain: string,
  rootDir: string,
): Promise<string> {
  // Check existing subdomains — if one already points at our rootDir, reuse it.
  try {
    const list = await callDriver<SubdomainEntry[]>(
      "puter-subdomains",
      "select",
      {},
    );
    for (const h of list ?? []) {
      const hostedAt =
        typeof h.root_dir === "string" ? h.root_dir : h.root_dir?.path;
      if (hostedAt === rootDir && h.subdomain) {
        return h.subdomain;
      }
    }
  } catch (err) {
    logger.warn({ err }, "puter: subdomain select failed (non-fatal)");
  }

  let candidate = desiredSubdomain.toLowerCase();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await callDriver("puter-subdomains", "create", {
        object: { subdomain: candidate, root_dir: rootDir },
      });
      return candidate;
    } catch (err) {
      const e = err as Error & { puter?: PuterError };
      const body = e.puter?.body ?? e.message ?? "";
      // Subdomain taken / conflict — rotate and retry.
      if (
        body.includes("already") ||
        body.includes("taken") ||
        body.includes("exists") ||
        body.includes("subdomain_limit") ||
        body.includes("unique")
      ) {
        candidate = `${desiredSubdomain.toLowerCase()}-${crypto
          .randomBytes(2)
          .toString("hex")}`;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Puter subdomain create failed after retries for ${desiredSubdomain}`,
  );
}

/** Read a single file from a previously-uploaded site (for editing). */
export async function readSiteFile(args: {
  userId: string;
  siteId: string;
  rel: string;
}): Promise<string> {
  if (!PUTER_CONFIGURED) {
    throw new PuterAuthError("Puter not configured");
  }
  const auth = await getAuth();
  const safeRel = sanitizeRelPath(args.rel);
  if (!safeRel) throw new Error(`Invalid relative path: ${args.rel}`);
  const fullPath = `${siteRoot(auth.username, args.userId, args.siteId)}/${safeRel}`;
  const res = await fetch(
    `${PUTER_API}/read?path=${encodeURIComponent(fullPath)}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Puter read failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return await res.text();
}

/** Delete a site's files and tear down its hosting subdomain. */
export async function deleteSite(args: {
  userId: string;
  siteId: string;
  subdomain?: string | null;
}): Promise<void> {
  if (!PUTER_CONFIGURED) return;
  const auth = await getAuth();
  const root = siteRoot(auth.username, args.userId, args.siteId);
  if (args.subdomain) {
    await callDriver("puter-subdomains", "delete", {
      id: { subdomain: args.subdomain },
    }).catch((err) => {
      logger.warn({ err, subdomain: args.subdomain }, "puter: subdomain delete");
    });
  }
  await callPuter("/delete", {
    paths: [root],
    descendants_only: false,
    recursive: true,
  }).catch((err) => {
    logger.warn({ err, root }, "puter: delete site root");
  });
}

// ---------------------------------------------------------------------------
// Puter AI — server-side LLM calls via puter-chat-completion driver
// ---------------------------------------------------------------------------

export type PuterAIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// Anonymous "SDK" session — mirrors what the Puter JS SDK does for unauthed web apps.
// Used as a transparent fallback when the main account hits quota (402).
let cachedSDKAuth: CachedAuth | null = null;

/**
 * Create a temporary anonymous Puter account and cache its token.
 * Each anonymous account gets its own free AI allocation, separate from the
 * user account's credits.
 */
async function getSDKToken(): Promise<string> {
  if (cachedSDKAuth && cachedSDKAuth.expiresAt > Date.now() + 60_000) {
    return cachedSDKAuth.token;
  }
  const hex = crypto.randomBytes(6).toString("hex");
  const username = `wf_sdk_${hex}`;
  const password = crypto.randomBytes(16).toString("hex");
  const email = `${username}@temp.webforge.app`;

  const res = await fetch(`${PUTER_API}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, email, is_temp: true }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Puter SDK signup failed (${res.status}): ${text.slice(0, 200)}`);
  }
  let data: { token?: string } = {};
  try { data = JSON.parse(text); } catch { /* noop */ }
  if (!data.token) throw new Error("Puter SDK signup returned no token");

  cachedSDKAuth = { token: data.token, username, expiresAt: Date.now() + 60 * 60 * 1000 };
  logger.info({ username }, "puter: created anonymous SDK session");
  return data.token;
}

function isQuotaResponse(errBody: string): boolean {
  return errBody.includes("insufficient_funds");
}

/** Shared SSE reader — same model/stream logic for both token types. */
async function readSSEStream(
  res: Response,
  onChunk: (text: string) => void,
): Promise<string> {
  if (!res.body) throw new Error("Puter AI stream: no response body");
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
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const delta =
            (parsed["text"] as string | undefined) ??
            ((parsed["choices"] as Array<{ delta?: { content?: string } }>)?.[0]?.delta?.content) ??
            "";
          if (delta) { full += delta; onChunk(delta); }
        } catch { /* ignore malformed SSE lines */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}

/** Raw streaming drivers/call with an explicit bearer token. */
async function rawStream(
  token: string,
  messages: PuterAIMessage[],
  model: string,
  onChunk: (text: string) => void,
): Promise<string> {
  const res = await fetch(`${PUTER_API}/drivers/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      interface: "puter-chat-completion",
      method: "complete",
      args: { messages, model, stream: true },
    }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) cachedAuth = null;
    const errBody = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Puter AI stream failed (${res.status}): ${errBody.slice(0, 200)}`),
      { status: res.status, errBody },
    );
  }
  return readSSEStream(res, onChunk);
}

/** Raw non-streaming drivers/call with an explicit bearer token. */
async function rawComplete(
  token: string,
  messages: PuterAIMessage[],
  model: string,
  jsonMode: boolean,
): Promise<string> {
  const args: Record<string, unknown> = { messages, model };
  if (jsonMode) args["response_format"] = { type: "json_object" };
  const res = await fetch(`${PUTER_API}/drivers/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ interface: "puter-chat-completion", method: "complete", args }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) cachedAuth = null;
    throw Object.assign(
      new Error(`Puter AI complete failed (${res.status}): ${text.slice(0, 200)}`),
      { status: res.status, errBody: text },
    );
  }
  let parsed: { success?: boolean; result?: { message?: { content?: string } } } = {};
  try { parsed = JSON.parse(text); } catch { /* noop */ }
  if (parsed.success === false) {
    throw Object.assign(new Error(`Puter AI failed: ${text.slice(0, 200)}`), { status: res.status, errBody: text });
  }
  const content = parsed.result?.message?.content ?? "";
  if (!content) throw new Error("Puter AI returned empty content");
  return content;
}

/**
 * Non-streaming Puter AI completion.
 * Transparently falls back to an anonymous SDK session if the account
 * hits quota (402 insufficient_funds) — same model, different credit pool.
 */
export async function puterAIComplete(
  messages: PuterAIMessage[],
  opts: { model?: string; jsonMode?: boolean } = {},
): Promise<string> {
  const model = opts.model ?? "gpt-4o-mini";
  const { token } = await getAuth();
  try {
    return await rawComplete(token, messages, model, opts.jsonMode ?? false);
  } catch (err) {
    const errBody = (err as { errBody?: string }).errBody ?? String(err);
    if (isQuotaResponse(errBody)) {
      logger.warn({ model }, "puter: user quota exhausted — retrying with anonymous SDK session");
      cachedSDKAuth = null;
      const sdkToken = await getSDKToken();
      return await rawComplete(sdkToken, messages, model, opts.jsonMode ?? false);
    }
    throw err;
  }
}

/**
 * Streaming Puter AI completion.
 * Transparently falls back to an anonymous SDK session if the account
 * hits quota (402 insufficient_funds) — same model, different credit pool.
 */
export async function puterAIStream(
  messages: PuterAIMessage[],
  onChunk: (text: string) => void,
  opts: { model?: string } = {},
): Promise<string> {
  const model = opts.model ?? "gpt-4o-mini";
  const { token } = await getAuth();
  try {
    return await rawStream(token, messages, model, onChunk);
  } catch (err) {
    const errBody = (err as { errBody?: string }).errBody ?? String(err);
    if (isQuotaResponse(errBody)) {
      logger.warn({ model }, "puter: user quota exhausted — retrying stream with anonymous SDK session");
      cachedSDKAuth = null;
      const sdkToken = await getSDKToken();
      logger.info({ model }, "puter: SDK fallback stream started");
      return await rawStream(sdkToken, messages, model, onChunk);
    }
    throw err;
  }
}

/** A self-test used by the /api/health route to surface Puter readiness. */
export async function puterPing(): Promise<{
  ok: boolean;
  username?: string;
  error?: string;
}> {
  if (!PUTER_CONFIGURED) {
    return { ok: false, error: "not_configured" };
  }
  try {
    const auth = await getAuth();
    return { ok: true, username: auth.username };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

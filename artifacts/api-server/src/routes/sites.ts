import crypto from "node:crypto";
import dns from "node:dns/promises";
import path from "node:path";

import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth } from "../middlewares/auth";
import {
  db,
  jobsTable,
  messagesTable,
  sitesTable,
  type Site,
  type SiteFiles,
} from "../lib/db";
import { jobQueue } from "../lib/queue";
import { inferSiteName, uniqueSlug } from "../lib/slug";
import { publicBaseUrl, publicHost } from "../lib/telegram";

const router: IRouter = Router();

const createSchema = z.object({
  prompt: z.string().min(4).max(1000),
  name: z.string().max(80).optional().nullable(),
  autoBuild: z.boolean().optional(),
});

const AUTO_BUILD_SENTINEL = "__AUTO_BUILD__";

const editSchema = z.object({
  prompt: z.string().min(4).max(1000),
});

const messageSchema = z.object({
  content: z.string().min(1).max(2000),
});

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;

const setDomainSchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .transform((s) =>
      s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, ""),
    )
    .refine((s) => DOMAIN_RE.test(s), { message: "invalid_domain" }),
});

function siteToDto(site: Site) {
  const baseUrl = publicBaseUrl();
  const slugUrl = baseUrl ? `${baseUrl}/api/hosted/${site.slug}/` : null;
  const customDomainVerified =
    site.customDomain && site.customDomainStatus === "verified";
  const publicUrl = customDomainVerified
    ? `https://${site.customDomain}`
    : slugUrl;
  return {
    id: site.id,
    name: site.name,
    slug: site.slug,
    prompt: site.prompt,
    status: site.status,
    progress: site.progress,
    message: site.message,
    error: site.error,
    coverColor: site.coverColor,
    previewUrl: slugUrl,
    publicUrl,
    files: site.files ? Object.keys(site.files) : [],
    analysis: site.analysis,
    plan: site.plan,
    customDomain: site.customDomain,
    customDomainStatus: site.customDomainStatus,
    customDomainError: site.customDomainError,
    customDomainTxtName: site.customDomain
      ? `_webforge.${site.customDomain}`
      : null,
    customDomainTxtValue: site.customDomainToken
      ? `webforge-verify=${site.customDomainToken}`
      : null,
    customDomainTarget: publicHost(),
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}

router.get("/sites", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.userId, req.user!.id))
    .orderBy(desc(sitesTable.createdAt));
  res.json(rows.map(siteToDto));
});

// POST /sites — kicks off ANALYSIS only. The user must call /confirm to
// actually build the project.
router.post("/sites", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    return;
  }
  const { prompt, name, autoBuild } = parsed.data;
  const finalName = (name?.trim() || inferSiteName(prompt)).slice(0, 80);
  const slug = await uniqueSlug(finalName);
  const autoBuildOn = autoBuild !== false; // default true

  const [site] = await db
    .insert(sitesTable)
    .values({
      userId: req.user!.id,
      name: finalName,
      slug,
      prompt,
      status: "queued",
      progress: 0,
      message: autoBuildOn
        ? "Queued — analyzing then building"
        : "Queued for analysis",
    })
    .returning();
  await db.insert(messagesTable).values({
    userId: req.user!.id,
    siteId: site.id,
    role: "user",
    kind: "text",
    content: prompt,
    data: null,
  });
  const [job] = await db
    .insert(jobsTable)
    .values({
      userId: req.user!.id,
      siteId: site.id,
      kind: "analyze",
      status: "queued",
      progress: 0,
      message: "Queued",
      instructions: autoBuildOn ? AUTO_BUILD_SENTINEL : null,
    })
    .returning();
  await jobQueue.enqueue(job.id);
  res.status(201).json(siteToDto(site));
});

router.get("/sites/:id", requireAuth, async (req, res) => {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(eq(sitesTable.id, String(req.params.id)), eq(sitesTable.userId, req.user!.id)),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(siteToDto(site));
});

router.delete("/sites/:id", requireAuth, async (req, res) => {
  const result = await db
    .delete(sitesTable)
    .where(
      and(eq(sitesTable.id, String(req.params.id)), eq(sitesTable.userId, req.user!.id)),
    )
    .returning({ id: sitesTable.id });
  if (result.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).send();
});

// POST /sites/:id/confirm — user accepts the analysis/plan. Starts the build.
router.post("/sites/:id/confirm", requireAuth, async (req, res) => {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(
        eq(sitesTable.id, String(req.params.id)),
        eq(sitesTable.userId, req.user!.id),
      ),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (site.status !== "awaiting_confirmation" && site.status !== "ready") {
    res.status(409).json({ error: "not_ready_for_confirmation", status: site.status });
    return;
  }
  await db.insert(messagesTable).values({
    userId: req.user!.id,
    siteId: site.id,
    role: "user",
    kind: "text",
    content: "Confirmed — please build it.",
    data: null,
  });
  const [job] = await db
    .insert(jobsTable)
    .values({
      userId: req.user!.id,
      siteId: site.id,
      kind: "create",
      status: "queued",
      progress: 0,
      message: "Queued",
    })
    .returning();
  await db
    .update(sitesTable)
    .set({
      status: "queued",
      progress: 0,
      message: "Queued for build",
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(sitesTable.id, site.id));
  await jobQueue.enqueue(job.id);
  const [updated] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.id, site.id))
    .limit(1);
  res.json(siteToDto(updated));
});

router.post("/sites/:id/edit", requireAuth, async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(eq(sitesTable.id, String(req.params.id)), eq(sitesTable.userId, req.user!.id)),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await db.insert(messagesTable).values({
    userId: req.user!.id,
    siteId: site.id,
    role: "user",
    kind: "text",
    content: parsed.data.prompt,
    data: null,
  });
  const [job] = await db
    .insert(jobsTable)
    .values({
      userId: req.user!.id,
      siteId: site.id,
      kind: "edit",
      status: "queued",
      progress: 0,
      instructions: parsed.data.prompt,
      message: "Queued",
    })
    .returning();
  await db
    .update(sitesTable)
    .set({
      status: "queued",
      progress: 0,
      message: "Queued for edit",
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(sitesTable.id, site.id));
  await jobQueue.enqueue(job.id);
  const [updated] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.id, site.id))
    .limit(1);
  res.json(siteToDto(updated));
});

router.post("/sites/:id/retry", requireAuth, async (req, res) => {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(eq(sitesTable.id, String(req.params.id)), eq(sitesTable.userId, req.user!.id)),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // Re-run analysis if there is no plan yet, otherwise re-build.
  const kind = site.plan ? "retry" : "analyze";
  const [job] = await db
    .insert(jobsTable)
    .values({
      userId: req.user!.id,
      siteId: site.id,
      kind,
      status: "queued",
      progress: 0,
      message: "Queued",
    })
    .returning();
  await db
    .update(sitesTable)
    .set({
      status: "queued",
      progress: 0,
      message: "Queued for retry",
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(sitesTable.id, site.id));
  await jobQueue.enqueue(job.id);
  const [updated] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.id, site.id))
    .limit(1);
  res.json(siteToDto(updated));
});

// --- Messages ---------------------------------------------------------------

router.get("/sites/:id/messages", requireAuth, async (req, res) => {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(
        eq(sitesTable.id, String(req.params.id)),
        eq(sitesTable.userId, req.user!.id),
      ),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.siteId, site.id))
    .orderBy(asc(messagesTable.createdAt));
  res.json(
    rows.map((m) => ({
      id: m.id,
      siteId: m.siteId,
      role: m.role,
      kind: m.kind,
      content: m.content,
      data: m.data,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

router.post("/sites/:id/messages", requireAuth, async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(
        eq(sitesTable.id, String(req.params.id)),
        eq(sitesTable.userId, req.user!.id),
      ),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const content = parsed.data.content.trim();
  await db.insert(messagesTable).values({
    userId: req.user!.id,
    siteId: site.id,
    role: "user",
    kind: "text",
    content,
    data: null,
  });

  // Treat "build" / "yes" / "go" / "ship it" as a confirmation when the site
  // is awaiting one. This makes the chat feel like a real agent.
  const lc = content.toLowerCase();
  const wantsBuild =
    /^(build|yes|go|ship it|do it|confirm|approve|let'?s go|sounds good)\b/.test(
      lc,
    );

  if (site.status === "awaiting_confirmation" && wantsBuild) {
    const [job] = await db
      .insert(jobsTable)
      .values({
        userId: req.user!.id,
        siteId: site.id,
        kind: "create",
        status: "queued",
        progress: 0,
        message: "Queued",
      })
      .returning();
    await db
      .update(sitesTable)
      .set({
        status: "queued",
        progress: 0,
        message: "Queued for build",
        updatedAt: new Date(),
      })
      .where(eq(sitesTable.id, site.id));
    await jobQueue.enqueue(job.id);
  } else if (site.status === "ready") {
    // Treat any chat after ready state as an edit request.
    const [job] = await db
      .insert(jobsTable)
      .values({
        userId: req.user!.id,
        siteId: site.id,
        kind: "edit",
        status: "queued",
        progress: 0,
        instructions: content,
        message: "Queued",
      })
      .returning();
    await db
      .update(sitesTable)
      .set({
        status: "queued",
        progress: 0,
        message: "Queued for edit",
        updatedAt: new Date(),
      })
      .where(eq(sitesTable.id, site.id));
    await jobQueue.enqueue(job.id);
  } else {
    await db.insert(messagesTable).values({
      userId: req.user!.id,
      siteId: site.id,
      role: "agent",
      kind: "text",
      content:
        "I'll get to that as soon as the current step finishes. You can also tap the buttons below the chat.",
      data: null,
    });
  }

  res.status(202).json({ ok: true });
});

// --- Domain endpoints (unchanged behavior) ---------------------------------

router.post("/sites/:id/domain", requireAuth, async (req, res) => {
  const parsed = setDomainSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "invalid_input", issues: parsed.error.issues });
    return;
  }
  const domain = parsed.data.domain;
  const targetHost = publicHost();
  if (
    targetHost &&
    (domain === targetHost ||
      domain.endsWith(".replit.dev") ||
      domain.endsWith(".replit.app") ||
      domain.endsWith(".picard.replit.dev"))
  ) {
    res.status(400).json({ error: "domain_not_allowed" });
    return;
  }
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(
        eq(sitesTable.id, String(req.params.id)),
        eq(sitesTable.userId, req.user!.id),
      ),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const conflict = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(eq(sitesTable.customDomain, domain))
    .limit(1);
  if (conflict.length > 0 && conflict[0].id !== site.id) {
    res.status(409).json({ error: "domain_in_use" });
    return;
  }
  const token = crypto.randomBytes(16).toString("hex");
  const [updated] = await db
    .update(sitesTable)
    .set({
      customDomain: domain,
      customDomainStatus: "pending",
      customDomainToken: token,
      customDomainError: null,
      updatedAt: new Date(),
    })
    .where(eq(sitesTable.id, site.id))
    .returning();
  res.json(siteToDto(updated));
});

router.delete("/sites/:id/domain", requireAuth, async (req, res) => {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(
        eq(sitesTable.id, String(req.params.id)),
        eq(sitesTable.userId, req.user!.id),
      ),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [updated] = await db
    .update(sitesTable)
    .set({
      customDomain: null,
      customDomainStatus: null,
      customDomainToken: null,
      customDomainError: null,
      updatedAt: new Date(),
    })
    .where(eq(sitesTable.id, site.id))
    .returning();
  res.json(siteToDto(updated));
});

router.post("/sites/:id/domain/verify", requireAuth, async (req, res) => {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(
        eq(sitesTable.id, String(req.params.id)),
        eq(sitesTable.userId, req.user!.id),
      ),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!site.customDomain || !site.customDomainToken) {
    res.status(400).json({ error: "no_domain" });
    return;
  }
  const txtName = `_webforge.${site.customDomain}`;
  const expected = `webforge-verify=${site.customDomainToken}`;
  let verified = false;
  let lastError: string | null = null;
  try {
    const records = await dns.resolveTxt(txtName);
    const flat = records.map((chunks) => chunks.join(""));
    verified = flat.includes(expected);
    if (!verified) {
      lastError = `TXT record not found at ${txtName}. Expected "${expected}".`;
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : "DNS lookup failed";
  }
  const [updated] = await db
    .update(sitesTable)
    .set({
      customDomainStatus: verified ? "verified" : "failed",
      customDomainError: verified ? null : lastError,
      updatedAt: new Date(),
    })
    .where(eq(sitesTable.id, site.id))
    .returning();
  res.json(siteToDto(updated));
});

// --- Public hosted route ---------------------------------------------------

// /api/hosted/:slug → redirect to /api/hosted/:slug/index.html
router.get("/hosted/:slug", (req, res) => {
  res.redirect(302, `/api/hosted/${req.params.slug}/`);
});

router.get("/hosted/:slug/", async (req, res) => {
  await serveSiteFile(req.params.slug, "index.html", res);
});

router.get("/hosted/:slug/*splat", async (req, res) => {
  const wildcard = (req.params as unknown as { splat?: string | string[] })
    .splat;
  const sub = Array.isArray(wildcard)
    ? wildcard.join("/")
    : (wildcard ?? "index.html");
  await serveSiteFile(req.params.slug, sub || "index.html", res);
});

async function serveSiteFile(
  slug: string,
  rel: string,
  res: import("express").Response,
): Promise<void> {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.slug, slug))
    .limit(1);
  if (!site) {
    res.status(404).type("html").send(notFoundPage());
    return;
  }
  if (site.status !== "ready" || !site.files) {
    res.status(202).type("html").send(generatingPage(site));
    return;
  }
  const safeRel = normalizeRel(rel) ?? "index.html";
  const content = pickFile(site.files, safeRel);
  if (content == null) {
    res.status(404).type("html").send(notFoundPage());
    return;
  }
  res.type(contentType(safeRel)).send(content);
}

export function pickFile(files: SiteFiles, rel: string): string | null {
  if (Object.prototype.hasOwnProperty.call(files, rel)) return files[rel];
  if (rel === "" || rel === "/") return files["index.html"] ?? null;
  return null;
}

export function normalizeRel(rel: string): string | null {
  const cleaned = decodeURIComponent(rel)
    .replace(/^\/+/, "")
    .replace(/\.\.\//g, "");
  if (cleaned.includes("..") || path.isAbsolute(cleaned)) return null;
  return cleaned || "index.html";
}

function contentType(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  switch (ext) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function notFoundPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Not found</title>
  <style>body{background:#0A0E14;color:#E6EDF3;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}</style>
  </head><body><div><h1>404</h1><p>This page doesn't exist.</p></div></body></html>`;
}

function generatingPage(site: Site): string {
  const stage = site.status === "awaiting_confirmation"
    ? "Waiting for your confirmation"
    : site.message ?? "Working";
  return `<!doctype html><html><head><meta charset="utf-8"/><meta http-equiv="refresh" content="2"/>
  <title>${site.name} — building</title>
  <style>
  body{background:#0A0E14;color:#E6EDF3;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
  .bar{width:280px;height:4px;background:#1F2937;border-radius:999px;overflow:hidden;margin:16px auto}
  .bar > div{height:100%;background:#00FFC2;width:${site.progress}%;transition:width .3s}
  .msg{color:#7D8590;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  h1{font-weight:800;letter-spacing:-0.02em}
  </style></head>
  <body><div>
  <h1>${site.status === "awaiting_confirmation" ? "Waiting on you" : `Forging ${site.name}…`}</h1>
  <div class="bar"><div></div></div>
  <div class="msg">${stage} — ${site.progress}%</div>
  </div></body></html>`;
}

export default router;

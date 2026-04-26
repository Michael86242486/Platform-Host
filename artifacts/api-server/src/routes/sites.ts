import crypto from "node:crypto";
import dns from "node:dns/promises";

import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth } from "../middlewares/auth";
import { db, jobsTable, sitesTable, type Site } from "../lib/db";
import { jobQueue } from "../lib/queue";
import { inferSiteName, uniqueSlug } from "../lib/slug";
import { publicBaseUrl, publicHost } from "../lib/telegram";

const router: IRouter = Router();

const createSchema = z.object({
  prompt: z.string().min(4).max(1000),
  name: z.string().max(80).optional().nullable(),
});

const editSchema = z.object({
  prompt: z.string().min(4).max(1000),
});

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;

const setDomainSchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .transform((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .refine((s) => DOMAIN_RE.test(s), { message: "invalid_domain" }),
});

function siteToDto(site: Site) {
  const baseUrl = publicBaseUrl();
  const slugUrl = baseUrl ? `${baseUrl}/api/hosted/${site.slug}` : null;
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

router.post("/sites", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    return;
  }
  const { prompt, name } = parsed.data;
  const finalName = (name?.trim() || inferSiteName(prompt)).slice(0, 80);
  const slug = await uniqueSlug(finalName);

  const [site] = await db
    .insert(sitesTable)
    .values({
      userId: req.user!.id,
      name: finalName,
      slug,
      prompt,
      status: "queued",
      progress: 0,
      message: "Queued",
    })
    .returning();
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
      message: "Queued",
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
  const [job] = await db
    .insert(jobsTable)
    .values({
      userId: req.user!.id,
      siteId: site.id,
      kind: "retry",
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
      message: "Queued",
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

// Public hosted route — serves rendered HTML for a site by slug.
router.get("/hosted/:slug", async (req, res) => {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.slug, String(req.params.slug)))
    .limit(1);
  if (!site) {
    res.status(404).type("html").send(notFoundPage());
    return;
  }
  if (site.status !== "ready" || !site.html) {
    res.status(202).type("html").send(generatingPage(site));
    return;
  }
  res.type("html").send(site.html);
});

function notFoundPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Not found</title>
  <style>body{background:#0A0E14;color:#E6EDF3;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}</style>
  </head><body><div><h1>404</h1><p>This site doesn't exist or was deleted.</p></div></body></html>`;
}

function generatingPage(site: Site): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta http-equiv="refresh" content="2"/>
  <title>${site.name} — generating</title>
  <style>
  body{background:#0A0E14;color:#E6EDF3;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
  .bar{width:280px;height:4px;background:#1F2937;border-radius:999px;overflow:hidden;margin:16px auto}
  .bar > div{height:100%;background:#00FFC2;width:${site.progress}%;transition:width .3s}
  .msg{color:#7D8590;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  h1{font-weight:800;letter-spacing:-0.02em}
  </style></head>
  <body><div>
  <h1>Forging ${site.name}…</h1>
  <div class="bar"><div></div></div>
  <div class="msg">${site.message ?? "Working"} — ${site.progress}%</div>
  </div></body></html>`;
}

export default router;

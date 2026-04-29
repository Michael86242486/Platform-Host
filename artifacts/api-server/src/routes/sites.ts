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
  sessionsTable,
  sitesTable,
  usersTable,
  type Site,
  type SiteFiles,
} from "../lib/db";
import { jobQueue } from "../lib/queue";
import { siteEventBus, type SiteEvent } from "../lib/eventBus";
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

// --- Server-Sent Events: live site activity --------------------------------

// EventSource doesn't support custom headers in browsers, so SSE auth uses
// a `?token=` query param (same wf_… session token used elsewhere). We also
// honor the standard Authorization header for native clients that wrap fetch.
async function userFromSseAuth(req: import("express").Request) {
  const headerBearer = (() => {
    const h = req.headers.authorization;
    return h?.startsWith("Bearer ") ? h.slice(7) : null;
  })();
  const queryToken =
    typeof req.query.token === "string" ? req.query.token : null;
  const token = headerBearer || queryToken;
  if (!token || !token.startsWith("wf_")) return null;
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.token, token))
    .limit(1);
  if (!session || session.expiresAt < new Date()) return null;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);
  return user ?? null;
}

router.get("/sites/:id/events", async (req, res) => {
  const user = await userFromSseAuth(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(
      and(
        eq(sitesTable.id, String(req.params.id)),
        eq(sitesTable.userId, user.id),
      ),
    )
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // Standard SSE headers. `X-Accel-Buffering: no` keeps proxies from buffering.
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Hello frame so the client knows the stream is alive.
  send("hello", { siteId: site.id, ts: Date.now() });
  send("site_updated", { siteId: site.id });

  const onEvent = (ev: SiteEvent) => {
    send(ev.type, ev);
  };
  const unsubscribe = siteEventBus.subscribe(site.id, onEvent);

  // Keepalive ping every 20s; some proxies (and React Native fetch) close
  // idle connections after ~30s.
  const keepalive = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 20000);

  const close = () => {
    clearInterval(keepalive);
    unsubscribe();
    try {
      res.end();
    } catch {
      // already closed
    }
  };
  req.on("close", close);
  req.on("aborted", close);
});

// --- Public hosted route ---------------------------------------------------

// /api/hosted/:slug (no trailing slash) → redirect to the canonical "/" form.
// We guard on req.path because Express 5's loose routing also matches the
// trailing-slash variant, which would cause a redirect loop here.
router.get("/hosted/:slug", (req, res, next) => {
  if (req.path.endsWith("/")) {
    next();
    return;
  }
  res.redirect(302, `/api/hosted/${req.params.slug}/`);
});

// Raw routes — always serve the actual site bytes (no preview chrome).
// Used by the preview shell's iframe and by visitors who want the bare site.
router.get("/hosted/:slug/_raw/", async (req, res) => {
  await serveSiteFile(req.params.slug, "index.html", res, { raw: true });
});
router.get("/hosted/:slug/_raw/*splat", async (req, res) => {
  const wildcard = (req.params as unknown as { splat?: string | string[] })
    .splat;
  const sub = Array.isArray(wildcard)
    ? wildcard.join("/")
    : (wildcard ?? "index.html");
  await serveSiteFile(req.params.slug, sub || "index.html", res, { raw: true });
});

// JSON status feed — the preview shell polls this to update the right panel
// without reloading the iframe.
router.get("/hosted/:slug/_status", async (req, res) => {
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.slug, req.params.slug))
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const files = site.files ?? {};
  const fileList = Object.keys(files)
    .sort()
    .map((path) => ({ path, bytes: (files[path] ?? "").length }));
  const totalBytes = fileList.reduce((acc, f) => acc + f.bytes, 0);
  res.set("Cache-Control", "no-store").json({
    name: site.name,
    status: site.status,
    progress: site.progress ?? 0,
    message: site.message ?? "",
    files: fileList,
    totalBytes,
    updatedAt: site.updatedAt,
  });
});

router.get("/hosted/:slug/", async (req, res) => {
  await serveSiteFile(req.params.slug, "index.html", res, { raw: false });
});

router.get("/hosted/:slug/*splat", async (req, res) => {
  const wildcard = (req.params as unknown as { splat?: string | string[] })
    .splat;
  const sub = Array.isArray(wildcard)
    ? wildcard.join("/")
    : (wildcard ?? "index.html");
  await serveSiteFile(req.params.slug, sub || "index.html", res, {
    raw: false,
  });
});

async function serveSiteFile(
  slug: string,
  rel: string,
  res: import("express").Response,
  opts: { raw: boolean } = { raw: false },
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

  const safeRel = normalizeRel(rel) ?? "index.html";
  const files = site.files ?? {};
  const partial = pickFile(files, safeRel);
  const isBuilding =
    site.status === "building" || site.status === "analyzing";
  const isHtml =
    safeRel.endsWith(".html") || safeRel === "" || safeRel === "/";
  const isRootPage = safeRel === "index.html";

  // The pro split-screen preview shell only ever renders for the root page on
  // the non-raw route. Sub-pages and the iframe target use the raw branch.
  if (!opts.raw && isRootPage && (isBuilding || site.status === "ready")) {
    res
      .status(200)
      .set("Cache-Control", "no-store, no-cache, must-revalidate")
      .type("text/html; charset=utf-8")
      .send(previewShell(site));
    return;
  }

  // While building, return any partial HTML/CSS/JS we have so the iframe shows
  // the LLM's tokens streaming in real time.
  if (isBuilding) {
    if (isHtml) {
      const html = partial ?? "";
      res
        .status(200)
        .set("Cache-Control", "no-store, no-cache, must-revalidate")
        .type("text/html; charset=utf-8")
        .send(html || streamingPlaceholder(site));
      return;
    }
    if (partial != null) {
      res
        .status(200)
        .set("Cache-Control", "no-store, no-cache, must-revalidate")
        .type(contentType(safeRel))
        .send(partial);
      return;
    }
  }

  if (site.status === "queued" || site.status === "awaiting_confirmation") {
    res.status(202).type("html").send(generatingPage(site));
    return;
  }

  if (site.status !== "ready" || !site.files) {
    res.status(202).type("html").send(generatingPage(site));
    return;
  }

  const content = pickFile(site.files, safeRel);
  if (content == null) {
    res.status(404).type("html").send(notFoundPage());
    return;
  }
  res.type(contentType(safeRel)).send(content);
}

/**
 * The polished split-screen preview shell.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  ← Back        WebForge — Live Preview            ⟳  ⤓ Open │
 *   ├────────────────────────────────────────┬─────────────────────┤
 *   │                                        │  ● Live              │
 *   │                                        │  Building            │
 *   │                                        │  ▰▰▰▰▰▰▰▱▱▱  62%      │
 *   │             [ iframe of               ]│                      │
 *   │              the actual site          ]│  Activity            │
 *   │                                        │  • assets/styles.css │
 *   │                                        │  • assets/app.js     │
 *   │                                        │  • index.html        │
 *   │                                        │                      │
 *   │                                        │  Pages               │
 *   │                                        │  - index.html        │
 *   │                                        │                      │
 *   │                                        │  Tell the AI ...     │
 *   └────────────────────────────────────────┴─────────────────────┘
 *
 * The iframe loads `_raw/index.html` — that branch always returns the bare
 * site bytes so we don't recurse into the shell. The right panel polls
 * `_status` for live progress + file list and refreshes the iframe whenever
 * the byte count changes.
 */
function previewShell(site: Site): string {
  const slug = site.slug;
  const name = escapeHtml(site.name);
  const initialJson = JSON.stringify({
    slug,
    name: site.name,
    status: site.status,
    progress: Math.max(0, Math.min(100, site.progress ?? 0)),
    message: site.message ?? "",
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#0d1117"/>
<title>${name} — WebForge Preview</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2300ffc2'/%3E%3Cpath d='M9 11l4 10 3-7 3 7 4-10' fill='none' stroke='%230d1117' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"/>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;background:#0d1117;color:#c9d1d9;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent}
a{color:inherit;text-decoration:none}
.app{display:flex;flex-direction:column;height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-bottom:1px solid #1f2630;background:rgba(13,17,23,0.85);backdrop-filter:blur(8px)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:0.02em}
.brand .logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#00ffc2,#58a6ff);box-shadow:0 0 18px rgba(0,255,194,0.35)}
.brand .name{color:#e6edf3}
.brand .sep{color:#3d4451}
.brand .title{color:#7d8590;max-width:38vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand .pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:11px;color:#7ee2c4;background:rgba(0,255,194,0.08);border:1px solid rgba(0,255,194,0.22)}
.brand .pill .dot{width:6px;height:6px;border-radius:50%;background:#00ffc2;box-shadow:0 0 8px #00ffc2;animation:pulse 1.4s ease-in-out infinite}
.actions{display:flex;align-items:center;gap:8px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;font-size:12px;color:#c9d1d9;background:#161b22;border:1px solid #2a313c;transition:all .15s}
.btn:hover{background:#1f2630;border-color:#3d4451}
.btn.primary{background:linear-gradient(135deg,#00ffc2,#58a6ff);color:#0d1117;border-color:transparent;font-weight:700}
.btn.primary:hover{filter:brightness(1.08)}
.split{flex:1;display:flex;min-height:0}
.left{flex:1;background:#0d1117;position:relative;overflow:hidden}
.left iframe{width:100%;height:100%;border:0;background:#fff;display:block}
.left .scrim{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7d8590;font-size:13px;pointer-events:none;opacity:0;transition:opacity .25s}
.left.loading .scrim{opacity:1}
.right{width:380px;min-width:300px;max-width:42vw;border-left:1px solid #1f2630;display:flex;flex-direction:column;background:#0a0e14}
.section{padding:14px 16px;border-bottom:1px solid #1f2630}
.section:last-child{border-bottom:0}
.section h3{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#7d8590}
.statusrow{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#c9d1d9}
.statusrow .live{display:inline-flex;align-items:center;gap:8px;color:#7ee2c4}
.statusrow .live .dot{width:7px;height:7px;border-radius:50%;background:#00ffc2;box-shadow:0 0 10px #00ffc2;animation:pulse 1.4s ease-in-out infinite}
.statusrow .live.ready .dot{animation:none}
.bar{margin-top:10px;height:4px;background:#161b22;border-radius:999px;overflow:hidden}
.bar > div{height:100%;background:linear-gradient(90deg,#00ffc2,#58a6ff);width:0%;transition:width .35s ease}
.metaline{margin-top:8px;font-size:11px;color:#7d8590;display:flex;justify-content:space-between}
.activity{flex:1;overflow:auto;padding:10px 16px;font-size:12px;line-height:1.55}
.activity .row{display:flex;justify-content:space-between;gap:12px;padding:4px 0;color:#c9d1d9;border-bottom:1px dashed #1f2630}
.activity .row:last-child{border-bottom:0}
.activity .row .path{color:#9eecd0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.activity .row .size{color:#7d8590;flex-shrink:0;font-variant-numeric:tabular-nums}
.activity .empty{color:#3d4451;font-style:italic;padding:8px 0}
.steps{display:grid;gap:6px;margin-top:6px;font-size:11.5px}
.steps .s{display:flex;align-items:center;gap:8px;color:#5a6373}
.steps .s .ico{width:14px;height:14px;border-radius:50%;border:1.5px solid #2a313c;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:transparent;flex-shrink:0}
.steps .s.done{color:#7ee2c4}
.steps .s.done .ico{background:#00ffc2;border-color:#00ffc2;color:#0d1117}
.steps .s.cur{color:#e6edf3}
.steps .s.cur .ico{border-color:#58a6ff;animation:pulse 1.2s ease-in-out infinite}
.composer{padding:12px 16px;border-top:1px solid #1f2630;background:#0a0e14}
.composer textarea{width:100%;resize:none;height:64px;padding:10px 12px;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9;background:#161b22;border:1px solid #2a313c;border-radius:8px;outline:none;transition:border-color .15s}
.composer textarea:focus{border-color:#58a6ff}
.composer .row{display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px}
.composer .hint{font-size:10.5px;color:#5a6373;line-height:1.4}
.composer .hint code{color:#9eecd0;background:rgba(0,255,194,0.06);padding:1px 5px;border-radius:4px}
.composer button{padding:7px 14px;border-radius:7px;font-size:12px;font-weight:700;color:#0d1117;background:linear-gradient(135deg,#00ffc2,#58a6ff)}
.composer button:disabled{opacity:0.55;cursor:not-allowed}
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#161b22;border:1px solid #2a313c;color:#c9d1d9;padding:9px 14px;border-radius:8px;font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@media (max-width:760px){
  .right{position:absolute;right:0;top:0;bottom:0;width:88%;max-width:380px;transform:translateX(100%);transition:transform .25s;z-index:5;box-shadow:-10px 0 40px rgba(0,0,0,.5)}
  .right.open{transform:translateX(0)}
  .actions .toggle{display:inline-flex}
}
@media (min-width:761px){.actions .toggle{display:none}}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo"></span>
      <span class="name">WebForge</span>
      <span class="sep">/</span>
      <span class="title" id="siteTitle">${name}</span>
      <span class="pill" id="livePill"><span class="dot"></span><span id="livePillText">Building</span></span>
    </div>
    <div class="actions">
      <button class="btn" id="reloadBtn" title="Reload preview">⟳ Reload</button>
      <a class="btn" href="_raw/" target="_blank" rel="noopener" title="Open the bare site in a new tab">⤓ Open</a>
      <button class="btn toggle" id="toggleRight" title="Toggle panel">☰</button>
    </div>
  </header>
  <div class="split">
    <div class="left" id="left">
      <iframe id="frame" src="_raw/" title="Live website preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
      <div class="scrim">Refreshing preview…</div>
    </div>
    <aside class="right" id="right">
      <div class="section">
        <h3>Status</h3>
        <div class="statusrow">
          <span class="live" id="liveLabel"><span class="dot"></span><span id="liveText">Building</span></span>
          <span id="msgText" style="color:#7d8590;font-size:11px;max-width:55%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        </div>
        <div class="bar"><div id="barFill"></div></div>
        <div class="metaline"><span id="pctText">0%</span><span id="byteText">0 B</span></div>
        <div class="steps" id="steps"></div>
      </div>
      <div class="section" style="flex-shrink:0">
        <h3>Pages &amp; assets</h3>
        <div class="activity" id="files" style="padding:0;max-height:260px"><div class="empty">waiting for the first byte…</div></div>
      </div>
      <div style="flex:1"></div>
      <div class="composer">
        <h3 style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#7d8590">Tell the AI what to change</h3>
        <textarea id="editBox" placeholder="e.g. swap the hero copy to lead with our 30-day refund guarantee, then tighten the pricing table"></textarea>
        <div class="row">
          <span class="hint">Open Telegram &rarr; <code>/edit ${name}</code></span>
          <button id="copyBtn">Copy command</button>
        </div>
      </div>
    </aside>
  </div>
</div>
<div class="toast" id="toast"></div>
<script id="initial" type="application/json">${initialJson}</script>
<script>
(function(){
  var STEPS = [
    { p: 5,   label: "Researching design inspiration" },
    { p: 18,  label: "Building the full website with AI" },
    { p: 55,  label: "Auditing quality (SEO, a11y, mobile)" },
    { p: 72,  label: "Self-review pass (autonomous QA)" },
    { p: 84,  label: "Auto-fixing issues found" },
    { p: 92,  label: "Generating AI hero image" },
    { p: 100, label: "Publishing to your live URL" }
  ];
  var initial = JSON.parse(document.getElementById("initial").textContent);
  var slug = initial.slug;
  var statusUrl = "_status";
  var rawUrl = "_raw/?";
  var lastBytes = -1;
  var lastStatus = initial.status;
  var refreshing = false;
  var frame = document.getElementById("frame");
  var leftEl = document.getElementById("left");
  var pollMs = 800;
  var stopped = false;

  function fmtBytes(n){
    if (n < 1024) return n + " B";
    if (n < 1024*1024) return (n/1024).toFixed(1) + " KB";
    return (n/1024/1024).toFixed(2) + " MB";
  }

  function renderSteps(progress, ready){
    var html = "";
    var idx = ready ? STEPS.length : (function(){
      for (var i=0;i<STEPS.length;i++){ if (progress < STEPS[i].p) return i; }
      return STEPS.length - 1;
    })();
    for (var i=0;i<STEPS.length;i++){
      var cls = (i < idx) ? "done" : (i === idx ? "cur" : "");
      var ico = (i < idx) ? "✓" : "";
      html += '<div class="s '+cls+'"><span class="ico">'+ico+'</span><span>'+STEPS[i].label+'</span></div>';
    }
    document.getElementById("steps").innerHTML = html;
  }

  function renderFiles(files){
    var box = document.getElementById("files");
    if (!files || !files.length){
      box.innerHTML = '<div class="empty" style="padding:8px 16px">waiting for the first byte…</div>';
      return;
    }
    var html = "";
    for (var i=0;i<files.length;i++){
      html += '<div class="row" style="padding:6px 16px"><span class="path">'+escapeHtml(files[i].path)+'</span><span class="size">'+fmtBytes(files[i].bytes)+'</span></div>';
    }
    box.innerHTML = html;
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];}); }

  function refreshFrame(){
    if (refreshing) return;
    refreshing = true;
    leftEl.classList.add("loading");
    try {
      frame.contentWindow.location.replace(rawUrl + "t=" + Date.now());
    } catch (e) {
      frame.src = rawUrl + "t=" + Date.now();
    }
    setTimeout(function(){ leftEl.classList.remove("loading"); refreshing = false; }, 500);
  }

  function setStatus(d){
    document.getElementById("siteTitle").textContent = d.name || initial.name;
    var ready = d.status === "ready";
    var pct = Math.max(0, Math.min(100, d.progress || 0));
    document.getElementById("barFill").style.width = pct + "%";
    document.getElementById("pctText").textContent = pct + "%";
    document.getElementById("byteText").textContent = fmtBytes(d.totalBytes || 0);
    document.getElementById("msgText").textContent = d.message || "";
    var pillText = ready ? "Live" : (d.status === "queued" ? "Queued" : "Building");
    document.getElementById("livePillText").textContent = pillText;
    document.getElementById("liveText").textContent = pillText;
    var liveLabel = document.getElementById("liveLabel");
    if (ready) liveLabel.classList.add("ready"); else liveLabel.classList.remove("ready");
    renderSteps(pct, ready);
    renderFiles(d.files || []);
  }

  async function poll(){
    if (stopped) return;
    try {
      var r = await fetch(statusUrl, { cache: "no-store" });
      if (r.ok){
        var d = await r.json();
        setStatus(d);
        if (d.totalBytes !== lastBytes || d.status !== lastStatus){
          refreshFrame();
          lastBytes = d.totalBytes;
          lastStatus = d.status;
        }
        if (d.status === "ready"){
          pollMs = 5000;
        } else if (d.status === "failed"){
          stopped = true;
        }
      }
    } catch (e) {}
    setTimeout(poll, pollMs);
  }

  document.getElementById("reloadBtn").addEventListener("click", refreshFrame);
  document.getElementById("toggleRight").addEventListener("click", function(){
    document.getElementById("right").classList.toggle("open");
  });
  document.getElementById("copyBtn").addEventListener("click", function(){
    var txt = document.getElementById("editBox").value.trim();
    var cmd = "/edit " + (initial.name || "site") + (txt ? " " + txt : "");
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(cmd).then(function(){ toast("Copied — paste it into the WebForge bot"); });
    } else {
      var ta = document.createElement("textarea"); ta.value = cmd; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("Copied — paste it into the WebForge bot"); } catch(e){ toast("Copy failed"); }
      document.body.removeChild(ta);
    }
  });
  function toast(msg){
    var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function(){ t.classList.remove("show"); }, 2200);
  }

  // Seed the UI from the initial server state, then start polling.
  setStatus({ name: initial.name, status: initial.status, progress: initial.progress, message: initial.message, totalBytes: 0, files: [] });
  poll();
})();
</script>
</body></html>`;
}

/**
 * The empty-iframe placeholder shown for ~1 second before the model writes the
 * first byte of HTML. Plain, calm, on-brand.
 */
function streamingPlaceholder(site: Site): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta http-equiv="refresh" content="1"/>
  <style>
  html,body{margin:0;height:100%;background:#fafbfc;color:#7d8590;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;align-items:center;justify-content:center}
  .w{display:flex;align-items:center;gap:10px;font-size:13px}
  .d{width:8px;height:8px;border-radius:50%;background:#00ffc2;box-shadow:0 0 12px #00ffc2;animation:p 1.2s ease-in-out infinite}
  @keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
  </style></head>
  <body><div class="w"><span class="d"></span><span>${escapeHtml(site.name)} — waiting for the first byte…</span></div></body></html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

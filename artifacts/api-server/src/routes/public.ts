import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, sitesTable } from "../lib/db";
import { logger } from "../lib/logger";
import { publicBaseUrl } from "../lib/telegram";

const router: IRouter = Router();

function siteToPublicDto(site: typeof sitesTable.$inferSelect) {
  const baseUrl = publicBaseUrl();
  const internalPreviewUrl = baseUrl
    ? `${baseUrl}/api/hosted/${site.slug}/`
    : null;
  const publicUrl = site.puterPublicUrl ?? internalPreviewUrl;
  return {
    id: site.id,
    name: site.name,
    slug: site.slug,
    coverColor: site.coverColor,
    status: site.status,
    publicUrl,
    shareToken: site.shareToken,
    createdAt: site.createdAt.toISOString(),
  };
}

router.get("/public/sites/:shareToken", async (req: Request, res: Response) => {
  const { shareToken } = req.params;
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.shareToken, shareToken))
    .limit(1);
  if (!site) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(siteToPublicDto(site));
});

router.get("/public/sites/:shareToken/preview", async (req: Request, res: Response) => {
  const { shareToken } = req.params;
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.shareToken, shareToken))
    .limit(1);
  if (!site) {
    res.status(404).send("Site not found");
    return;
  }
  if (!site.files || typeof site.files !== "object") {
    res.status(404).send("Site files not available yet");
    return;
  }
  const files = site.files as Record<string, string>;
  const html = files["index.html"];
  if (!html) {
    res.status(404).send("No index.html");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.send(html);
});

router.get(/^\/public\/sites\/([^/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const shareToken = req.params[0] ?? "";
  const filePath = req.params[1] ?? "";

  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.shareToken, shareToken))
    .limit(1);
  if (!site || !site.files || typeof site.files !== "object") {
    res.status(404).send("Not found");
    return;
  }
  const files = site.files as Record<string, string>;
  const content = files[filePath];
  if (!content) {
    res.status(404).send("File not found");
    return;
  }
  const ext = filePath.split(".").pop() ?? "";
  const mimeMap: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    ico: "image/x-icon",
  };
  res.setHeader("Content-Type", mimeMap[ext] ?? "text/plain");
  res.send(content);
});

export default router;

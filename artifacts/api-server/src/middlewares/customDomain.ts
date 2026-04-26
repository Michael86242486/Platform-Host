import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";

import { db, sitesTable, type Site } from "../lib/db";
import { publicHost } from "../lib/telegram";

const SYSTEM_HOST_SUFFIXES = [".replit.dev", ".replit.app", ".picard.replit.dev"];

function isSystemHost(host: string): boolean {
  if (!host) return true;
  const normalized = host.split(":")[0].toLowerCase();
  if (normalized === publicHost().toLowerCase()) return true;
  if (normalized === "localhost" || normalized === "127.0.0.1") return true;
  return SYSTEM_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export const customDomain: RequestHandler = async (req, res, next) => {
  const hostHeader = (req.headers.host ?? "").toString();
  const host = hostHeader.split(":")[0].toLowerCase();
  if (!host || isSystemHost(host)) {
    next();
    return;
  }
  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.customDomain, host))
    .limit(1);
  if (!site) {
    next();
    return;
  }
  if (site.customDomainStatus !== "verified") {
    res.status(421).type("html").send(unverifiedPage(host));
    return;
  }
  if (site.status !== "ready" || !site.html) {
    res.status(202).type("html").send(generatingPage(site));
    return;
  }
  res.type("html").send(site.html);
};

function unverifiedPage(host: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Domain not verified</title>
  <style>body{background:#0A0E14;color:#E6EDF3;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
  code{background:#1F2937;padding:2px 6px;border-radius:4px;color:#00FFC2;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style>
  </head><body><div><h1>Almost there.</h1>
  <p>The domain <code>${host}</code> is reaching WebForge, but it has not been verified yet.</p>
  <p>Open the WebForge app, go to your site, then tap <strong>Verify domain</strong>.</p></div></body></html>`;
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

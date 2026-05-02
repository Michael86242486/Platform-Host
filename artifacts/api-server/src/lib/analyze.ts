/**
 * Site quality analyser — pure file-based checks, no external service.
 * Shared by the REST API route AND the Telegram notifier.
 */

export type QualityIssue = {
  category: "seo" | "a11y" | "perf" | "mobile" | "code";
  severity: "critical" | "warning" | "info";
  message: string;
  fix: string;
};

export type QualityReport = {
  scores: { seo: number; a11y: number; perf: number; mobile: number; code: number };
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  issues: QualityIssue[];
  stats: {
    totalKB: string;
    fileCount: number;
    htmlCount: number;
    cssCount: number;
    jsCount: number;
    imgCount: number;
  };
};

export function scoreToGrade(s: number): "A" | "B" | "C" | "D" | "F" {
  if (s >= 90) return "A";
  if (s >= 80) return "B";
  if (s >= 70) return "C";
  if (s >= 60) return "D";
  return "F";
}

export function analyzeSiteFiles(files: Record<string, string>): QualityReport {
  const html = (
    Object.entries(files).find(([k]) => k === "index.html") ??
    Object.entries(files).find(([k]) => k.endsWith(".html"))
  )?.[1] ?? "";
  const allCSS = Object.entries(files).filter(([k]) => k.endsWith(".css")).map(([, v]) => v).join("\n");

  const issues: QualityIssue[] = [];

  // ── SEO ──────────────────────────────────────────────────────────────
  let seoScore = 100;
  if (!/<title[^>]*>[^<]{1,}/i.test(html)) {
    issues.push({ category: "seo", severity: "critical", message: "Missing <title> tag", fix: "Add a descriptive <title> inside <head>." }); seoScore -= 25;
  }
  if (!/<meta[^>]*name=["']description["'][^>]*content=["'][^"']{10,}/i.test(html)) {
    issues.push({ category: "seo", severity: "warning", message: "Missing or empty meta description", fix: "Add <meta name=\"description\" content=\"…\"> with 120–160 chars." }); seoScore -= 20;
  }
  if (!/<meta[^>]*property=["']og:title["'][^>]*>/i.test(html)) {
    issues.push({ category: "seo", severity: "info", message: "No og:title for social sharing", fix: "Add <meta property=\"og:title\" content=\"…\"> for rich social previews." }); seoScore -= 8;
  }
  if (!/<h1[^>]*>/i.test(html)) {
    issues.push({ category: "seo", severity: "warning", message: "No <h1> heading found", fix: "Add a single <h1> tag with the page's primary keyword." }); seoScore -= 15;
  }
  const imgTags = [...html.matchAll(/<img[^>]*>/gi)].map((m) => m[0]);
  const imgNoAlt = imgTags.filter((t) => !/\balt\s*=/i.test(t));
  if (imgNoAlt.length > 0) {
    issues.push({ category: "seo", severity: "warning", message: `${imgNoAlt.length} image(s) missing alt text`, fix: "Add alt=\"…\" to all <img> tags." }); seoScore -= Math.min(18, imgNoAlt.length * 5);
  }
  if (!/<link[^>]*rel=["']canonical["'][^>]*>/i.test(html)) {
    issues.push({ category: "seo", severity: "info", message: "No canonical URL tag", fix: "Add <link rel=\"canonical\" href=\"https://yourdomain.com/\">." }); seoScore -= 5;
  }

  // ── Accessibility ─────────────────────────────────────────────────────
  let a11yScore = 100;
  if (!/<html[^>]*\blang=["'][a-z]{2}/i.test(html)) {
    issues.push({ category: "a11y", severity: "critical", message: "Missing lang attribute on <html>", fix: "Add lang=\"en\" to the <html> element." }); a11yScore -= 25;
  }
  const inputs = [...html.matchAll(/<input(?![^>]*type=["']hidden["'])[^>]*>/gi)].map((m) => m[0]);
  const inputsNoLabel = inputs.filter((t) => !/\b(aria-label|aria-labelledby|id=)\b/i.test(t));
  if (inputsNoLabel.length > 0) {
    issues.push({ category: "a11y", severity: "warning", message: `${inputsNoLabel.length} form input(s) may lack labels`, fix: "Add <label for=\"…\"> or aria-label to each input." }); a11yScore -= 15;
  }
  if (!/<main[^>]*>|role=["']main["']/i.test(html)) {
    issues.push({ category: "a11y", severity: "info", message: "No <main> landmark", fix: "Wrap primary content in a <main> element." }); a11yScore -= 10;
  }
  const btns = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => m[1].trim());
  const btnsEmpty = btns.filter((t) => t === "" || /^<img[^>]*>$/.test(t));
  if (btnsEmpty.length > 0) {
    issues.push({ category: "a11y", severity: "warning", message: `${btnsEmpty.length} button(s) with no accessible name`, fix: "Add visible text or aria-label to all buttons." }); a11yScore -= 15;
  }

  // ── Performance ────────────────────────────────────────────────────────
  let perfScore = 100;
  const totalBytes = Object.values(files).reduce((s, v) => s + v.length, 0);
  const totalKB = totalBytes / 1024;
  if (totalKB > 600) {
    issues.push({ category: "perf", severity: "warning", message: `Total payload ${totalKB.toFixed(0)} KB — consider optimising`, fix: "Minify CSS, compress images, remove unused code." }); perfScore -= 20;
  } else if (totalKB > 300) {
    issues.push({ category: "perf", severity: "info", message: `Total payload ${totalKB.toFixed(0)} KB`, fix: "Consider further optimisation for slow connections." }); perfScore -= 8;
  }
  const cssKB = allCSS.length / 1024;
  if (cssKB > 80) {
    issues.push({ category: "perf", severity: "warning", message: `CSS is ${cssKB.toFixed(0)} KB — may block rendering`, fix: "Split CSS into critical-path and deferred styles." }); perfScore -= 15;
  }
  const largeInline = (html.match(/<script(?![^>]*src)[^>]*>[\s\S]{500,}?<\/script>/gi) ?? []).length;
  if (largeInline > 2) {
    issues.push({ category: "perf", severity: "info", message: `${largeInline} large inline scripts`, fix: "Move scripts to .js files with defer/async attributes." }); perfScore -= 10;
  }
  const fileCount = Object.keys(files).length;
  if (fileCount > 30) {
    issues.push({ category: "perf", severity: "info", message: `${fileCount} files — many HTTP requests`, fix: "Bundle related scripts and styles into fewer files." }); perfScore -= 8;
  }

  // ── Mobile ─────────────────────────────────────────────────────────────
  let mobileScore = 100;
  if (!/<meta[^>]*name=["']viewport["'][^>]*>/i.test(html)) {
    issues.push({ category: "mobile", severity: "critical", message: "Missing viewport meta tag", fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">." }); mobileScore -= 35;
  }
  if (!/@media\s*\(/i.test(html + allCSS)) {
    issues.push({ category: "mobile", severity: "warning", message: "No responsive @media queries found", fix: "Add @media (max-width: 768px) breakpoints." }); mobileScore -= 25;
  }
  if (!/\b(flex|grid)\b/i.test(allCSS)) {
    issues.push({ category: "mobile", severity: "info", message: "No flexbox or grid layout detected", fix: "Use display:flex or display:grid for responsive layouts." }); mobileScore -= 10;
  }

  // ── Code Quality ───────────────────────────────────────────────────────
  let codeScore = 100;
  if (!/<\!doctype\s+html\s*>/i.test(html)) {
    issues.push({ category: "code", severity: "critical", message: "Missing <!DOCTYPE html>", fix: "Add <!DOCTYPE html> as the very first line." }); codeScore -= 20;
  }
  if (!/<meta[^>]*charset/i.test(html)) {
    issues.push({ category: "code", severity: "warning", message: "Missing charset declaration", fix: "Add <meta charset=\"UTF-8\"> inside <head>." }); codeScore -= 15;
  }
  if (!/<html[^>]*>/i.test(html)) {
    issues.push({ category: "code", severity: "critical", message: "Missing <html> element", fix: "Ensure the document has a valid <html> root element." }); codeScore -= 25;
  }
  if (!/<head[^>]*>/i.test(html)) {
    issues.push({ category: "code", severity: "warning", message: "Missing <head> section", fix: "Add a <head> section with meta tags and links." }); codeScore -= 15;
  }
  const h1Pos = html.search(/<h1[^>]*>/i);
  const h2Pos = html.search(/<h2[^>]*>/i);
  if (h1Pos > 0 && h2Pos > 0 && h2Pos < h1Pos) {
    issues.push({ category: "code", severity: "info", message: "h2 appears before h1 — check heading order", fix: "Use headings in hierarchy: h1 → h2 → h3." }); codeScore -= 8;
  }

  const scores = {
    seo:    Math.max(0, Math.min(100, seoScore)),
    a11y:   Math.max(0, Math.min(100, a11yScore)),
    perf:   Math.max(0, Math.min(100, perfScore)),
    mobile: Math.max(0, Math.min(100, mobileScore)),
    code:   Math.max(0, Math.min(100, codeScore)),
  };
  const overall = Math.round(Object.values(scores).reduce((s, v) => s + v, 0) / 5);

  return {
    scores,
    overall,
    grade: scoreToGrade(overall),
    issues: issues.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity])),
    stats: {
      totalKB: totalKB.toFixed(1),
      fileCount,
      htmlCount: Object.keys(files).filter((f) => f.endsWith(".html")).length,
      cssCount: Object.keys(files).filter((f) => f.endsWith(".css")).length,
      jsCount: Object.keys(files).filter((f) => f.endsWith(".js")).length,
      imgCount: imgTags.length,
    },
  };
}

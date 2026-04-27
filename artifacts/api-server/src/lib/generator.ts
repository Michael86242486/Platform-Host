/**
 * WebForge generator — two-phase: ANALYZE then BUILD.
 *
 * The agent first analyzes the user's prompt and produces a structured plan
 * (`analyzeProject`). The plan is shown to the user for confirmation. Only
 * after confirmation does `buildProject` run, producing a real multi-file
 * project (index/about/services/contact/login/dashboard + assets/styles.css
 * + assets/app.js).
 */

import type { SiteAnalysis, SiteFiles, SitePlan } from "../lib/db";

const PALETTES = [
  {
    id: "neon",
    bg: "#0A0E14",
    surface: "#11161F",
    text: "#E6EDF3",
    muted: "#7D8590",
    primary: "#00FFC2",
    accent: "#58A6FF",
    mood: "developer / cyber / dark",
  },
  {
    id: "sunset",
    bg: "#150B1F",
    surface: "#1F1230",
    text: "#FFE9D6",
    muted: "#B79CC4",
    primary: "#FF6B6B",
    accent: "#FFD166",
    mood: "warm / bold / energetic",
  },
  {
    id: "forest",
    bg: "#0B1410",
    surface: "#11201A",
    text: "#E8F4EA",
    muted: "#8AA796",
    primary: "#3FB950",
    accent: "#7EE787",
    mood: "natural / calm / organic",
  },
  {
    id: "mono",
    bg: "#FAFAF7",
    surface: "#FFFFFF",
    text: "#0A0A0A",
    muted: "#737373",
    primary: "#0A0A0A",
    accent: "#FF4500",
    mood: "minimal / editorial / clean",
  },
  {
    id: "lavender",
    bg: "#0F0B1F",
    surface: "#1A1530",
    text: "#EDE7F6",
    muted: "#9F8CC0",
    primary: "#BC8CFF",
    accent: "#7CC7FF",
    mood: "creative / dreamy / artful",
  },
];

type Palette = (typeof PALETTES)[number];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickPalette(prompt: string): Palette {
  const p = prompt.toLowerCase();
  if (/light|bright|white|minimal|clean|elegant|editorial/.test(p)) return PALETTES[3];
  if (/sunset|warm|orange|red|fire|bold|food|restaurant|cafe/.test(p)) return PALETTES[1];
  if (/eco|forest|green|growth|farm|plant|nature|wellness/.test(p)) return PALETTES[2];
  if (/purple|magic|creative|dream|art|design|studio/.test(p)) return PALETTES[4];
  if (/dev|tech|code|cyber|terminal|hack|ai|neon|saas|startup/.test(p))
    return PALETTES[0];
  return PALETTES[hash(prompt) % PALETTES.length];
}

function smartTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  const phrase = cleaned.split(/[.,;:!?\n]/)[0];
  const words = phrase.split(" ").filter(Boolean).slice(0, 5);
  const title = words
    .map((w) => (w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
  if (title.length < 4) return "Untitled Project";
  return title.slice(0, 60);
}

// ---------------------------------------------------------------------------
// PHASE 1 — Analysis
// ---------------------------------------------------------------------------

const FEATURE_RULES: { tag: RegExp; feature: string }[] = [
  { tag: /shop|store|sell|product|ecommerce|merch|cart/, feature: "Storefront with cart" },
  { tag: /book|appointment|reserv|salon|barber|consult/, feature: "Bookings & appointments" },
  { tag: /restaurant|cafe|menu|food|coffee|bakery/, feature: "Live menu" },
  { tag: /event|party|wedding|concert|launch/, feature: "Event & RSVP" },
  { tag: /blog|news|writing|article|publish/, feature: "Blog with markdown" },
  { tag: /portfolio|gallery|showcase/, feature: "Portfolio gallery" },
  { tag: /sign in|sign up|account|login|auth|user/, feature: "User authentication" },
  { tag: /dashboard|admin|manage/, feature: "Member dashboard" },
  { tag: /pricing|subscription|tier|plan/, feature: "Pricing & plans" },
  { tag: /contact|enquir|email/, feature: "Contact form" },
  { tag: /about|team|story/, feature: "About / team page" },
  { tag: /faq|question|help/, feature: "FAQ section" },
  { tag: /testimonial|review|customer/, feature: "Testimonials" },
];

const STYLE_RULES: { tag: RegExp; hint: string }[] = [
  { tag: /minimal|clean|simple/, hint: "minimal" },
  { tag: /bold|loud|dramatic/, hint: "bold" },
  { tag: /elegant|luxury|premium/, hint: "elegant" },
  { tag: /playful|fun|colorful/, hint: "playful" },
  { tag: /serious|enterprise|corporate/, hint: "professional" },
  { tag: /dev|tech|cyber|terminal|hack|neon/, hint: "developer" },
];

function detectType(prompt: string): SiteAnalysis["type"] {
  const p = prompt.toLowerCase();
  if (/telegram bot|chat bot|discord bot|host (a |my )?bot/.test(p)) return "bot";
  if (/api|backend|server|microservice|webhook/.test(p)) return "backend";
  if (/cli|tool|script|automation|utility/.test(p)) return "tool";
  return "website";
}

function detectAudience(prompt: string): string | null {
  const p = prompt.toLowerCase();
  const m = p.match(
    /for (developers|small businesses|restaurants|musicians|photographers|students|creators|teams|startups|investors|kids|seniors|families|gamers|writers|teachers)/,
  );
  return m ? m[1] : null;
}

export function analyzeProject(prompt: string, name?: string): SiteAnalysis {
  const trimmed = prompt.trim();
  const type = detectType(trimmed);
  const features = Array.from(
    new Set(
      FEATURE_RULES.filter((r) => r.tag.test(trimmed.toLowerCase())).map(
        (r) => r.feature,
      ),
    ),
  );
  if (features.length === 0) features.push("Hero section", "About page", "Contact form");

  const styleHints = Array.from(
    new Set(
      STYLE_RULES.filter((r) => r.tag.test(trimmed.toLowerCase())).map((r) => r.hint),
    ),
  );

  const pages = derivePages(type, features, trimmed);
  const intent = name?.trim() || smartTitle(trimmed);

  return {
    type,
    intent,
    audience: detectAudience(trimmed),
    features,
    pages,
    styleHints,
  };
}

function derivePages(
  type: SiteAnalysis["type"],
  features: string[],
  prompt: string,
): string[] {
  if (type !== "website") return ["index"];
  const set = new Set<string>(["index", "about", "services", "contact"]);
  if (features.some((f) => /Storefront|menu|gallery|Portfolio/i.test(f))) set.add("services");
  if (features.some((f) => /authentication|dashboard|account/i.test(f))) {
    set.add("login");
    set.add("dashboard");
  } else {
    set.add("login");
    set.add("dashboard");
  }
  if (/blog|news|writing/.test(prompt.toLowerCase())) set.add("blog");
  return Array.from(set);
}

// ---------------------------------------------------------------------------
// PHASE 2 — Plan
// ---------------------------------------------------------------------------

export function buildPlan(analysis: SiteAnalysis): SitePlan {
  const palette = pickPalette(analysis.intent + " " + analysis.features.join(" "));
  const pages = analysis.pages.map((p) => describePage(p, analysis));
  const summary = summarize(analysis);
  return {
    type: analysis.type,
    summary,
    pages,
    styles: { palette: palette.id, mood: palette.mood },
    features: analysis.features,
    notes: [
      `Detected as a ${analysis.type}.`,
      analysis.audience
        ? `Tuned for ${analysis.audience}.`
        : "Audience inferred from prompt context.",
      `Color system: ${palette.id} (${palette.mood}).`,
      "Multi-page output with shared styles + nav.",
    ],
  };
}

function describePage(slug: string, analysis: SiteAnalysis) {
  const map: Record<string, { title: string; purpose: string; sections: string[] }> = {
    index: {
      title: "Home",
      purpose: "Hero + value proposition + primary CTA.",
      sections: ["Hero", "Feature grid", "Social proof", "Footer CTA"],
    },
    about: {
      title: "About",
      purpose: `Introduce the team and the story behind ${analysis.intent}.`,
      sections: ["Mission statement", "Team grid", "Timeline", "Values"],
    },
    services: {
      title: "Services",
      purpose: "Detail what's offered with pricing-style cards.",
      sections: ["Services overview", "Pricing tiers", "FAQ"],
    },
    contact: {
      title: "Contact",
      purpose: "Let visitors reach out via form, email, or phone.",
      sections: ["Contact form", "Office details", "Map placeholder"],
    },
    login: {
      title: "Sign in",
      purpose: "Member sign-in flow (UI only).",
      sections: ["Login form", "Forgot-password link", "OAuth buttons"],
    },
    dashboard: {
      title: "Dashboard",
      purpose: "Account overview shown after login.",
      sections: ["Welcome card", "Stats grid", "Recent activity", "Settings shortcut"],
    },
    blog: {
      title: "Blog",
      purpose: "Article index and individual post template.",
      sections: ["Featured post", "Recent posts grid", "Categories"],
    },
  };
  const entry = map[slug] || {
    title: slug,
    purpose: "Custom page.",
    sections: ["Header", "Body", "Footer"],
  };
  return {
    path: slug === "index" ? "index.html" : `${slug}.html`,
    title: entry.title,
    purpose: entry.purpose,
    sections: entry.sections,
  };
}

function summarize(a: SiteAnalysis): string {
  const f = a.features.slice(0, 3).join(", ");
  return `A ${a.type} called "${a.intent}" with ${a.pages.length} pages. Headline features: ${f}.`;
}

// ---------------------------------------------------------------------------
// PHASE 3 — Build (multi-file output)
// ---------------------------------------------------------------------------

export interface BuildResult {
  files: SiteFiles;
  coverColor: string;
  name: string;
}

export function buildProject(plan: SitePlan, intentName: string): BuildResult {
  const palette =
    PALETTES.find((p) => p.id === plan.styles.palette) ?? PALETTES[0];
  const name = intentName || "Untitled";

  const files: SiteFiles = {};
  files["assets/styles.css"] = renderStyles(palette);
  files["assets/app.js"] = renderApp();
  for (const page of plan.pages) {
    files[page.path] = renderPage(page, plan, palette, name);
  }
  return { files, coverColor: palette.primary, name };
}

function renderStyles(p: Palette): string {
  return `:root{
  --bg:${p.bg};--surface:${p.surface};--text:${p.text};--muted:${p.muted};
  --primary:${p.primary};--accent:${p.accent};
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);min-height:100vh}
body{font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif;line-height:1.55;
  background:radial-gradient(1200px 600px at 20% -10%,${p.primary}1a,transparent 60%),
             radial-gradient(1200px 600px at 80% 110%,${p.accent}1a,transparent 60%),var(--bg);}
a{color:var(--accent);text-decoration:none}
.container{max-width:1100px;margin:0 auto;padding:0 24px}
.nav{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid ${p.text}11}
.brand{font-weight:800;letter-spacing:-0.02em;font-size:18px}
.brand span{color:var(--primary)}
.nav-links{display:flex;gap:18px}
.nav-links a{color:var(--muted);font-size:14px}
.nav-links a:hover,.nav-links a.active{color:var(--text)}
.hero{padding:96px 0 80px;text-align:center}
.eyebrow{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--primary);padding:6px 12px;border:1px solid ${p.primary}55;border-radius:999px;margin-bottom:24px}
h1{font-size:clamp(40px,7vw,76px);font-weight:800;letter-spacing:-.03em;
  background:linear-gradient(180deg,var(--text),${p.muted});-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:18px}
h2{font-size:clamp(24px,4vw,40px);font-weight:800;letter-spacing:-.02em;margin-bottom:14px}
h3{font-size:18px;font-weight:700;margin-bottom:8px}
.lead{color:var(--muted);font-size:clamp(16px,2.2vw,20px);max-width:640px;margin:0 auto 36px}
.cta{display:inline-flex;align-items:center;gap:10px;padding:14px 22px;border-radius:12px;font-weight:700;font-size:15px;
  background:var(--primary);color:var(--bg);box-shadow:0 10px 40px ${p.primary}55,0 0 0 1px ${p.primary}66;transition:transform .15s ease}
.cta:hover{transform:translateY(-2px)}
.cta.ghost{background:transparent;color:var(--text);border:1px solid ${p.text}22;box-shadow:none}
section{padding:60px 0}
.grid{display:grid;gap:20px}
.grid.cols-3{grid-template-columns:repeat(3,1fr)}
.grid.cols-2{grid-template-columns:repeat(2,1fr)}
@media(max-width:720px){.grid.cols-3,.grid.cols-2{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid ${p.text}11;border-radius:16px;padding:24px}
.card .price{font-size:32px;font-weight:800;margin:8px 0}
.card .muted{color:var(--muted);font-size:14px}
.input,select,textarea{width:100%;padding:14px;border-radius:10px;border:1px solid ${p.text}22;background:${p.surface};color:var(--text);font-size:14px}
.label{display:block;font-size:11px;letter-spacing:1.4px;color:var(--muted);text-transform:uppercase;margin:14px 0 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
form .row{margin-bottom:14px}
footer{padding:40px 0;color:var(--muted);font-size:13px;border-top:1px solid ${p.text}11;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--primary);margin-right:6px;box-shadow:0 0 12px var(--primary)}
.stat{background:var(--surface);border:1px solid ${p.text}11;border-radius:14px;padding:18px}
.stat .num{font-size:28px;font-weight:800}
.timeline{display:flex;flex-direction:column;gap:14px;margin-top:14px}
.timeline .row{padding:12px 16px;border-left:2px solid ${p.primary};background:${p.surface};border-radius:0 8px 8px 0}
.faq summary{cursor:pointer;padding:14px 0;border-bottom:1px solid ${p.text}11;font-weight:600}
.tag{display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;background:${p.primary}22;color:var(--primary);margin-right:6px}
`;
}

function renderApp(): string {
  return `// Tiny global app behaviors for the generated site.
document.addEventListener('click',function(e){
  var t=e.target;
  if(t&&t.matches&&t.matches('.cta')){t.style.transform='scale(.97)';setTimeout(function(){t.style.transform='';},120);}
});
document.querySelectorAll('form').forEach(function(f){
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var btn=f.querySelector('[type=submit]');
    if(btn){btn.disabled=true;btn.innerText='Sent ✓';setTimeout(function(){btn.disabled=false;btn.innerText='Send';f.reset();},1800);}
  });
});`;
}

function renderPage(
  page: SitePlan["pages"][number],
  plan: SitePlan,
  palette: Palette,
  name: string,
): string {
  void palette;
  const navLinks = plan.pages
    .map(
      (p) =>
        `<a href="${p.path}" class="${p.path === page.path ? "active" : ""}">${escapeHtml(p.title)}</a>`,
    )
    .join("");
  const body = pageBody(page, plan, name);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(name)} — ${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(plan.summary)}" />
<link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
<div class="container">
  <header class="nav">
    <div class="brand">${escapeHtml(name)}<span>.</span></div>
    <nav class="nav-links">${navLinks}</nav>
  </header>
  ${body}
  <footer>
    <span>© ${new Date().getFullYear()} ${escapeHtml(name)}</span>
    <span>Forged on <a href="#">WebForge</a></span>
  </footer>
</div>
<script src="assets/app.js"></script>
</body>
</html>`;
}

function pageBody(
  page: SitePlan["pages"][number],
  plan: SitePlan,
  name: string,
): string {
  switch (page.path) {
    case "index.html":
      return renderHome(plan, name);
    case "about.html":
      return renderAbout(name, plan);
    case "services.html":
      return renderServices(plan);
    case "contact.html":
      return renderContact(name);
    case "login.html":
      return renderLogin(name);
    case "dashboard.html":
      return renderDashboard(name, plan);
    case "blog.html":
      return renderBlog(name);
    default:
      return `<section class="hero"><h1>${escapeHtml(page.title)}</h1><p class="lead">${escapeHtml(page.purpose)}</p></section>`;
  }
}

function renderHome(plan: SitePlan, name: string): string {
  const features = plan.features.slice(0, 6);
  const cards = features
    .map(
      (f, i) => `
    <div class="card">
      <span class="tag">0${i + 1}</span>
      <h3>${escapeHtml(f)}</h3>
      <p class="muted">A first-class implementation of ${escapeHtml(f.toLowerCase())} tuned for this project.</p>
    </div>`,
    )
    .join("");
  return `
<section class="hero">
  <span class="eyebrow"><span class="dot"></span>Live</span>
  <h1>${escapeHtml(name)}</h1>
  <p class="lead">${escapeHtml(plan.summary)}</p>
  <a class="cta" href="contact.html">Get started →</a>
  &nbsp;
  <a class="cta ghost" href="about.html">Learn more</a>
</section>
<section>
  <h2>What you get</h2>
  <div class="grid cols-3">${cards}</div>
</section>
<section class="card" style="margin-bottom:60px;text-align:center;background:linear-gradient(135deg,var(--primary)22,var(--accent)22);border-color:var(--primary)44">
  <h2>Ready to launch?</h2>
  <p class="muted">Edit this site any time from your WebForge bot or the mobile app.</p>
  <p style="margin-top:18px"><a class="cta" href="contact.html">Talk to us</a></p>
</section>`;
}

function renderAbout(name: string, plan: SitePlan): string {
  const team = ["Founder", "Engineering Lead", "Designer", "Operations"]
    .map(
      (role) => `
    <div class="card">
      <div style="width:48px;height:48px;border-radius:24px;background:linear-gradient(135deg,var(--primary),var(--accent));margin-bottom:12px"></div>
      <h3>${escapeHtml(role)}</h3>
      <p class="muted">Building ${escapeHtml(name)} every day.</p>
    </div>`,
    )
    .join("");
  return `
<section class="hero">
  <span class="eyebrow">Our story</span>
  <h1>About ${escapeHtml(name)}</h1>
  <p class="lead">${escapeHtml(plan.summary)}</p>
</section>
<section>
  <h2>The team</h2>
  <div class="grid cols-2">${team}</div>
</section>
<section>
  <h2>Timeline</h2>
  <div class="timeline">
    <div class="row"><strong>2024</strong> — Idea sketched on a napkin.</div>
    <div class="row"><strong>2025</strong> — First customers, first revenue.</div>
    <div class="row"><strong>${new Date().getFullYear()}</strong> — You're reading this. Welcome.</div>
  </div>
</section>`;
}

function renderServices(plan: SitePlan): string {
  const tiers = ["Starter", "Growth", "Pro"].map(
    (tier, i) => `
    <div class="card">
      <h3>${tier}</h3>
      <div class="price">$${[19, 49, 99][i]}<span class="muted" style="font-size:14px;font-weight:400">/mo</span></div>
      <p class="muted">${["For solo creators just starting out.", "For growing teams shipping every week.", "For organizations going all-in."][i]}</p>
      <p style="margin-top:14px"><a class="cta" href="contact.html">Choose ${tier}</a></p>
    </div>`,
  ).join("");
  return `
<section class="hero">
  <span class="eyebrow">What we offer</span>
  <h1>Services</h1>
  <p class="lead">${escapeHtml(plan.summary)}</p>
</section>
<section>
  <h2>Pricing</h2>
  <div class="grid cols-3">${tiers}</div>
</section>
<section class="faq">
  <h2>FAQ</h2>
  <details><summary>How fast can I get started?</summary><p style="padding:12px 0;color:var(--muted)">Same day. Onboarding takes minutes.</p></details>
  <details><summary>Can I cancel any time?</summary><p style="padding:12px 0;color:var(--muted)">Yes. No contracts, no fees.</p></details>
  <details><summary>Do you offer custom plans?</summary><p style="padding:12px 0;color:var(--muted)">Absolutely — reach out via the contact page.</p></details>
</section>`;
}

function renderContact(name: string): string {
  return `
<section class="hero">
  <span class="eyebrow">Say hi</span>
  <h1>Contact ${escapeHtml(name)}</h1>
  <p class="lead">We respond within one business day.</p>
</section>
<section>
  <div class="grid cols-2">
    <form class="card">
      <div class="row"><span class="label">Name</span><input class="input" placeholder="Jane Doe" required /></div>
      <div class="row"><span class="label">Email</span><input class="input" type="email" placeholder="jane@company.com" required /></div>
      <div class="row"><span class="label">Message</span><textarea class="input" rows="5" placeholder="What can we help with?" required></textarea></div>
      <button class="cta" type="submit">Send</button>
    </form>
    <div class="card">
      <h3>Office</h3>
      <p class="muted">123 Forge Street, Internet</p>
      <h3 style="margin-top:18px">Email</h3>
      <p class="muted">hello@${escapeHtml(name).toLowerCase().replace(/[^a-z0-9]/g, "")}.com</p>
      <h3 style="margin-top:18px">Hours</h3>
      <p class="muted">Mon — Fri, 9am to 6pm</p>
    </div>
  </div>
</section>`;
}

function renderLogin(name: string): string {
  return `
<section class="hero" style="padding-bottom:30px">
  <span class="eyebrow">Members only</span>
  <h1>Sign in</h1>
  <p class="lead">Welcome back to ${escapeHtml(name)}.</p>
</section>
<section>
  <form class="card" style="max-width:480px;margin:0 auto">
    <div class="row"><span class="label">Email</span><input class="input" type="email" placeholder="you@${escapeHtml(name).toLowerCase().replace(/[^a-z0-9]/g, "")}.com" required /></div>
    <div class="row"><span class="label">Password</span><input class="input" type="password" placeholder="••••••••" required /></div>
    <button class="cta" type="submit" style="width:100%;justify-content:center">Sign in →</button>
    <p style="margin-top:14px;text-align:center"><a href="#">Forgot password?</a></p>
    <hr style="margin:18px 0;border:none;border-top:1px solid #fff1" />
    <button class="cta ghost" type="button" style="width:100%;justify-content:center">Continue with Google</button>
  </form>
</section>`;
}

function renderDashboard(name: string, plan: SitePlan): string {
  const stats = [
    { label: "Active sessions", num: 1284 },
    { label: "Conversion", num: "4.7%" },
    { label: "Revenue", num: "$12,4k" },
  ]
    .map(
      (s) => `<div class="stat"><div class="muted">${s.label}</div><div class="num">${s.num}</div></div>`,
    )
    .join("");
  void plan;
  return `
<section class="hero" style="padding-bottom:30px">
  <span class="eyebrow">Logged in</span>
  <h1 style="font-size:clamp(28px,5vw,46px)">Welcome back to ${escapeHtml(name)}</h1>
  <p class="lead">Here's the snapshot of your account today.</p>
</section>
<section>
  <div class="grid cols-3">${stats}</div>
</section>
<section>
  <h2>Recent activity</h2>
  <div class="timeline">
    <div class="row">A new sign-up just arrived.</div>
    <div class="row">Invoice INV-1042 was paid.</div>
    <div class="row">Your monthly report is ready.</div>
  </div>
</section>`;
}

function renderBlog(name: string): string {
  const posts = [
    "Why we built " + name,
    "Shipping faster with WebForge",
    "What's coming next quarter",
  ]
    .map(
      (title, i) => `
    <article class="card">
      <span class="tag">Post 0${i + 1}</span>
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">A short preview of the article and what readers will learn.</p>
      <p style="margin-top:10px"><a href="#">Read →</a></p>
    </article>`,
    )
    .join("");
  return `
<section class="hero">
  <span class="eyebrow">Words</span>
  <h1>Blog</h1>
  <p class="lead">Notes from the team building ${escapeHtml(name)}.</p>
</section>
<section>
  <div class="grid cols-3">${posts}</div>
</section>`;
}

// ---------------------------------------------------------------------------
// Build pipeline stages — the queue iterates these to drive UI progress.
// ---------------------------------------------------------------------------

export const BUILD_STAGES: { progress: number; label: string; ms: number }[] = [
  { progress: 6, label: "Planning architecture", ms: 1500 },
  { progress: 18, label: "Generating page scaffolds", ms: 1800 },
  { progress: 32, label: "Writing index.html", ms: 1400 },
  { progress: 44, label: "Writing about.html", ms: 1100 },
  { progress: 54, label: "Writing services.html", ms: 1100 },
  { progress: 64, label: "Writing contact.html", ms: 1000 },
  { progress: 73, label: "Writing login.html", ms: 900 },
  { progress: 82, label: "Writing dashboard.html", ms: 1100 },
  { progress: 89, label: "Compiling assets/styles.css", ms: 900 },
  { progress: 94, label: "Validating HTML structure", ms: 600 },
  { progress: 97, label: "Wrapping JS for safety", ms: 500 },
  { progress: 99, label: "Packaging & deploying", ms: 600 },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

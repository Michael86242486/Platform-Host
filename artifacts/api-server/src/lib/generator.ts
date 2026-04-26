/**
 * Deterministic-ish site generator.
 *
 * Reads a freeform prompt and produces a single self-contained HTML document
 * with embedded CSS + JS. Picks a palette + template based on keywords so the
 * output looks intentional rather than generic.
 */

const PALETTES = [
  {
    id: "neon",
    bg: "#0A0E14",
    surface: "#11161F",
    text: "#E6EDF3",
    muted: "#7D8590",
    primary: "#00FFC2",
    accent: "#58A6FF",
  },
  {
    id: "sunset",
    bg: "#150B1F",
    surface: "#1F1230",
    text: "#FFE9D6",
    muted: "#B79CC4",
    primary: "#FF6B6B",
    accent: "#FFD166",
  },
  {
    id: "forest",
    bg: "#0B1410",
    surface: "#11201A",
    text: "#E8F4EA",
    muted: "#8AA796",
    primary: "#3FB950",
    accent: "#7EE787",
  },
  {
    id: "mono",
    bg: "#FAFAF7",
    surface: "#FFFFFF",
    text: "#0A0A0A",
    muted: "#737373",
    primary: "#0A0A0A",
    accent: "#FF4500",
  },
  {
    id: "lavender",
    bg: "#0F0B1F",
    surface: "#1A1530",
    text: "#EDE7F6",
    muted: "#9F8CC0",
    primary: "#BC8CFF",
    accent: "#7CC7FF",
  },
];

type Palette = (typeof PALETTES)[number];

function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickPalette(prompt: string): Palette {
  const p = prompt.toLowerCase();
  if (/light|bright|white|minimal|clean|elegant/.test(p)) return PALETTES[3];
  if (/sunset|warm|orange|red|fire|bold/.test(p)) return PALETTES[1];
  if (/eco|forest|green|growth|farm|plant/.test(p)) return PALETTES[2];
  if (/purple|magic|creative|dream|art/.test(p)) return PALETTES[4];
  if (/dev|tech|code|cyber|terminal|hack|ai|neon/.test(p)) return PALETTES[0];
  return PALETTES[hashStringToInt(prompt) % PALETTES.length];
}

function deriveTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 38) {
    return cleaned.replace(/^./, (c) => c.toUpperCase());
  }
  const phrase = cleaned.split(/[.,;:!?]/)[0];
  return (phrase.length > 38 ? phrase.slice(0, 38) : phrase).replace(
    /^./,
    (c) => c.toUpperCase(),
  );
}

function deriveTagline(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length > 60) return trimmed;
  const flavors = [
    "Built in seconds with WebForge.",
    "Crafted from a single sentence.",
    "Forged from your idea — instantly.",
    "A live, hostable site from one prompt.",
    "Generated, deployed, ready to share.",
  ];
  return `${trimmed} — ${flavors[hashStringToInt(prompt) % flavors.length]}`;
}

function buildFeatures(prompt: string): { title: string; body: string }[] {
  const p = prompt.toLowerCase();
  const pool: { title: string; body: string; tags: RegExp }[] = [
    {
      title: "⚡ Lightning fast",
      body: "Every page is a single static document — no spinners, no cold starts.",
      tags: /./,
    },
    {
      title: "🎨 Tasteful by default",
      body: "A curated palette and typography system tuned for the prompt.",
      tags: /./,
    },
    {
      title: "📱 Mobile first",
      body: "Looks sharp on every screen size. No squinting, no zooming.",
      tags: /./,
    },
    {
      title: "🛒 Storefront ready",
      body: "Hook into Stripe in one click when you're ready to take payments.",
      tags: /shop|store|sell|product|ecommerce|merch/,
    },
    {
      title: "📅 Bookings built in",
      body: "Slot-based reservations that sync with your calendar.",
      tags: /book|appointment|reserv|salon|barber|consult/,
    },
    {
      title: "🍽️ Living menu",
      body: "Edit items and prices live — guests always see the latest.",
      tags: /restaurant|cafe|menu|food|coffee|bakery/,
    },
    {
      title: "🎟️ Event countdown",
      body: "Real-time countdown and RSVP form, ready to share.",
      tags: /event|party|wedding|concert|launch/,
    },
    {
      title: "📰 Built-in blog",
      body: "Write in markdown, publish from Telegram, syndicate everywhere.",
      tags: /blog|news|writing|article|publish/,
    },
    {
      title: "🤖 Telegram-powered",
      body: "Edit your site by sending a message to your WebForge bot.",
      tags: /./,
    },
  ];
  const picks = pool
    .filter((f) => f.tags.test(p))
    .slice(0, 3)
    .map(({ title, body }) => ({ title, body }));
  while (picks.length < 3) {
    const generic = pool.find(
      (f) =>
        f.tags.source === "." &&
        !picks.some((pk) => pk.title === f.title),
    );
    if (!generic) break;
    picks.push({ title: generic.title, body: generic.body });
  }
  return picks;
}

export interface GeneratedSite {
  html: string;
  css: string;
  js: string;
  coverColor: string;
  name: string;
}

export function generateSite(prompt: string, name?: string): GeneratedSite {
  const palette = pickPalette(prompt);
  const title = name?.trim() || deriveTitle(prompt);
  const tagline = deriveTagline(prompt);
  const features = buildFeatures(prompt);

  const css = `
:root {
  --bg: ${palette.bg};
  --surface: ${palette.surface};
  --text: ${palette.text};
  --muted: ${palette.muted};
  --primary: ${palette.primary};
  --accent: ${palette.accent};
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--bg); color: var(--text); }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
  line-height: 1.55;
  min-height: 100vh;
  background:
    radial-gradient(1200px 600px at 20% -10%, ${palette.primary}1a, transparent 60%),
    radial-gradient(1200px 600px at 80% 110%, ${palette.accent}1a, transparent 60%),
    var(--bg);
}
.container { max-width: 980px; margin: 0 auto; padding: 0 24px; }
header.nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 0;
}
.brand { font-weight: 800; letter-spacing: -0.02em; font-size: 18px; color: var(--text); }
.brand span { color: var(--primary); }
.nav a { color: var(--muted); text-decoration: none; margin-left: 22px; font-size: 14px; }
.nav a:hover { color: var(--text); }

.hero { padding: 96px 0 80px; text-align: center; }
.eyebrow {
  display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--primary); padding: 6px 12px; border: 1px solid ${palette.primary}55;
  border-radius: 999px; margin-bottom: 24px;
}
.hero h1 {
  font-size: clamp(40px, 7vw, 76px); font-weight: 800; letter-spacing: -0.03em;
  background: linear-gradient(180deg, var(--text), ${palette.muted});
  -webkit-background-clip: text; background-clip: text; color: transparent;
  margin-bottom: 18px;
}
.hero p { font-size: clamp(16px, 2.2vw, 20px); color: var(--muted); max-width: 640px; margin: 0 auto 36px; }
.cta {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 14px 22px; border-radius: 12px; font-weight: 700; font-size: 15px;
  background: var(--primary); color: var(--bg); text-decoration: none;
  box-shadow: 0 10px 40px ${palette.primary}55, 0 0 0 1px ${palette.primary}66;
  transition: transform 0.15s ease;
}
.cta:hover { transform: translateY(-2px); }

.features {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
  padding: 40px 0 80px;
}
@media (max-width: 720px) { .features { grid-template-columns: 1fr; } }
.feature {
  background: var(--surface); border: 1px solid ${palette.text}11;
  border-radius: 16px; padding: 24px;
}
.feature h3 { font-size: 16px; margin-bottom: 8px; }
.feature p { color: var(--muted); font-size: 14px; }

.cta-band {
  margin: 0 0 80px; padding: 40px 24px; text-align: center;
  border-radius: 24px; background: linear-gradient(135deg, ${palette.primary}22, ${palette.accent}22);
  border: 1px solid ${palette.primary}44;
}
.cta-band h2 { font-size: clamp(24px, 4vw, 36px); margin-bottom: 8px; }
.cta-band p { color: var(--muted); margin-bottom: 22px; }

footer {
  padding: 28px 0 48px; color: var(--muted); font-size: 13px;
  display: flex; justify-content: space-between; align-items: center;
}
footer a { color: var(--accent); text-decoration: none; }

.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); margin-right: 6px; box-shadow: 0 0 12px var(--primary); }
`.trim();

  const js = `
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.matches && t.matches('.cta')) {
    t.style.transform = 'scale(0.97)';
    setTimeout(() => (t.style.transform = ''), 120);
  }
});
`.trim();

  const featuresHtml = features
    .map(
      (f) => `
      <div class="feature">
        <h3>${escapeHtml(f.title)}</h3>
        <p>${escapeHtml(f.body)}</p>
      </div>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(tagline)}" />
  <style>${css}</style>
</head>
<body>
  <div class="container">
    <header class="nav">
      <div class="brand">${escapeHtml(title)}<span>.</span></div>
      <nav>
        <a href="#features">Features</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>

    <section class="hero">
      <span class="eyebrow"><span class="dot"></span>Live</span>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(tagline)}</p>
      <a class="cta" href="#contact">Get started →</a>
    </section>

    <section id="features" class="features">
      ${featuresHtml}
    </section>

    <section id="contact" class="cta-band">
      <h2>Ready to launch?</h2>
      <p>Edit this site any time from your WebForge bot.</p>
      <a class="cta" href="mailto:hello@example.com">Talk to us</a>
    </section>

    <footer>
      <span>© ${new Date().getFullYear()} ${escapeHtml(title)}</span>
      <span>Forged on <a href="#">WebForge</a></span>
    </footer>
  </div>
  <script>${js}</script>
</body>
</html>`;

  return {
    html,
    css,
    js,
    coverColor: palette.primary,
    name: title,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

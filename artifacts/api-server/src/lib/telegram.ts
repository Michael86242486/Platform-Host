import TelegramBot from "node-telegram-bot-api";
import { and, desc, eq } from "drizzle-orm";

import { openai } from "@workspace/integrations-openai-ai-server";
import { speechToText } from "@workspace/integrations-openai-ai-server/audio";

import {
  db,
  jobsTable,
  messagesTable,
  sitesTable,
  telegramBotsTable,
  usersTable,
  type TelegramBot as DbBot,
  type Site,
} from "./db";
import { jobQueue } from "./queue";
import { logger } from "./logger";
import {
  deleteSecret,
  listSecrets,
  setSecret,
} from "./secrets";
import { inferSiteName, uniqueSlug } from "./slug";

/** Mirror of the same constant in queue.ts — set on an analyze job's
 * `instructions` column to skip the user-confirmation step and chain
 * straight into the build job. */
const AUTO_BUILD_SENTINEL = "__AUTO_BUILD__";

const TEMPLATES: ReadonlyArray<{
  key: string;
  title: string;
  tagline: string;
  prompt: string;
}> = [
  {
    key: "portfolio",
    title: "Portfolio",
    tagline: "Personal showcase with hero, projects, about, contact",
    prompt:
      "A dark-mode minimal personal portfolio with a hero, projects grid, about section and a contact form. Modern typography, plenty of whitespace.",
  },
  {
    key: "business",
    title: "Business",
    tagline: "Services, team, case studies, contact",
    prompt:
      "A professional small-business landing page with services, team, case studies, testimonials and a contact section. Confident, trustworthy palette.",
  },
  {
    key: "saas",
    title: "SaaS",
    tagline: "Hero, features, pricing, FAQ, signup",
    prompt:
      "A modern SaaS landing page with a hero, value prop, feature grid, pricing tiers, FAQ and a signup CTA. Tech-forward gradient accents.",
  },
  {
    key: "blog",
    title: "Blog",
    tagline: "Editorial layout with featured post + archive",
    prompt:
      "A clean editorial-style blog with a featured post hero, recent posts grid, sidebar with tags, and an about page. Serif headlines, comfortable line-length.",
  },
  {
    key: "store",
    title: "Store",
    tagline: "E-commerce landing for a fashion brand",
    prompt:
      "A streetwear ecommerce landing page with a fullscreen hero, featured products grid, lookbook gallery and a newsletter signup. Bold, high-contrast.",
  },
  {
    key: "fintech",
    title: "Fintech",
    tagline: "Bank/finance app marketing site",
    prompt:
      "A fintech app landing page with a hero, app screenshots, features, security/trust badges, pricing and download CTAs. Calm blues and deep navys.",
  },
  {
    key: "restaurant",
    title: "Restaurant",
    tagline: "Menu, reservations, story, gallery",
    prompt:
      "A warm restaurant website with a hero, story, menu, reservations CTA and a photo gallery. Terracotta + cream Italian palette.",
  },
];

interface ChatState {
  awaiting?:
    | { kind: "create" }
    | { kind: "edit"; siteId: string }
    | { kind: "host_token" }
    | { kind: "host_purpose"; pendingId: string; username: string }
    | { kind: "host_ai"; pendingId: string; username: string; purpose: string }
    | { kind: "stop_bot" }
    | { kind: "delete_site" }
    | { kind: "preview_site" }
    | { kind: "retry_site" }
    | { kind: "status_site" }
    | { kind: "confirm_build"; siteId: string };
}

class TelegramBotManager {
  private active = new Map<string, TelegramBot>();
  private state = new Map<string, ChatState>();
  /** pendingId -> in-memory record before we commit it to DB. */
  private pendingHosted = new Map<
    string,
    { token: string; username: string; displayName: string | null }
  >();

  async startAll(): Promise<void> {
    const bots = await db
      .select()
      .from(telegramBotsTable)
      .where(eq(telegramBotsTable.status, "active"));
    for (const bot of bots) {
      await this.startBot(bot).catch((err) => {
        logger.warn({ err, botId: bot.id }, "Failed to start bot");
      });
    }
    logger.info({ count: this.active.size }, "Telegram bots resumed");
    await this.ensureSystemBot().catch((err) => {
      logger.warn({ err }, "ensureSystemBot failed");
    });
  }

  /**
   * Ensure the global WebForge Telegram bot (configured via the
   * WEBFORGE_TELEGRAM_BOT_TOKEN env var) is registered and polling.
   * The DB row requires a userId, so if no users exist yet we
   * auto-create a "system" user that owns sites built directly from
   * Telegram before anyone signs up via the mobile app.
   */
  async ensureSystemBot(): Promise<void> {
    const token = process.env["WEBFORGE_TELEGRAM_BOT_TOKEN"];
    if (!token) return;
    const existing = await db
      .select()
      .from(telegramBotsTable)
      .where(eq(telegramBotsTable.token, token))
      .limit(1);
    if (existing.length > 0) {
      const row = existing[0];
      if (!this.active.has(row.id)) {
        await this.startBot(row).catch((err) => {
          logger.warn({ err, botId: row.id }, "Failed to start system bot");
        });
      }
      return;
    }
    let [user] = await db.select().from(usersTable).limit(1);
    if (!user) {
      const [created] = await db
        .insert(usersTable)
        .values({
          clerkUserId: "system_telegram_owner",
          email: "telegram@webforge.local",
          firstName: "Telegram",
          lastName: "Bot",
          imageUrl: null,
        })
        .returning();
      user = created;
      logger.info({ userId: user.id }, "Created system user for telegram bot");
    }
    const preview = `${token.slice(0, 6)}…${token.slice(-4)}`;
    const [record] = await db
      .insert(telegramBotsTable)
      .values({
        userId: user.id,
        token,
        tokenPreview: preview,
        status: "active",
      })
      .returning();
    await this.startBot(record).catch((err) => {
      logger.warn({ err, botId: record.id }, "Failed to start system bot");
    });
    logger.info({ botId: record.id }, "System bot registered + started");
  }

  async startBot(record: DbBot): Promise<TelegramBot> {
    if (this.active.has(record.id)) return this.active.get(record.id)!;

    // Use a 10-second polling timeout so Telegram drops old connections
    // faster when the server restarts, eliminating 409 Conflict errors.
    const bot = new TelegramBot(record.token, {
      polling: {
        interval: 300,
        autoStart: false,
        params: { timeout: 10, allowed_updates: ["message", "callback_query", "edited_message"] },
      },
    });
    this.active.set(record.id, bot);

    try {
      const me = await bot.getMe();
      await db
        .update(telegramBotsTable)
        .set({
          username: me.username ?? null,
          displayName: me.first_name ?? null,
          status: "active",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(telegramBotsTable.id, record.id));
    } catch (err) {
      logger.warn({ err, botId: record.id }, "getMe failed");
    }

    let conflictRetries = 0;
    let restarting = false;

    bot.on("polling_error", async (err: Error) => {
      const is409 = err.message.includes("409");
      if (is409) {
        conflictRetries++;
        logger.info({ botId: record.id, attempt: conflictRetries }, "409 conflict; old connection still alive");
        // After 3 consecutive 409s, stop + restart polling to force a fresh connection
        if (conflictRetries >= 3 && !restarting) {
          restarting = true;
          conflictRetries = 0;
          try {
            await bot.stopPolling();
            await sleep(12_000); // wait > 10s poll timeout
            await bot.startPolling();
            logger.info({ botId: record.id }, "polling restarted after 409 conflict");
          } catch (restartErr) {
            logger.warn({ err: restartErr, botId: record.id }, "polling restart failed");
          } finally {
            restarting = false;
          }
        }
        return;
      }
      conflictRetries = 0;
      logger.warn({ err: err.message, botId: record.id }, "polling_error");
      await db
        .update(telegramBotsTable)
        .set({ status: "error", lastError: err.message, updatedAt: new Date() })
        .where(eq(telegramBotsTable.id, record.id));
    });

    this.wireHandlers(record.userId, record.id, bot);

    // Wait longer than Telegram's poll timeout (we use 10s) so any stale
    // long-poll from a previous process expires before we start the new one.
    await sleep(12_000);
    await bot.startPolling();

    return bot;
  }

  async stopBot(botId: string): Promise<void> {
    const bot = this.active.get(botId);
    if (!bot) return;
    try {
      await bot.stopPolling();
    } catch (err) {
      logger.warn({ err, botId }, "stopPolling failed");
    }
    this.active.delete(botId);
  }

  isActive(botId: string): boolean {
    return this.active.has(botId);
  }

  // -------------------------------------------------------------------------
  // Command handlers
  // -------------------------------------------------------------------------

  private wireHandlers(
    ownerUserId: string,
    botId: string,
    bot: TelegramBot,
  ): void {
    void botId;

    bot.onText(/^\/start\b/i, async (msg) => {
      const name = msg.from?.first_name ?? "there";
      const lines = [
        `👋 *Welcome, ${escapeMd(name)}!*`,
        "",
        "I'm *WebForge AI* — I build complete, beautiful websites for you using AI.",
        "",
        "*Here's how it works:*",
        "1️⃣ Tell me what you want with `/create`",
        "2️⃣ I'll show you a plan + an AI-generated visual preview",
        "3️⃣ Pick a build mode:",
        "   • 🚀 Simple — fast, straightforward build",
        "   • 🤖 Autonomous — I review and auto-fix my own code",
        "   • 📋 Background — runs in parallel; chat stays free",
        "4️⃣ You get a live URL to share — with a real screenshot in this chat",
        "",
        "*Try it now:*",
        "`/create portfolio`",
        "`/create saas blue gradient, project management tool`",
        "`/clone notion` _(or any popular product)_",
        "",
        "Run `/help` to see all commands. 👇",
      ];
      this.clearState(msg.chat.id);
      await bot.sendMessage(msg.chat.id, lines.join("\n"), {
        parse_mode: "Markdown",
      });
    });

    bot.onText(/^\/help\b/i, async (msg) => {
      await bot.sendMessage(msg.chat.id, this.helpText(), {
        parse_mode: "Markdown",
      });
    });

    bot.onText(/^\/create\b\s*(.*)$/i, async (msg, match) => {
      const prompt = (match?.[1] ?? "").trim();
      if (prompt) {
        await this.runCreate(ownerUserId, bot, msg.chat.id, prompt);
      } else {
        this.setState(msg.chat.id, { awaiting: { kind: "create" } });
        await bot.sendMessage(
          msg.chat.id,
          "✏️ Tell me what to build — a sentence is enough. e.g. _\"a portfolio for a wedding photographer with a dark-mode gallery\"_.",
          { parse_mode: "Markdown" },
        );
      }
    });

    bot.onText(/^\/clone\b\s*(.*)$/i, async (msg, match) => {
      const target = (match?.[1] ?? "").trim();
      if (!target) {
        await bot.sendMessage(
          msg.chat.id,
          [
            "⚡ *Instant clone*",
            "",
            "Usage: `/clone <product>` — I'll skip planning and start building straight away.",
            "",
            "*Try:*",
            "`/clone notion` · `/clone replit` · `/clone github`",
            "`/clone lovable` · `/clone airbnb` · `/clone linear`",
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
        return;
      }
      await bot.sendMessage(
        msg.chat.id,
        `🚀 Cloning *${escapeMd(target)}* — skipping planning, going straight to build.`,
        { parse_mode: "Markdown" },
      );
      const clonePrompt =
        `Build a faithful MVP-grade clone of ${target}. Reproduce the core ` +
        `landing/marketing surface AND the primary product flow as a working ` +
        `client-side prototype: nav, hero, feature highlights, pricing, ` +
        `testimonials, footer, plus the signature interactive screen of ` +
        `${target} (e.g. Notion = an editable doc, Replit = a code editor + ` +
        `preview pane, GitHub = a repo file browser, Lovable = a chat-to-build ` +
        `surface). Match ${target}'s real palette, typography mood, and tone. ` +
        `Multi-page, mobile-responsive, fully functional with localStorage. ` +
        `No external assets — emojis and CSS-only visuals.`;
      await this.runCreate(ownerUserId, bot, msg.chat.id, clonePrompt);
    });

    bot.onText(/^\/(mysites|mysite)\b/i, async (msg) => {
      await this.listSites(ownerUserId, bot, msg.chat.id);
    });

    bot.onText(/^\/cancel\b/i, async (msg) => {
      const had = this.state.has(msg.chat.id);
      this.clearState(msg.chat.id);
      await bot.sendMessage(
        msg.chat.id,
        had
          ? "✅ Cancelled. Send `/create <idea>` when you're ready."
          : "Nothing to cancel — you're not in the middle of anything.",
        { parse_mode: "Markdown" },
      );
    });

    bot.onText(/^\/credits\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        [
          "💳 *Credits*",
          "",
          "Tier: *Free*",
          "Builds remaining today: *unlimited* (during beta)",
          "",
          "_Pro / VIP tiers coming soon — see /boosts._",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    });

    bot.onText(/^\/boosts\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        [
          "⚡ *Power-up tiers*",
          "",
          "🟢 *Free* — current",
          "  • Unlimited sites during beta",
          "  • Live token-by-token streaming",
          "  • Telegram + mobile + web",
          "",
          "🔵 *Pro* — _coming soon_",
          "  • Custom domains, real deployments, persistent runtimes",
          "  • Priority build queue",
          "  • Image generation included",
          "",
          "🟣 *VIP* — _coming soon_",
          "  • Team workspaces, CMS editor, secrets vault",
          "  • Multi-region autoscale hosting",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    });

    bot.onText(/^\/debug\b/i, async (msg) => {
      const lines = [
        "🩺 *Self-diagnostic*",
        "",
        `Bot: ${botId.slice(0, 8)}…`,
        `Chat: ${msg.chat.id}`,
        `User: ${msg.from?.id ?? "?"} (${escapeMd(msg.from?.username ?? "")})`,
        `Server time: ${new Date().toISOString()}`,
        `Public base: ${publicBaseUrl() || "(none)"}`,
        `OpenAI key: ${process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ? "✅" : "❌"}`,
        `Polling: ✅`,
      ];
      await bot.sendMessage(msg.chat.id, lines.join("\n"), {
        parse_mode: "Markdown",
      });
    });

    bot.onText(/^\/templates\b/i, async (msg) => {
      const lines = [
        "🧩 *Templates*",
        "",
        ...TEMPLATES.map(
          (t) =>
            `  • \`${t.key}\` — ${escapeMd(t.title)}\n    _${escapeMd(t.tagline)}_`,
        ),
        "",
        "Use `/template <key>` to build one instantly.",
      ];
      await bot.sendMessage(msg.chat.id, lines.join("\n"), {
        parse_mode: "Markdown",
      });
    });

    bot.onText(/^\/template\b\s*(.*)$/i, async (msg, match) => {
      const key = (match?.[1] ?? "").trim().toLowerCase();
      if (!key) {
        await bot.sendMessage(
          msg.chat.id,
          "Pick one: " + TEMPLATES.map((t) => `\`${t.key}\``).join(", ") +
            "\n\ne.g. `/template portfolio`",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const t = TEMPLATES.find((x) => x.key === key);
      if (!t) {
        await bot.sendMessage(
          msg.chat.id,
          `Unknown template *${escapeMd(key)}*. Try /templates.`,
          { parse_mode: "Markdown" },
        );
        return;
      }
      await this.runCreate(ownerUserId, bot, msg.chat.id, t.prompt);
    });

    bot.onText(/^\/image\b\s*(.*)$/i, async (msg, match) => {
      const prompt = (match?.[1] ?? "").trim();
      if (!prompt) {
        await bot.sendMessage(
          msg.chat.id,
          "🎨 Send a prompt: `/image neon cyberpunk skyline at dusk`",
          { parse_mode: "Markdown" },
        );
        return;
      }
      await this.runImage(bot, msg.chat.id, prompt);
    });

    bot.onText(/^\/code\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      await bot.sendMessage(
        msg.chat.id,
        arg
          ? `🛠️ \`/code\` is being wired up — for now use \`/create\` for HTML/CSS/JS sites.\n\nYour request: _${escapeMd(arg)}_ — saved.`
          : "Usage: `/code <language> <what to build>`\nExample: `/code python a CLI todo app`",
        { parse_mode: "Markdown" },
      );
    });

    bot.onText(/^\/secrets\b/i, async (msg) => {
      const list = await listSecrets(ownerUserId);
      if (list.length === 0) {
        await bot.sendMessage(
          msg.chat.id,
          [
            "🔒 *Secrets vault* — empty.",
            "",
            "Add one with `/setsecret NAME=value` — encrypted at rest and",
            "auto-injected into your sites whenever you reference `${NAME}`.",
            "",
            "Examples:",
            "  • `/setsecret OPENAI_API_KEY=sk-...`",
            "  • `/setsecret STRIPE_PUBLISHABLE_KEY=pk_live_...`",
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
        return;
      }
      const lines = [
        "🔒 *Your secrets* — encrypted at rest",
        "",
        ...list.map((s) => `  • \`${s.name}\``),
        "",
        "Reference them in any built site as `${NAME}` and I'll inject them at build-time.",
        "",
        "_Use `/delsecret NAME` to remove one._",
      ];
      await bot.sendMessage(msg.chat.id, lines.join("\n"), {
        parse_mode: "Markdown",
      });
    });

    bot.onText(/^\/setsecret\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      const m = arg.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.+)$/);
      // Always try to delete the user message so the plaintext secret never
      // sits in chat history — even if the syntax was wrong.
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
      if (!m) {
        await bot.sendMessage(
          msg.chat.id,
          [
            "Usage: `/setsecret NAME=value`",
            "",
            "Name must be uppercase letters, digits and underscores",
            "(e.g. `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`).",
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
        return;
      }
      const ok = await setSecret(ownerUserId, m[1], m[2].trim());
      if (!ok) {
        await bot.sendMessage(
          msg.chat.id,
          `❌ \`${escapeMd(m[1])}\` isn't a valid secret name.`,
          { parse_mode: "Markdown" },
        );
        return;
      }
      await bot.sendMessage(
        msg.chat.id,
        [
          `✅ Encrypted and stored \`${m[1]}\`.`,
          "",
          "Reference it in any future site as `${" + m[1] + "}` — I'll inject the real value at build-time.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    });

    bot.onText(/^\/delsecret\b\s*(.*)$/i, async (msg, match) => {
      const name = (match?.[1] ?? "").trim();
      if (!name) {
        await bot.sendMessage(
          msg.chat.id,
          "Usage: `/delsecret NAME`. List yours with `/secrets`.",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const removed = await deleteSecret(ownerUserId, name);
      await bot.sendMessage(
        msg.chat.id,
        removed
          ? `🗑️ Deleted \`${name}\`.`
          : `No secret named \`${escapeMd(name)}\`.`,
        { parse_mode: "Markdown" },
      );
    });

    // ---- Real-deployment family — coming soon, but recognised so the bot
    //      doesn't fall through to the "I don't understand" path. ----
    const comingSoon = (label: string, hint: string) =>
      [
        `🚧 *${label}* is on the roadmap — it needs real container hosting.`,
        ``,
        hint,
        ``,
        `_For now: \`/create\` builds + hosts websites instantly with live URLs._`,
      ].join("\n");

    bot.onText(/^\/deploy\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        comingSoon(
          "Deploy",
          "It will let you push Node/Python/Bun/Deno/Bash/Static apps with a real start command and an autoscale URL.",
        ),
        { parse_mode: "Markdown" },
      );
    });
    bot.onText(/^\/apps\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        comingSoon("Apps", "It will list your deployed apps with status, URLs, logs and scale-mode."),
        { parse_mode: "Markdown" },
      );
    });
    bot.onText(/^\/(appstart|appstop|applogs|appscale)\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        comingSoon("App control", "Start / stop / tail logs / scale a deployed app."),
        { parse_mode: "Markdown" },
      );
    });
    bot.onText(/^\/cms\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        comingSoon(
          "CMS",
          "A live visual editor for any page of any site you own. (You can already use `/edit <id> <change>` for AI edits today.)",
        ),
        { parse_mode: "Markdown" },
      );
    });
    bot.onText(/^\/host\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        comingSoon(
          "Host",
          "Upload a `.zip` of your own static or runtime code and serve it from a WebForge URL.",
        ),
        { parse_mode: "Markdown" },
      );
    });
    bot.onText(/^\/createbackend\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        comingSoon(
          "Create Backend",
          "Spin up a live FastAPI / Express backend with one command — auto routes, DB, auth, public URL.",
        ),
        { parse_mode: "Markdown" },
      );
    });
    bot.onText(/^\/backends\b/i, async (msg) => {
      await bot.sendMessage(
        msg.chat.id,
        comingSoon(
          "Backends",
          "List, restart and tail logs of your deployed backends.",
        ),
        { parse_mode: "Markdown" },
      );
    });

    bot.onText(/^\/status\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) {
        await this.sendStatus(ownerUserId, bot, msg.chat.id, arg);
      } else {
        this.setState(msg.chat.id, { awaiting: { kind: "status_site" } });
        await bot.sendMessage(msg.chat.id, "Which site? Send name or id.");
      }
    });

    bot.onText(/^\/preview\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) {
        await this.sendPreview(ownerUserId, bot, msg.chat.id, arg);
      } else {
        this.setState(msg.chat.id, { awaiting: { kind: "preview_site" } });
        await bot.sendMessage(msg.chat.id, "Which site? Send name or id.");
      }
    });

    bot.onText(/^\/edit\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) {
        const site = await this.findSite(ownerUserId, arg);
        if (!site) {
          await bot.sendMessage(msg.chat.id, "❌ No site matched.");
          return;
        }
        this.setState(msg.chat.id, {
          awaiting: { kind: "edit", siteId: site.id },
        });
        await bot.sendMessage(
          msg.chat.id,
          `✏️ Editing *${site.name}*. Send me what to change.`,
          { parse_mode: "Markdown" },
        );
      } else {
        await bot.sendMessage(
          msg.chat.id,
          "Use `/edit <name|id>` then send the changes.",
          { parse_mode: "Markdown" },
        );
      }
    });

    bot.onText(/^\/retry\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) await this.retrySite(ownerUserId, bot, msg.chat.id, arg);
      else {
        this.setState(msg.chat.id, { awaiting: { kind: "retry_site" } });
        await bot.sendMessage(msg.chat.id, "Which site to retry?");
      }
    });

    bot.onText(/^\/delete\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) await this.deleteSite(ownerUserId, bot, msg.chat.id, arg);
      else {
        this.setState(msg.chat.id, { awaiting: { kind: "delete_site" } });
        await bot.sendMessage(msg.chat.id, "Which site to delete?");
      }
    });

    bot.onText(/^\/(tasks|queue)\b/i, async (msg) => {
      await this.listJobs(ownerUserId, bot, msg.chat.id);
    });

    bot.onText(/^\/hostbot\b/i, async (msg) => {
      this.setState(msg.chat.id, { awaiting: { kind: "host_token" } });
      await bot.sendMessage(
        msg.chat.id,
        "🤖 Send me a Telegram bot token from @BotFather.\n\n" +
          "I'll delete your message immediately for safety, validate the token, " +
          "and then ask a couple of quick questions.",
      );
    });

    bot.onText(/^\/mybots\b/i, async (msg) => {
      await this.listBots(ownerUserId, bot, msg.chat.id);
    });

    bot.onText(/^\/stopbot\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) await this.stopBotByArg(ownerUserId, bot, msg.chat.id, arg);
      else {
        this.setState(msg.chat.id, { awaiting: { kind: "stop_bot" } });
        await bot.sendMessage(msg.chat.id, "Send the bot username or id.");
      }
    });

    // Voice note handler — must be registered before the text router so
    // it fires on messages that have no text but DO have a voice attachment.
    bot.on("message", async (msg) => {
      if (!msg.voice && !msg.audio) return;
      await this.handleVoiceNote(ownerUserId, bot, msg).catch((err) => {
        logger.warn({ err }, "voice note failed");
      });
    });

    // Free-text message router
    bot.on("message", async (msg) => {
      const text = msg.text?.trim();
      if (!text || text.startsWith("/")) return;
      const state = this.state.get(String(msg.chat.id));
      if (!state?.awaiting) {
        // No pending state — interpret with LLM and route.
        await this.handleFreeText(ownerUserId, bot, msg.chat.id, text).catch(
          (err) => {
            logger.warn({ err }, "free-text route failed");
          },
        );
        return;
      }

      switch (state.awaiting.kind) {
        case "create":
          this.clearState(msg.chat.id);
          await this.runCreate(ownerUserId, bot, msg.chat.id, text);
          return;
        case "edit": {
          const siteId = state.awaiting.siteId;
          this.clearState(msg.chat.id);
          await this.runEdit(ownerUserId, bot, msg.chat.id, siteId, text);
          return;
        }
        case "host_token":
          // Delete the message that contains the token immediately.
          await bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
          await this.handleHostToken(ownerUserId, bot, msg.chat.id, text);
          return;
        case "host_purpose": {
          const next = state.awaiting;
          this.setState(msg.chat.id, {
            awaiting: {
              kind: "host_ai",
              pendingId: next.pendingId,
              username: next.username,
              purpose: text,
            },
          });
          await bot.sendMessage(
            msg.chat.id,
            "🤖 Should this bot be powered by AI? (yes / no)",
          );
          return;
        }
        case "host_ai": {
          const lc = text.toLowerCase();
          const useAi = /^(y|yes|true|1|sure|please|ai)/.test(lc);
          const stash = state.awaiting;
          this.clearState(msg.chat.id);
          await this.finalizeHostedBot(
            ownerUserId,
            bot,
            msg.chat.id,
            stash.pendingId,
            stash.username,
            stash.purpose,
            useAi,
          );
          return;
        }
        case "stop_bot":
          this.clearState(msg.chat.id);
          await this.stopBotByArg(ownerUserId, bot, msg.chat.id, text);
          return;
        case "delete_site":
          this.clearState(msg.chat.id);
          await this.deleteSite(ownerUserId, bot, msg.chat.id, text);
          return;
        case "preview_site":
          this.clearState(msg.chat.id);
          await this.sendPreview(ownerUserId, bot, msg.chat.id, text);
          return;
        case "retry_site":
          this.clearState(msg.chat.id);
          await this.retrySite(ownerUserId, bot, msg.chat.id, text);
          return;
        case "status_site":
          this.clearState(msg.chat.id);
          await this.sendStatus(ownerUserId, bot, msg.chat.id, text);
          return;
        case "confirm_build": {
          const siteId = state.awaiting.siteId;
          const lc = text.toLowerCase();
          if (
            /^(build|yes|go|ship it|do it|confirm|approve|let'?s go|sounds good)\b/.test(
              lc,
            )
          ) {
            this.clearState(msg.chat.id);
            await this.confirmBuild(ownerUserId, bot, msg.chat.id, siteId);
          } else {
            // treat as edit instructions on the plan
            this.clearState(msg.chat.id);
            await bot.sendMessage(
              msg.chat.id,
              "👌 Got it. I'll incorporate that. Re-send `/preview` after I rebuild.",
              { parse_mode: "Markdown" },
            );
          }
          return;
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private setState(chatId: number | string, s: ChatState): void {
    this.state.set(String(chatId), s);
  }
  private clearState(chatId: number | string): void {
    this.state.delete(String(chatId));
  }

  /**
   * Handle an incoming voice or audio message.
   * 1. Downloads the OGG/audio file from Telegram.
   * 2. Transcribes it with Whisper.
   * 3. Confirms with the user and dispatches via handleFreeText.
   */
  private async handleVoiceNote(
    userId: string,
    bot: TelegramBot,
    msg: TelegramBot.Message,
  ): Promise<void> {
    const chatId = msg.chat.id;
    const fileId = msg.voice?.file_id ?? msg.audio?.file_id;
    if (!fileId) return;

    const duration = msg.voice?.duration ?? msg.audio?.duration ?? 0;
    if (duration > 120) {
      await bot.sendMessage(
        chatId,
        "🎙 Voice notes over 2 minutes aren't supported yet — please keep it short!",
      );
      return;
    }

    const thinking = await bot.sendMessage(chatId, "🎙 Transcribing your voice note…");

    try {
      // Download the file bytes from Telegram servers
      const fileLink = await bot.getFileLink(fileId);
      const audioRes = await fetch(fileLink, { signal: AbortSignal.timeout(30_000) });
      if (!audioRes.ok) throw new Error(`Telegram file download ${audioRes.status}`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      // Detect format — Telegram voice = OGG Opus, audio = varies
      const isOgg =
        audioBuffer[0] === 0x4f &&
        audioBuffer[1] === 0x67 &&
        audioBuffer[2] === 0x67 &&
        audioBuffer[3] === 0x53;

      const transcript = await speechToText(
        audioBuffer,
        isOgg ? "webm" : "mp3", // OGG Opus is close enough; Whisper handles it
      );

      if (!transcript.trim()) {
        await bot.editMessageText(
          "🎙 I couldn't make out any speech — try again in a quieter spot!",
          { chat_id: chatId, message_id: thinking.message_id },
        );
        return;
      }

      // Show what was transcribed so the user can verify
      await bot.editMessageText(
        `🎙 _"${escapeMd(transcript.trim())}"_\n\nProcessing…`,
        { chat_id: chatId, message_id: thinking.message_id, parse_mode: "Markdown" },
      );

      // Route via the normal free-text pipeline
      await this.handleFreeText(userId, bot, chatId, transcript.trim());
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: errMsg, chatId }, "voice note transcription failed");
      await bot
        .editMessageText(
          `❌ Voice transcription failed: ${escapeMd(errMsg.slice(0, 180))}\n\nTry typing your message instead.`,
          { chat_id: chatId, message_id: thinking.message_id },
        )
        .catch(() => {});
    }
  }

  /**
   * Free-text router — used when the user sends a non-command message and
   * has no pending state. We ask the LLM to classify intent against the
   * user's existing sites and dispatch.
   */
  private async handleFreeText(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    text: string,
  ): Promise<void> {
    const sites = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.userId, userId))
      .orderBy(desc(sitesTable.updatedAt))
      .limit(10);

    const intent = await this.classifyIntent(text, sites);
    logger.info({ intent, text }, "telegram free-text intent");

    if (intent.action === "create") {
      await bot.sendMessage(
        chatId,
        intent.reply ?? "🔨 Let's forge something. Starting analysis…",
      );
      await this.runCreate(userId, bot, chatId, intent.prompt ?? text);
      return;
    }

    if (intent.action === "edit" && intent.siteId) {
      const site = sites.find((s) => s.id === intent.siteId);
      if (site) {
        await bot.sendMessage(
          chatId,
          intent.reply ?? `✏️ Updating *${site.name}*…`,
          { parse_mode: "Markdown" },
        );
        await this.runEdit(
          userId,
          bot,
          chatId,
          site.id,
          intent.instructions ?? text,
        );
        return;
      }
    }

    if (intent.action === "status" && intent.siteId) {
      await this.sendStatus(userId, bot, chatId, intent.siteId);
      return;
    }

    if (intent.action === "preview" && intent.siteId) {
      await this.sendPreview(userId, bot, chatId, intent.siteId);
      return;
    }

    if (intent.action === "list_sites") {
      await this.listSites(userId, bot, chatId);
      return;
    }

    // Fallback: just chat back.
    await bot.sendMessage(
      chatId,
      intent.reply ??
        "Hey! Tell me what to build (e.g. \"a coffee shop landing page\") or /help for commands.",
    );
  }

  private async classifyIntent(
    text: string,
    sites: Site[],
  ): Promise<{
    action:
      | "create"
      | "edit"
      | "status"
      | "preview"
      | "list_sites"
      | "chat";
    siteId?: string;
    prompt?: string;
    instructions?: string;
    reply?: string;
  }> {
    const sitesContext = sites.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      status: s.status,
      prompt: s.prompt.slice(0, 200),
    }));
    const sys = `You are WebForge, a conversational AI co-builder for websites (like Bolt.new but in Telegram).
The user just sent a free-text message. Classify their intent against their existing sites and respond with JSON.

Possible actions:
- "create": user wants a NEW site. Provide "prompt" (cleaned up version of what they want) and a friendly "reply".
- "edit": user wants to change an EXISTING site. Provide "siteId" (must match one in context) and "instructions".
- "status": user is asking about progress on a site. Provide "siteId".
- "preview": user wants the live link to a site. Provide "siteId".
- "list_sites": user wants to see all their sites.
- "chat": small talk, greeting, or ambiguous. Provide "reply" (warm, helpful, short, suggest what they could do).

Schema:
{
  "action": "create"|"edit"|"status"|"preview"|"list_sites"|"chat",
  "siteId"?: string,
  "prompt"?: string,
  "instructions"?: string,
  "reply"?: string
}

Rules:
- Only set "siteId" to an id from the user's sites context.
- If unsure between create and edit, prefer "chat" with a clarifying reply.
- Replies should be ≤ 2 sentences, warm, lowercase-ish like a friend who builds.`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: `User's sites:\n${JSON.stringify(sitesContext, null, 2)}\n\nUser message: ${text}`,
          },
        ],
      });
      const body = completion.choices[0]?.message?.content?.trim() ?? "{}";
      const parsed = JSON.parse(body);
      return parsed;
    } catch (err) {
      logger.warn({ err: String(err) }, "intent classify failed");
      // Heuristic fallback — treat as create if it looks like a site description.
      if (text.length > 12) {
        return { action: "create", prompt: text };
      }
      return {
        action: "chat",
        reply:
          "I didn't catch that. Tell me what to build — e.g. \"a portfolio for a wedding photographer\".",
      };
    }
  }

  private helpText(): string {
    return [
      "🤖 *WebForge AI — Full command reference*",
      "",
      "*Build & clone*",
      "👋  `/start` — Start here / show welcome",
      "🪄  `/create <idea>` — Have AI build a website for you",
      "⚡  `/clone <product>` — Instant clone (e.g. `/clone notion`)",
      "🎨  `/templates` — Browse ready-made site templates",
      "🧩  `/template <key>` — Build a template instantly",
      "✏️  `/edit <name|id>` — Edit one of your sites with AI",
      "🔁  `/retry <name|id>` — Retry a failed build",
      "🗑  `/delete <name|id>` — Delete a site",
      "",
      "*Apps & infra*",
      "🚀  `/deploy` — Deploy any app (Node, Python, Bun, Deno…) — _coming soon_",
      "📦  `/apps` — List & manage your deployed apps — _coming soon_",
      "🛠  `/createbackend` — Deploy a live FastAPI/Express backend — _coming soon_",
      "📁  `/backends` — List your deployed backends — _coming soon_",
      "🛠  `/cms` — Open the visual CMS editor — _coming soon_",
      "📦  `/host` — Upload a .zip to host your own code — _coming soon_",
      "💻  `/code <lang> <what>` — Generate code in any language — _coming soon_",
      "",
      "*Your stuff*",
      "🌐  `/mysite` — View & manage your websites",
      "📊  `/status <name|id>` — Check a website's status",
      "👀  `/preview <name|id>` — Get the live URL",
      "🔒  `/secrets` — Manage encrypted API keys (auto-injected at build)",
      "🔑  `/setsecret NAME=value` — Add a secret",
      "🗑  `/delsecret NAME` — Remove a secret",
      "📋  `/tasks` — See your active jobs",
      "💳  `/credits` — Show your credit balance & tier",
      "⚡  `/boosts` — See Pro / VIP power-up tiers",
      "",
      "*Bots*",
      "🤖  `/hostbot <token>` — Host your own Telegram bot",
      "🤖  `/mybots` — List your hosted bots",
      "🛑  `/stopbot @username` — Stop one of your bots",
      "",
      "*Extras*",
      "🎨  `/image <prompt>` — Generate an image from text",
      "🩺  `/debug` — Self-diagnostic report",
      "❓  `/help` — This guide",
      "✗  `/cancel` — Cancel current action",
      "",
      "🎙 *Voice notes:* send a voice message and I'll transcribe & build it.",
      "",
      "*Build modes (after `/create`):*",
      "🚀 Simple — fastest path, ~2 min",
      "🤖 Autonomous — self-review + auto-fix, ~3–4 min",
      "📋 Background — runs in parallel, free chat",
    ].join("\n");
  }

  private async runImage(
    bot: TelegramBot,
    chatId: number,
    prompt: string,
  ): Promise<void> {
    const placeholder = await bot.sendMessage(
      chatId,
      `🎨 Painting _${escapeMd(prompt)}_…`,
      { parse_mode: "Markdown" },
    );

    /** Attempt image generation from a given endpoint + key + model. */
    const tryGenerate = async (
      base: string,
      key: string,
      model: string,
    ): Promise<Buffer> => {
      const r = await fetch(`${base.replace(/\/$/, "")}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, prompt, size: "1024x1024", n: 1 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`image api ${r.status}: ${body.slice(0, 200)}`);
      }
      const data = (await r.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const item = data.data?.[0];
      if (!item) throw new Error("no image in response");
      if (item.b64_json) return Buffer.from(item.b64_json, "base64");
      if (item.url) {
        const ir = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
        return Buffer.from(await ir.arrayBuffer());
      }
      throw new Error("no image bytes in response");
    };

    try {
      let buffer: Buffer | null = null;

      // 1. Try primary OpenAI integration
      const primaryBase = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
      const primaryKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
      if (primaryBase && primaryKey) {
        try {
          buffer = await tryGenerate(primaryBase, primaryKey, "gpt-image-1");
        } catch (primaryErr) {
          logger.warn(
            { err: String(primaryErr) },
            "runImage primary failed; trying fallback",
          );
        }
      }

      // 2. Fall back to aimodelapi.onrender.com's image-gen model
      if (!buffer) {
        const fallbackBase = process.env["FALLBACK_AI_BASE_URL"];
        const fallbackKey = process.env["FALLBACK_AI_API_KEY"];
        if (!fallbackBase || !fallbackKey) {
          throw new Error(
            "Primary image API failed and no fallback is configured.",
          );
        }
        await bot
          .editMessageText(
            `🎨 Painting _${escapeMd(prompt)}_… (using fallback AI)`,
            {
              chat_id: chatId,
              message_id: placeholder.message_id,
              parse_mode: "Markdown",
            },
          )
          .catch(() => {});
        buffer = await tryGenerate(fallbackBase, fallbackKey, "image-gen");
      }

      if (!buffer) throw new Error("no image produced");

      await bot.deleteMessage(chatId, placeholder.message_id).catch(() => {});
      await bot.sendPhoto(
        chatId,
        buffer,
        { caption: `🎨 ${prompt}` },
        { filename: "image.png", contentType: "image/png" },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: errMsg }, "runImage failed");
      await bot
        .editMessageText(
          `❌ Image generation failed: ${escapeMd(errMsg.slice(0, 200))}`,
          { chat_id: chatId, message_id: placeholder.message_id },
        )
        .catch(() => {});
    }
  }

  private async runCreate(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    prompt: string,
  ): Promise<void> {
    const baseUrl = publicBaseUrl();
    const name = inferSiteName(prompt);
    const slug = await uniqueSlug(name);
    const [site] = await db
      .insert(sitesTable)
      .values({
        userId,
        name,
        slug,
        prompt,
        status: "queued",
      })
      .returning();
    await db.insert(messagesTable).values({
      userId,
      siteId: site.id,
      role: "user",
      kind: "text",
      content: prompt,
    });
    const [job] = await db
      .insert(jobsTable)
      .values({
        userId,
        siteId: site.id,
        kind: "analyze",
        // Auto-chain straight into a build job once analysis completes —
        // the user already told us what they want.
        instructions: AUTO_BUILD_SENTINEL,
        status: "queued",
        progress: 0,
        message: "Queued",
      })
      .returning();
    await jobQueue.enqueue(job.id);
    const liveUrl = `${baseUrl}/api/hosted/${site.slug}/`;
    await bot.sendMessage(
      chatId,
      [
        `🔨 Forging *${escapeMd(site.name)}*…`,
        ``,
        `🔍 Analyzing your idea…`,
        `🎨 I'll write the CSS, JS and HTML live, token-by-token.`,
        ``,
        `📺 *Watch it build in real time:*`,
        liveUrl,
        ``,
        `_Open that link now — you'll see the model's tokens stream into the page._`,
      ].join("\n"),
      { parse_mode: "Markdown", disable_web_page_preview: false },
    );
    void this.pollBuildAndStream(bot, chatId, site.id);
  }

  private async runEdit(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    siteId: string,
    instructions: string,
  ): Promise<void> {
    const [site] = await db
      .select()
      .from(sitesTable)
      .where(and(eq(sitesTable.id, siteId), eq(sitesTable.userId, userId)))
      .limit(1);
    if (!site) {
      await bot.sendMessage(chatId, "❌ Site not found.");
      return;
    }
    await db.insert(messagesTable).values({
      userId,
      siteId: site.id,
      role: "user",
      kind: "text",
      content: instructions,
    });
    const [job] = await db
      .insert(jobsTable)
      .values({
        userId,
        siteId: site.id,
        kind: "edit",
        instructions,
        status: "queued",
        progress: 0,
        message: "Queued",
      })
      .returning();
    await db
      .update(sitesTable)
      .set({ status: "queued", progress: 0, message: "Queued", error: null })
      .where(eq(sitesTable.id, site.id));
    await jobQueue.enqueue(job.id);
    await bot.sendMessage(chatId, `✏️ Updating *${site.name}*…`, {
      parse_mode: "Markdown",
    });
    void this.pollBuildAndNotify(bot, chatId, site.id);
  }

  private async confirmBuild(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    siteId: string,
  ): Promise<void> {
    const [site] = await db
      .select()
      .from(sitesTable)
      .where(and(eq(sitesTable.id, siteId), eq(sitesTable.userId, userId)))
      .limit(1);
    if (!site) return;
    await db.insert(messagesTable).values({
      userId,
      siteId,
      role: "user",
      kind: "text",
      content: "Confirmed via Telegram",
    });
    const [job] = await db
      .insert(jobsTable)
      .values({
        userId,
        siteId,
        kind: "create",
        status: "queued",
        progress: 0,
        message: "Queued",
      })
      .returning();
    await db
      .update(sitesTable)
      .set({ status: "queued", progress: 0, message: "Queued" })
      .where(eq(sitesTable.id, siteId));
    await jobQueue.enqueue(job.id);
    await bot.sendMessage(chatId, `🛠️ Building *${site.name}*…`, {
      parse_mode: "Markdown",
    });
    void this.pollBuildAndNotify(bot, chatId, siteId);
  }

  private async pollAnalysisAndAskConfirmation(
    bot: TelegramBot,
    chatId: number,
    siteId: string,
  ): Promise<void> {
    for (let i = 0; i < 80; i++) {
      await sleep(1500);
      const [s] = await db
        .select()
        .from(sitesTable)
        .where(eq(sitesTable.id, siteId))
        .limit(1);
      if (!s) return;
      if (s.status === "awaiting_confirmation" && s.plan) {
        const lines: string[] = [];
        lines.push(`📋 *Plan for ${s.name}*`);
        lines.push("");
        lines.push(s.plan.summary);
        lines.push("");
        lines.push("*Pages:*");
        for (const p of s.plan.pages) lines.push(`  • ${p.title}`);
        lines.push("");
        lines.push(`Style: ${s.plan.styles.palette} (${s.plan.styles.mood})`);
        lines.push("");
        lines.push("Reply `build` to confirm, or describe changes.");
        this.setState(chatId, { awaiting: { kind: "confirm_build", siteId } });
        await bot.sendMessage(chatId, lines.join("\n"), {
          parse_mode: "Markdown",
        });
        return;
      }
      if (s.status === "failed") {
        await bot.sendMessage(
          chatId,
          `❌ Analysis failed: ${s.error ?? "unknown"}`,
        );
        return;
      }
    }
  }

  private async pollBuildAndNotify(
    bot: TelegramBot,
    chatId: number,
    siteId: string,
  ): Promise<void> {
    return this.pollBuildAndStream(bot, chatId, siteId);
  }

  /**
   * Watch a site through the analyze + build pipeline. While it's being
   * built we send a single progress message to the chat and edit it as
   * the model streams new files. When it finishes (or fails) we send a
   * dedicated "live" / "failed" message.
   */
  private async pollBuildAndStream(
    bot: TelegramBot,
    chatId: number,
    siteId: string,
  ): Promise<void> {
    const baseUrl = publicBaseUrl();
    let progressMessageId: number | null = null;
    let lastRendered = "";
    const seenFiles = new Set<string>();

    // 7-step build narrative — each step "completes" once we've crossed
    // its progress threshold. Mirrors the user-visible feel of mature
    // Lovable / v0-style builders.
    const STEPS: { at: number; label: string }[] = [
      { at: 5, label: "Researching design inspiration" },
      { at: 18, label: "Building the full website with AI" },
      { at: 55, label: "Auditing quality: SEO, accessibility, mobile" },
      { at: 72, label: "Self-review pass (autonomous QA)" },
      { at: 84, label: "Auto-fixing issues found" },
      { at: 92, label: "Generating AI hero image" },
      { at: 100, label: "Publishing to your live URL" },
    ];

    const renderProgress = (s: Site, files: string[]) => {
      const pct = s.progress ?? 0;
      const lines = [`🔨 *${escapeMd(s.name)}*`, ""];
      STEPS.forEach((step, i) => {
        const done = pct >= step.at;
        const active = !done && (i === 0 || pct >= STEPS[i - 1].at);
        const icon = done ? "✅" : active ? "⏳" : "⚪";
        lines.push(`${icon} Step ${i + 1}/7: ${step.label}`);
      });
      lines.push("");
      lines.push(`${renderBar(pct)}  *${pct}%*`);
      if (s.message) {
        lines.push(`_${escapeMd(s.message)}_`);
      }
      if (files.length > 0) {
        lines.push("");
        lines.push(`📄 ${files.length} file${files.length === 1 ? "" : "s"} written`);
        for (const f of files.slice(-3)) lines.push(`  ✓ \`${f}\``);
      }
      lines.push("");
      lines.push(`📺 [Watch it build live](${baseUrl}/api/hosted/${s.slug}/)`);
      return lines.join("\n");
    };

    const sendOrEditProgress = async (s: Site) => {
      const files = s.files ? Object.keys(s.files) : [];
      for (const f of files) seenFiles.add(f);
      const orderedFiles = Array.from(seenFiles);
      const text = renderProgress(s, orderedFiles);
      if (text === lastRendered) return;
      lastRendered = text;
      try {
        if (progressMessageId == null) {
          const sent = await bot.sendMessage(chatId, text, {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          });
          progressMessageId = sent.message_id;
        } else {
          await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: progressMessageId,
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          });
        }
      } catch (err) {
        // editMessageText throws if the body didn't change — ignore.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/message is not modified/i.test(msg)) {
          logger.debug({ err: msg }, "telegram editMessage skipped");
        }
      }
    };

    for (let i = 0; i < 240; i++) {
      await sleep(1500);
      const [s] = await db
        .select()
        .from(sitesTable)
        .where(eq(sitesTable.id, siteId))
        .limit(1);
      if (!s) return;

      if (s.status === "analyzing" || s.status === "building" || s.status === "queued") {
        await sendOrEditProgress(s);
        continue;
      }

      if (s.status === "ready") {
        // Final progress edit at 100%, then a fresh "live" message.
        await sendOrEditProgress(s);
        const files = s.files ? Object.keys(s.files) : [];
        await bot.sendMessage(
          chatId,
          [
            `🎉 *${escapeMd(s.name)} is LIVE!*`,
            ``,
            `🌐 ${baseUrl}/api/hosted/${s.slug}/`,
            ``,
            `📋 *What was built:*`,
            `• ${files.length} files (${escapeMd(formatSize(byteSize(s.files)))})`,
            `• Hosted on the WebForge server ✓`,
            `• Mobile-responsive ✓`,
            `• Streamed live from the model ✓`,
            ``,
            `_Tap the link above. Use \`/edit ${escapeMd(s.name)}\` to tweak it._`,
          ].join("\n"),
          { parse_mode: "Markdown", disable_web_page_preview: false },
        );
        return;
      }
      if (s.status === "failed") {
        await bot.sendMessage(
          chatId,
          `❌ Build failed: ${escapeMd(s.error ?? "unknown")}\n\nTry \`/retry ${escapeMd(s.name)}\``,
          { parse_mode: "Markdown" },
        );
        return;
      }
    }
  }

  private async findSite(userId: string, arg: string) {
    const lower = arg.toLowerCase().trim();
    const sites = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.userId, userId))
      .orderBy(desc(sitesTable.createdAt));
    return (
      sites.find((s) => s.id === arg) ||
      sites.find((s) => s.slug.toLowerCase() === lower) ||
      sites.find((s) => s.name.toLowerCase() === lower) ||
      sites.find((s) => s.name.toLowerCase().includes(lower))
    );
  }

  private async listSites(
    userId: string,
    bot: TelegramBot,
    chatId: number,
  ): Promise<void> {
    const baseUrl = publicBaseUrl();
    const sites = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.userId, userId))
      .orderBy(desc(sitesTable.createdAt))
      .limit(20);
    if (sites.length === 0) {
      await bot.sendMessage(chatId, "📭 No sites yet. Try `/create`.", {
        parse_mode: "Markdown",
      });
      return;
    }
    const lines = sites.map((s) => {
      const emoji =
        s.status === "ready"
          ? "✅"
          : s.status === "failed"
            ? "❌"
            : s.status === "building" || s.status === "analyzing"
              ? "🛠️"
              : s.status === "awaiting_confirmation"
                ? "⏸️"
                : "⏳";
      return `${emoji} *${s.name}* — ${s.status}\n${baseUrl}/api/hosted/${s.slug}/`;
    });
    await bot.sendMessage(chatId, lines.join("\n\n"), {
      parse_mode: "Markdown",
    });
  }

  private async sendStatus(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    arg: string,
  ): Promise<void> {
    const site = await this.findSite(userId, arg);
    if (!site) {
      await bot.sendMessage(chatId, "❌ No site matched.");
      return;
    }
    await bot.sendMessage(
      chatId,
      `*${site.name}*\nstatus: ${site.status}\nprogress: ${site.progress}%\n${site.message ?? ""}`,
      { parse_mode: "Markdown" },
    );
  }

  private async sendPreview(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    arg: string,
  ): Promise<void> {
    const baseUrl = publicBaseUrl();
    const site = await this.findSite(userId, arg);
    if (!site) {
      await bot.sendMessage(chatId, "❌ No site matched.");
      return;
    }
    if (site.status !== "ready") {
      await bot.sendMessage(
        chatId,
        `⏳ *${site.name}* is ${site.status} (${site.progress}%).`,
        { parse_mode: "Markdown" },
      );
      return;
    }
    await bot.sendMessage(chatId, `🔗 ${baseUrl}/api/hosted/${site.slug}/`);
  }

  private async retrySite(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    arg: string,
  ): Promise<void> {
    const site = await this.findSite(userId, arg);
    if (!site) {
      await bot.sendMessage(chatId, "❌ No site matched.");
      return;
    }
    const kind = site.plan ? "retry" : "analyze";
    const [job] = await db
      .insert(jobsTable)
      .values({
        userId,
        siteId: site.id,
        kind,
        status: "queued",
        progress: 0,
        message: "Queued",
      })
      .returning();
    await db
      .update(sitesTable)
      .set({ status: "queued", progress: 0, error: null, message: "Queued" })
      .where(eq(sitesTable.id, site.id));
    await jobQueue.enqueue(job.id);
    await bot.sendMessage(chatId, `🔁 Retrying *${site.name}*…`, {
      parse_mode: "Markdown",
    });
    void this.pollBuildAndNotify(bot, chatId, site.id);
  }

  private async deleteSite(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    arg: string,
  ): Promise<void> {
    const site = await this.findSite(userId, arg);
    if (!site) {
      await bot.sendMessage(chatId, "❌ No site matched.");
      return;
    }
    await db.delete(sitesTable).where(eq(sitesTable.id, site.id));
    await bot.sendMessage(chatId, `🗑️ Deleted *${site.name}*.`, {
      parse_mode: "Markdown",
    });
  }

  private async listJobs(
    userId: string,
    bot: TelegramBot,
    chatId: number,
  ): Promise<void> {
    const rows = await db
      .select({
        id: jobsTable.id,
        kind: jobsTable.kind,
        status: jobsTable.status,
        progress: jobsTable.progress,
        message: jobsTable.message,
        siteName: sitesTable.name,
      })
      .from(jobsTable)
      .innerJoin(sitesTable, eq(sitesTable.id, jobsTable.siteId))
      .where(eq(jobsTable.userId, userId))
      .orderBy(desc(jobsTable.createdAt))
      .limit(15);
    if (rows.length === 0) {
      await bot.sendMessage(chatId, "📭 No tasks yet.");
      return;
    }
    const lines = rows.map((j) => {
      const emoji =
        j.status === "done"
          ? "✅"
          : j.status === "failed"
            ? "❌"
            : j.status === "running"
              ? "🛠️"
              : "⏳";
      return `${emoji} ${j.kind} — *${j.siteName}* (${j.progress}%) ${j.message ?? ""}`;
    });
    await bot.sendMessage(chatId, lines.join("\n"), {
      parse_mode: "Markdown",
    });
  }

  // ---- Bot hosting conversation flow --------------------------------------

  private async handleHostToken(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    token: string,
  ): Promise<void> {
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
      await bot.sendMessage(
        chatId,
        "❌ That doesn't look like a valid bot token. Get one from @BotFather.",
      );
      this.clearState(chatId);
      return;
    }
    // Test the token via getMe before storing it.
    let me: { username?: string; first_name?: string };
    try {
      const probe = new TelegramBot(token, { polling: false });
      me = await probe.getMe();
    } catch (err) {
      await bot.sendMessage(
        chatId,
        `❌ Telegram rejected that token: ${err instanceof Error ? err.message : "invalid"}`,
      );
      this.clearState(chatId);
      return;
    }
    const username = me.username ?? "unknown";
    // Stash in memory and ask for the bot's purpose.
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pendingHosted.set(pendingId, {
      token,
      username,
      displayName: me.first_name ?? null,
    });
    this.setState(chatId, {
      awaiting: { kind: "host_purpose", pendingId, username },
    });
    await bot.sendMessage(
      chatId,
      `✅ Token validated for @${username}.\n\nWhat is this bot for? (one or two sentences)`,
    );
  }

  private async finalizeHostedBot(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    pendingId: string,
    username: string,
    purpose: string,
    useAi: boolean,
  ): Promise<void> {
    const stash = this.pendingHosted.get(pendingId);
    this.pendingHosted.delete(pendingId);
    if (!stash) {
      await bot.sendMessage(chatId, "❌ That request expired. Try `/hostbot` again.");
      return;
    }
    const preview = `${stash.token.slice(0, 6)}…${stash.token.slice(-4)}`;
    const [record] = await db
      .insert(telegramBotsTable)
      .values({
        userId,
        token: stash.token,
        tokenPreview: preview,
        username: stash.username,
        displayName: stash.displayName,
        status: "active",
      })
      .returning();
    try {
      await this.startBot(record);
      const aiNote = useAi
        ? "AI replies are *enabled*."
        : "AI replies are *disabled* — only commands work.";
      await bot.sendMessage(
        chatId,
        [
          `✅ Hosting @${username}.`,
          `Purpose: _${escapeMd(purpose)}_`,
          aiNote,
          "Try `/start` over there.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      await db
        .update(telegramBotsTable)
        .set({
          status: "error",
          lastError: err instanceof Error ? err.message : "unknown",
        })
        .where(eq(telegramBotsTable.id, record.id));
      await bot.sendMessage(
        chatId,
        `❌ Could not start that bot: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  private async listBots(
    userId: string,
    bot: TelegramBot,
    chatId: number,
  ): Promise<void> {
    const bots = await db
      .select()
      .from(telegramBotsTable)
      .where(eq(telegramBotsTable.userId, userId))
      .orderBy(desc(telegramBotsTable.createdAt));
    if (bots.length === 0) {
      await bot.sendMessage(chatId, "📭 No hosted bots. Try `/hostbot`.", {
        parse_mode: "Markdown",
      });
      return;
    }
    const lines = bots.map((b) => {
      const emoji =
        b.status === "active" ? "🟢" : b.status === "error" ? "🔴" : "⚪️";
      return `${emoji} @${b.username ?? "unknown"} — ${b.status} (${b.tokenPreview})`;
    });
    await bot.sendMessage(chatId, lines.join("\n"));
  }

  private async stopBotByArg(
    userId: string,
    bot: TelegramBot,
    chatId: number,
    arg: string,
  ): Promise<void> {
    const lower = arg.toLowerCase().replace(/^@/, "").trim();
    const bots = await db
      .select()
      .from(telegramBotsTable)
      .where(eq(telegramBotsTable.userId, userId));
    const target =
      bots.find((b) => b.id === arg) ||
      bots.find((b) => (b.username ?? "").toLowerCase() === lower);
    if (!target) {
      await bot.sendMessage(chatId, "❌ No bot matched.");
      return;
    }
    await this.stopBot(target.id);
    await db
      .update(telegramBotsTable)
      .set({ status: "stopped", updatedAt: new Date() })
      .where(eq(telegramBotsTable.id, target.id));
    await bot.sendMessage(
      chatId,
      `🛑 Stopped @${target.username ?? target.tokenPreview}.`,
    );
  }
}

function escapeMd(s: string): string {
  return s.replace(/([_*`[\]()])/g, "\\$1");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function renderBar(pct: number, width = 14): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((clamped / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function byteSize(files: Record<string, string> | null | undefined): number {
  if (!files) return 0;
  let total = 0;
  for (const v of Object.values(files)) total += Buffer.byteLength(v, "utf8");
  return total;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function publicBaseUrl(): string {
  return (
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "")
  );
}

export function publicHost(): string {
  const url = publicBaseUrl();
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export const telegramBots = new TelegramBotManager();

void usersTable;

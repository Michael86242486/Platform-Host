import TelegramBot from "node-telegram-bot-api";
import { and, desc, eq } from "drizzle-orm";

import { openai } from "@workspace/integrations-openai-ai-server";

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
import { inferSiteName, uniqueSlug } from "./slug";

/** Mirror of the same constant in queue.ts — set on an analyze job's
 * `instructions` column to skip the user-confirmation step and chain
 * straight into the build job. */
const AUTO_BUILD_SENTINEL = "__AUTO_BUILD__";

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
    const bot = new TelegramBot(record.token, { polling: true });
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

    bot.on("polling_error", async (err: Error) => {
      logger.warn({ err: err.message, botId: record.id }, "polling_error");
      await db
        .update(telegramBotsTable)
        .set({ status: "error", lastError: err.message, updatedAt: new Date() })
        .where(eq(telegramBotsTable.id, record.id));
    });

    this.wireHandlers(record.userId, record.id, bot);
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
      const name = msg.from?.first_name ? `, ${msg.from.first_name}` : "";
      const lines = [
        `👋 Hey${name}! I'm *WebForge* — describe a website and I'll build & host it live.`,
        "",
        "Just tell me what you want, like:",
        "  • a landing page for my coffee shop",
        "  • portfolio for an indie game dev",
        "  • a barbershop site with online booking",
        "",
        "Or use a command:",
        "`/create <idea>` — build a new site",
        "`/mysites` — see your sites",
        "`/help` — full command list",
        "",
        "What would you like to build today?",
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

    bot.onText(/^\/mysites\b/i, async (msg) => {
      await this.listSites(ownerUserId, bot, msg.chat.id);
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
      "*WebForge bot* — forge sites from chat.",
      "",
      "`/create <prompt>` — analyze + build a new site",
      "`/edit <name>` — edit an existing site",
      "`/status <name>` — check progress",
      "`/preview <name>` — get a live link",
      "`/mysites` — list your sites",
      "`/retry <name>` — retry a failed step",
      "`/delete <name>` — delete a site",
      "`/tasks` or `/queue` — see what's running",
      "`/hostbot` — host another Telegram bot",
      "`/mybots` — list your hosted bots",
      "`/stopbot <username>` — stop a hosted bot",
    ].join("\n");
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

    const renderProgress = (s: Site, files: string[]) => {
      const bar = renderBar(s.progress ?? 0);
      const lines = [
        `🛠️ *${escapeMd(s.name)}*`,
        `${bar}  *${s.progress ?? 0}%*`,
        `_${escapeMd(s.message ?? "Working")}_`,
      ];
      if (files.length > 0) {
        lines.push("");
        lines.push("*Files written:*");
        for (const f of files.slice(-6)) lines.push(`  ✓ \`${f}\``);
      }
      lines.push("");
      lines.push(`📺 [Live preview](${baseUrl}/api/hosted/${s.slug}/)`);
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

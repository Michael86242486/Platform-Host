import TelegramBot from "node-telegram-bot-api";
import { and, desc, eq } from "drizzle-orm";

import {
  db,
  jobsTable,
  sitesTable,
  telegramBotsTable,
  usersTable,
  type TelegramBot as DbBot,
} from "./db";
import { jobQueue } from "./queue";
import { logger } from "./logger";
import { inferSiteName, uniqueSlug } from "./slug";

interface ChatState {
  awaiting?:
    | { kind: "create" }
    | { kind: "edit"; siteId: string }
    | { kind: "host_token" }
    | { kind: "stop_bot" }
    | { kind: "delete_site" }
    | { kind: "preview_site" }
    | { kind: "retry_site" }
    | { kind: "status_site" };
}

class TelegramBotManager {
  private active = new Map<string, TelegramBot>();
  private state = new Map<string, ChatState>();

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

  private wireHandlers(
    ownerUserId: string,
    botId: string,
    bot: TelegramBot,
  ): void {
    const cmd = (re: RegExp) => bot.onText(re, async (msg) => {});

    bot.onText(/^\/(start|help)\b/i, async (msg) => {
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
          "✏️ Send me a description of the site you want to build.",
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
        await bot.sendMessage(
          msg.chat.id,
          "Which site? Send me its name or id.",
        );
      }
    });

    bot.onText(/^\/preview\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) {
        await this.sendPreview(ownerUserId, bot, msg.chat.id, arg);
      } else {
        this.setState(msg.chat.id, { awaiting: { kind: "preview_site" } });
        await bot.sendMessage(
          msg.chat.id,
          "Which site to preview? Send me its name or id.",
        );
      }
    });

    bot.onText(/^\/edit\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) {
        const site = await this.findSite(ownerUserId, arg);
        if (!site) {
          await bot.sendMessage(msg.chat.id, "❌ No site matched that.");
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
      if (arg) {
        await this.retrySite(ownerUserId, bot, msg.chat.id, arg);
      } else {
        this.setState(msg.chat.id, { awaiting: { kind: "retry_site" } });
        await bot.sendMessage(
          msg.chat.id,
          "Which site to retry? Send name or id.",
        );
      }
    });

    bot.onText(/^\/delete\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) {
        await this.deleteSite(ownerUserId, bot, msg.chat.id, arg);
      } else {
        this.setState(msg.chat.id, { awaiting: { kind: "delete_site" } });
        await bot.sendMessage(
          msg.chat.id,
          "Which site to delete? Send name or id.",
        );
      }
    });

    bot.onText(/^\/(tasks|queue)\b/i, async (msg) => {
      await this.listJobs(ownerUserId, bot, msg.chat.id);
    });

    bot.onText(/^\/hostbot\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) {
        await this.hostBot(ownerUserId, bot, msg.chat.id, arg);
      } else {
        this.setState(msg.chat.id, { awaiting: { kind: "host_token" } });
        await bot.sendMessage(
          msg.chat.id,
          "🤖 Send me a Telegram bot token from @BotFather to host it.",
        );
      }
    });

    bot.onText(/^\/mybots\b/i, async (msg) => {
      await this.listBots(ownerUserId, bot, msg.chat.id);
    });

    bot.onText(/^\/stopbot\b\s*(.*)$/i, async (msg, match) => {
      const arg = (match?.[1] ?? "").trim();
      if (arg) {
        await this.stopBotByArg(ownerUserId, bot, msg.chat.id, arg);
      } else {
        this.setState(msg.chat.id, { awaiting: { kind: "stop_bot" } });
        await bot.sendMessage(
          msg.chat.id,
          "Send me the bot username (without @) or id to stop.",
        );
      }
    });

    bot.on("message", async (msg) => {
      const text = msg.text?.trim();
      if (!text || text.startsWith("/")) return;
      const state = this.state.get(String(msg.chat.id));
      if (!state?.awaiting) return;
      this.clearState(msg.chat.id);

      switch (state.awaiting.kind) {
        case "create":
          await this.runCreate(ownerUserId, bot, msg.chat.id, text);
          return;
        case "edit":
          await this.runEdit(
            ownerUserId,
            bot,
            msg.chat.id,
            state.awaiting.siteId,
            text,
          );
          return;
        case "host_token":
          await this.hostBot(ownerUserId, bot, msg.chat.id, text);
          return;
        case "stop_bot":
          await this.stopBotByArg(ownerUserId, bot, msg.chat.id, text);
          return;
        case "delete_site":
          await this.deleteSite(ownerUserId, bot, msg.chat.id, text);
          return;
        case "preview_site":
          await this.sendPreview(ownerUserId, bot, msg.chat.id, text);
          return;
        case "retry_site":
          await this.retrySite(ownerUserId, bot, msg.chat.id, text);
          return;
        case "status_site":
          await this.sendStatus(ownerUserId, bot, msg.chat.id, text);
          return;
      }
    });

    void cmd; // keep linter quiet
  }

  // ---------- helpers ----------

  private setState(chatId: number | string, s: ChatState): void {
    this.state.set(String(chatId), s);
  }
  private clearState(chatId: number | string): void {
    this.state.delete(String(chatId));
  }

  private helpText(): string {
    return [
      "*WebForge bot* — forge sites from chat.",
      "",
      "`/create <prompt>` — build a new site",
      "`/edit <name>` — edit an existing site",
      "`/status <name>` — check progress",
      "`/preview <name>` — get a live link",
      "`/mysites` — list your sites",
      "`/retry <name>` — retry a failed build",
      "`/delete <name>` — delete a site",
      "`/tasks` or `/queue` — see what's running",
      "`/hostbot <token>` — host another bot here",
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
    const [job] = await db
      .insert(jobsTable)
      .values({
        userId,
        siteId: site.id,
        kind: "create",
        status: "queued",
        progress: 0,
        message: "Queued",
      })
      .returning();
    await jobQueue.enqueue(job.id);
    await bot.sendMessage(
      chatId,
      `🛠️ Forging *${site.name}*…\nLive link will be:\n${baseUrl}/api/hosted/${site.slug}`,
      { parse_mode: "Markdown" },
    );
    void this.pollAndNotify(bot, chatId, site.id);
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
    void this.pollAndNotify(bot, chatId, site.id);
  }

  private async pollAndNotify(
    bot: TelegramBot,
    chatId: number,
    siteId: string,
  ): Promise<void> {
    const baseUrl = publicBaseUrl();
    for (let i = 0; i < 60; i++) {
      await sleep(1500);
      const [s] = await db
        .select()
        .from(sitesTable)
        .where(eq(sitesTable.id, siteId))
        .limit(1);
      if (!s) return;
      if (s.status === "ready") {
        await bot.sendMessage(
          chatId,
          `✅ *${s.name}* is live\n${baseUrl}/api/hosted/${s.slug}`,
          { parse_mode: "Markdown" },
        );
        return;
      }
      if (s.status === "failed") {
        await bot.sendMessage(
          chatId,
          `❌ Build failed: ${s.error ?? "unknown"}`,
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
            : s.status === "generating"
              ? "🛠️"
              : "⏳";
      return `${emoji} *${s.name}* — ${s.status}\n${baseUrl}/api/hosted/${s.slug}`;
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
    await bot.sendMessage(
      chatId,
      `🔗 ${baseUrl}/api/hosted/${site.slug}`,
    );
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
    const [job] = await db
      .insert(jobsTable)
      .values({
        userId,
        siteId: site.id,
        kind: "retry",
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
    void this.pollAndNotify(bot, chatId, site.id);
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

  private async hostBot(
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
      return;
    }
    const preview = `${token.slice(0, 6)}…${token.slice(-4)}`;
    const [record] = await db
      .insert(telegramBotsTable)
      .values({
        userId,
        token,
        tokenPreview: preview,
        status: "active",
      })
      .returning();
    try {
      const started = await this.startBot(record);
      const me = await started.getMe();
      await bot.sendMessage(
        chatId,
        `✅ Hosting @${me.username}. Try /create over there.`,
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

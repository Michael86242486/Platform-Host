import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth } from "../middlewares/auth";
import { db, telegramBotsTable, type TelegramBot } from "../lib/db";
import { telegramBots } from "../lib/telegram";

const router: IRouter = Router();

const hostSchema = z.object({
  token: z
    .string()
    .min(20)
    .max(200)
    .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "Invalid bot token format"),
});

function botToDto(bot: TelegramBot) {
  return {
    id: bot.id,
    username: bot.username,
    displayName: bot.displayName,
    status: bot.status,
    lastError: bot.lastError,
    tokenPreview: bot.tokenPreview,
    createdAt: bot.createdAt.toISOString(),
  };
}

router.get("/bots", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(telegramBotsTable)
    .where(eq(telegramBotsTable.userId, req.user!.id))
    .orderBy(desc(telegramBotsTable.createdAt));
  res.json(rows.map(botToDto));
});

router.post("/bots", requireAuth, async (req, res) => {
  const parsed = hostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    return;
  }
  const token = parsed.data.token;
  const preview = `${token.slice(0, 6)}…${token.slice(-4)}`;
  const [record] = await db
    .insert(telegramBotsTable)
    .values({
      userId: req.user!.id,
      token,
      tokenPreview: preview,
      status: "active",
    })
    .returning();
  try {
    const bot = await telegramBots.startBot(record);
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
    const [updated] = await db
      .select()
      .from(telegramBotsTable)
      .where(eq(telegramBotsTable.id, record.id))
      .limit(1);
    res.status(201).json(botToDto(updated));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    await db
      .update(telegramBotsTable)
      .set({ status: "error", lastError: msg, updatedAt: new Date() })
      .where(eq(telegramBotsTable.id, record.id));
    const [updated] = await db
      .select()
      .from(telegramBotsTable)
      .where(eq(telegramBotsTable.id, record.id))
      .limit(1);
    res.status(201).json(botToDto(updated));
  }
});

router.delete("/bots/:id", requireAuth, async (req, res) => {
  const [record] = await db
    .select()
    .from(telegramBotsTable)
    .where(
      and(
        eq(telegramBotsTable.id, String(req.params.id)),
        eq(telegramBotsTable.userId, req.user!.id),
      ),
    )
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await telegramBots.stopBot(record.id);
  await db
    .delete(telegramBotsTable)
    .where(eq(telegramBotsTable.id, record.id));
  res.status(204).send();
});

export default router;

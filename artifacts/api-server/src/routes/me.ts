import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

import { requireAuth } from "../middlewares/auth";
import { db, usersTable } from "../lib/db";

const router: IRouter = Router();

router.get("/me", requireAuth, (req, res) => {
  const u = req.user!;
  res.json({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    profileImageUrl: u.profileImageUrl,
    telegramChatId: u.telegramChatId ?? null,
    createdAt: new Date().toISOString(),
  });
});

const updateMeSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  profileImageUrl: z.string().url().optional().nullable(),
});

router.patch("/me", requireAuth, async (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }

  const { firstName, lastName, profileImageUrl } = parsed.data;
  const setValues: Partial<{
    firstName: string;
    lastName: string;
    profileImageUrl: string | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (firstName !== undefined) setValues.firstName = firstName;
  if (lastName !== undefined) setValues.lastName = lastName;
  if (profileImageUrl !== undefined) setValues.profileImageUrl = profileImageUrl;

  try {
    await db.update(usersTable).set(setValues).where(eq(usersTable.id, req.user!.id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "update_failed" });
  }
});

// ── Telegram link code ────────────────────────────────────────────────────────

router.post("/me/telegram-link-code", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  // Generate a 8-char uppercase alphanumeric code
  const code = crypto.randomBytes(6).toString("base64url").toUpperCase().slice(0, 8).replace(/[^A-Z0-9]/g, "X").slice(0, 8);
  try {
    await db.update(usersTable).set({ telegramLinkCode: code, updatedAt: new Date() }).where(eq(usersTable.id, userId));
    res.json({ code });
  } catch {
    res.status(500).json({ error: "link_code_failed" });
  }
});

router.get("/me/telegram-status", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const [user] = await db.select({ telegramChatId: usersTable.telegramChatId, telegramLinkCode: usersTable.telegramLinkCode }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "not_found" }); return; }
  res.json({
    linked: !!user.telegramChatId,
    chatId: user.telegramChatId ?? null,
    pendingCode: user.telegramLinkCode ?? null,
  });
});

router.delete("/me/telegram-link", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    await db.update(usersTable).set({ telegramChatId: null, telegramLinkCode: null, updatedAt: new Date() }).where(eq(usersTable.id, userId));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "unlink_failed" });
  }
});

export default router;

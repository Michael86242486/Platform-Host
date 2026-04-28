import { randomBytes } from "node:crypto";

import { Router } from "express";
import { eq } from "drizzle-orm";

import { db, sessionsTable, usersTable } from "../lib/db";
import { logger } from "../lib/logger";

const router = Router();

const SESSION_TTL_DAYS = 60;

function ttl(): Date {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_TTL_DAYS);
  return d;
}

function newToken(): string {
  return `wf_${randomBytes(32).toString("base64url")}`;
}

function nameFromEmail(email: string): { firstName: string; lastName: string } {
  const handle = email.split("@")[0] ?? email;
  const parts = handle.split(/[._-]+/).filter(Boolean);
  const cap = (s: string) =>
    s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
  return {
    firstName: cap(parts[0] ?? "Forge"),
    lastName: cap(parts[1] ?? "User"),
  };
}

/**
 * Magic email sign-in (passwordless).
 *
 * No external email provider is required. The mobile app sends the user's
 * email; we find or create the user and immediately mint a session token.
 * If you later wire up an email provider you can layer in real link
 * verification — the response shape stays the same.
 *
 * POST /api/auth/email-link  { email }  → { token, user }
 */
router.post("/auth/email-link", async (req, res) => {
  const raw = (req.body?.email ?? "").toString().trim().toLowerCase();
  if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }

  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, raw))
    .limit(1);

  if (!user) {
    const { firstName, lastName } = nameFromEmail(raw);
    const [created] = await db
      .insert(usersTable)
      .values({
        clerkUserId: `magic_${randomBytes(8).toString("hex")}`,
        email: raw,
        firstName,
        lastName,
        imageUrl: null,
      })
      .returning();
    user = created;
    logger.info({ userId: user.id, email: raw }, "magic-link: created user");
  }

  const token = newToken();
  await db.insert(sessionsTable).values({
    userId: user.id,
    token,
    expiresAt: ttl(),
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
    },
  });
});

/**
 * Validate a session token and return the current user.
 * GET /api/auth/me  (Authorization: Bearer <token>)
 */
router.get("/auth/me", async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.token, token))
    .limit(1);
  if (!session || session.expiresAt < new Date()) {
    res.status(401).json({ error: "expired" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "no_user" });
    return;
  }
  res.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
    },
  });
});

/**
 * POST /api/auth/sign-out — invalidate the current token.
 */
router.post("/auth/sign-out", async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
  }
  res.json({ ok: true });
});

export default router;

import {
  clerkMiddleware,
  getAuth,
  type ClerkMiddlewareOptions,
} from "@clerk/express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";

import { db, sessionsTable, usersTable, type User } from "../lib/db";
import { logger } from "../lib/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const clerkOptions: ClerkMiddlewareOptions = {
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey:
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.VITE_CLERK_PUBLISHABLE_KEY,
};

const realClerk: RequestHandler | null = (() => {
  if (!process.env.CLERK_SECRET_KEY) return null;
  try {
    return clerkMiddleware(clerkOptions);
  } catch (err) {
    logger.warn({ err }, "Failed to initialize Clerk middleware");
    return null;
  }
})();

/**
 * If CLERK_SECRET_KEY is missing we still want unauthenticated, public
 * routes (the home page, /api/hosted/*, the Telegram webhook, etc.) to
 * work — only the routes wrapped in `requireAuth` should reject.
 * The real Clerk middleware throws synchronously when the secret is
 * missing, so we short-circuit here.
 */
export const clerk: RequestHandler = (req, res, next) => {
  if (!realClerk) {
    next();
    return;
  }
  realClerk(req, res, next);
};

/**
 * Verify Clerk auth and ensure a local `users` row exists for this clerkUserId.
 * On success, attaches `req.user` (our local User row).
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // 1) Magic-link / session-token auth (Authorization: Bearer wf_...)
  //    This works without any external auth provider configured, so the
  //    mobile app's "generate" button works out of the box.
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (bearer && bearer.startsWith("wf_")) {
    try {
      const [session] = await db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.token, bearer))
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
      req.user = user;
      next();
      return;
    } catch (err) {
      logger.error({ err }, "Bearer auth failed");
      res.status(500).json({ error: "auth_error" });
      return;
    }
  }

  // 2) Clerk auth — only if a secret key is configured.
  if (!realClerk) {
    res.status(401).json({
      error: "auth_not_configured",
      message:
        "Send a Bearer token from POST /api/auth/email-link, or set CLERK_SECRET_KEY.",
    });
    return;
  }
  try {
    const { userId, sessionClaims } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, userId))
      .limit(1);

    if (!user) {
      const claims = sessionClaims as Record<string, unknown> | undefined;
      const email =
        (claims?.email as string | undefined) ??
        (claims?.primary_email_address as string | undefined) ??
        null;
      const firstName = (claims?.first_name as string | undefined) ?? null;
      const lastName = (claims?.last_name as string | undefined) ?? null;
      const imageUrl = (claims?.image_url as string | undefined) ?? null;

      const inserted = await db
        .insert(usersTable)
        .values({
          clerkUserId: userId,
          email,
          firstName,
          lastName,
          imageUrl,
        })
        .returning();
      user = inserted[0];
    }

    req.user = user;
    next();
  } catch (err) {
    logger.error({ err }, "requireAuth failed");
    res.status(500).json({ error: "auth_error" });
  }
};

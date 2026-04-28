import {
  clerkMiddleware,
  getAuth,
  type ClerkMiddlewareOptions,
} from "@clerk/express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";

import { db, usersTable, type User } from "../lib/db";
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
  if (!realClerk) {
    res.status(401).json({
      error: "auth_not_configured",
      message:
        "CLERK_SECRET_KEY is not set on the server. The Telegram bot still works.",
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

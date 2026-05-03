import app from "./app";
import { logger } from "./lib/logger";
import { jobQueue } from "./lib/queue";
import { telegramBots } from "./lib/telegram";
import crypto from "node:crypto";
import { db, sitesTable } from "./lib/db";
import { eq, isNull } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Backfill share tokens for existing sites that don't have one.
  void (async () => {
    try {
      const sites = await db
        .select({ id: sitesTable.id })
        .from(sitesTable)
        .where(isNull(sitesTable.shareToken));
      for (const site of sites) {
        try {
          await db
            .update(sitesTable)
            .set({ shareToken: crypto.randomBytes(8).toString("base64url") })
            .where(eq(sitesTable.id, site.id));
        } catch {
          /* skip if collision */
        }
      }
      if (sites.length > 0) {
        logger.info({ count: sites.length }, "Share tokens backfilled");
      }
    } catch (e: unknown) {
      logger.warn({ err: e }, "Failed to backfill share tokens");
    }
  })();

  // Resume any jobs that were queued or running before this restart.
  jobQueue.resumeOrphans().catch((e) => {
    logger.error({ err: e }, "Failed to resume orphan jobs");
  });

  // Resume hosted Telegram bots.
  telegramBots.startAll().catch((e) => {
    logger.error({ err: e }, "Failed to start Telegram bots");
  });
});

import app from "./app";
import { logger } from "./lib/logger";
import { jobQueue } from "./lib/queue";
import { telegramBots } from "./lib/telegram";

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

  // Resume any jobs that were queued or running before this restart.
  jobQueue.resumeOrphans().catch((e) => {
    logger.error({ err: e }, "Failed to resume orphan jobs");
  });

  // Resume hosted Telegram bots.
  telegramBots.startAll().catch((e) => {
    logger.error({ err: e }, "Failed to start Telegram bots");
  });
});

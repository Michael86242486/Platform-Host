import { Router, type IRouter, raw } from "express";

import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { db, sitesTable, messagesTable, jobsTable } from "../lib/db";
import { jobQueue } from "../lib/queue";
import { inferSiteName, uniqueSlug } from "../lib/slug";
import { siteToDto } from "./sites";

/** Sentinel used by the job queue to skip the confirmation step. */
const AUTO_BUILD_SENTINEL = "__AUTO_BUILD__";

const router: IRouter = Router();

/**
 * POST /api/voice/transcribe
 * Speech-to-text is powered by OpenAI Whisper which is not available when
 * running on Puter Codex. Returns a clear error so clients can fall back to
 * typed input.
 */
router.post(
  "/voice/transcribe",
  requireAuth,
  raw({ type: ["audio/*", "application/octet-stream", "*/*"], limit: "25mb" }),
  (_req, res) => {
    res.status(503).json({
      error: "stt_unavailable",
      message:
        "Voice transcription is not available in Puter Codex mode. Please type your message instead.",
    });
  },
);

/**
 * POST /api/voice/build
 * Same as /transcribe — STT unavailable without OpenAI Whisper.
 * The client should fall back to a typed prompt.
 */
router.post(
  "/voice/build",
  requireAuth,
  raw({ type: ["audio/*", "application/octet-stream", "*/*"], limit: "25mb" }),
  (_req, res) => {
    res.status(503).json({
      error: "stt_unavailable",
      message:
        "Voice input is not available in Puter Codex mode. Please type your message instead.",
    });
  },
);

void logger;
void db;
void sitesTable;
void messagesTable;
void jobsTable;
void jobQueue;
void inferSiteName;
void uniqueSlug;
void siteToDto;
void AUTO_BUILD_SENTINEL;

export default router;

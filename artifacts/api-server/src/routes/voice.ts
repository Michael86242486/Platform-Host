import { Router, type IRouter, raw } from "express";

import {
  speechToText,
  detectAudioFormat,
  ensureCompatibleFormat,
} from "@workspace/integrations-openai-ai-server/audio";

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
 * Body: raw audio bytes (Content-Type: audio/* | application/octet-stream)
 * Response: { text: string, detectedFormat: string }
 *
 * Auto-detects the format from magic bytes so the client doesn't need to
 * send the right Content-Type header. Falls back to WebM if detection fails.
 */
router.post(
  "/voice/transcribe",
  requireAuth,
  raw({ type: ["audio/*", "application/octet-stream", "*/*"], limit: "25mb" }),
  async (req, res) => {
    const buf = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: "missing_audio", message: "Request body must contain audio bytes." });
      return;
    }
    if (buf.length < 100) {
      res.status(400).json({ error: "audio_too_short", message: "Audio clip is too short to transcribe." });
      return;
    }

    // Auto-detect format from magic bytes; fall back to Content-Type header.
    const detected = detectAudioFormat(buf);
    let format: "wav" | "mp3" | "webm" = "webm";
    if (detected === "wav" || detected === "mp3" || detected === "webm") {
      format = detected;
    } else if (detected === "ogg") {
      format = "webm"; // Whisper accepts OGG as webm
    } else {
      // Try Content-Type hint
      const ct = String(req.headers["content-type"] ?? "");
      if (ct.includes("wav")) format = "wav";
      else if (ct.includes("mp3") || ct.includes("mpeg")) format = "mp3";
    }

    try {
      // For exotic formats (mp4, ogg, unknown), convert to WAV first.
      let audioBuffer = buf;
      if (detected === "mp4" || detected === "unknown") {
        const converted = await ensureCompatibleFormat(buf);
        audioBuffer = converted.buffer;
        format = converted.format;
      }

      const text = await speechToText(audioBuffer, format);
      if (!text.trim()) {
        res.status(422).json({
          error: "no_speech_detected",
          message: "No speech was detected in the audio. Try recording again in a quieter environment.",
        });
        return;
      }
      res.json({ text: text.trim(), detectedFormat: detected });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err: errMsg, format, detected }, "voice transcription failed");
      const isQuota = /quota|budget|spend|tier/i.test(errMsg);
      res.status(500).json({
        error: "transcription_failed",
        message: isQuota
          ? "AI transcription service is temporarily unavailable (quota). Try again shortly or type your message."
          : `Transcription failed: ${errMsg.slice(0, 200)}`,
      });
    }
  },
);

/**
 * POST /api/voice/build
 * Body: raw audio bytes
 * Response: { text: string, site: SiteDto }
 *
 * Transcribes the audio and immediately queues a site build. One-tap voice
 * to live website — the client doesn't need a separate /api/sites POST.
 */
router.post(
  "/voice/build",
  requireAuth,
  raw({ type: ["audio/*", "application/octet-stream", "*/*"], limit: "25mb" }),
  async (req, res) => {
    const buf = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: "missing_audio" });
      return;
    }

    // @ts-expect-error — userId injected by requireAuth middleware
    const userId: string = req.userId;
    const detected = detectAudioFormat(buf);
    let format: "wav" | "mp3" | "webm" = "webm";
    if (detected === "wav" || detected === "mp3" || detected === "webm") format = detected;
    else if (detected === "ogg") format = "webm";

    let audioBuffer = buf;
    if (detected === "mp4" || detected === "unknown") {
      const c = await ensureCompatibleFormat(buf).catch(() => null);
      if (c) { audioBuffer = c.buffer; format = c.format; }
    }

    let transcript: string;
    try {
      transcript = (await speechToText(audioBuffer, format)).trim();
    } catch (err) {
      logger.error({ err: String(err) }, "voice/build transcription failed");
      res.status(500).json({ error: "transcription_failed", message: String(err) });
      return;
    }

    if (!transcript) {
      res.status(422).json({ error: "no_speech_detected" });
      return;
    }

    // Queue the build
    try {
      const name = inferSiteName(transcript);
      const slug = await uniqueSlug(name);
      const [site] = await db
        .insert(sitesTable)
        .values({ userId, name, slug, prompt: transcript, status: "queued" })
        .returning();
      await db.insert(messagesTable).values({
        userId,
        siteId: site.id,
        role: "user",
        kind: "text",
        content: transcript,
      });
      const [job] = await db
        .insert(jobsTable)
        .values({
          userId,
          siteId: site.id,
          kind: "analyze",
          instructions: AUTO_BUILD_SENTINEL,
          status: "queued",
          progress: 0,
          message: "Queued",
        })
        .returning();
      await jobQueue.enqueue(job.id);

      res.status(201).json({ text: transcript, site: siteToDto(site) });
    } catch (err) {
      logger.error({ err: String(err) }, "voice/build site creation failed");
      res.status(500).json({ error: "site_creation_failed", message: String(err) });
    }
  },
);

export default router;

import { Router, type IRouter, raw } from "express";

import { speechToText } from "@workspace/integrations-openai-ai-server/audio";

import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * POST /api/voice/transcribe
 * Body: raw audio bytes (Content-Type: audio/webm | audio/wav | audio/mp3)
 * Response: { text: string }
 */
router.post(
  "/voice/transcribe",
  requireAuth,
  raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }),
  async (req, res) => {
    const buf = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: "missing_audio" });
      return;
    }
    const ct = String(req.headers["content-type"] ?? "audio/webm");
    const format: "wav" | "mp3" | "webm" = ct.includes("wav")
      ? "wav"
      : ct.includes("mp3") || ct.includes("mpeg")
        ? "mp3"
        : "webm";
    try {
      const text = await speechToText(buf, format);
      res.json({ text });
    } catch (err) {
      logger.error({ err: String(err) }, "voice transcription failed");
      res
        .status(500)
        .json({ error: "transcription_failed", message: String(err) });
    }
  },
);

export default router;

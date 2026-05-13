import { Router, type IRouter } from "express";
import { aiStream, aiComplete } from "../lib/ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/ai/chat", async (req, res) => {
  const { messages, model, stream = true } = req.body as {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    stream?: boolean;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  if (stream === false) {
    try {
      const text = await aiComplete(messages, { model });
      res.json({ choices: [{ message: { role: "assistant", content: text } }] });
    } catch (err) {
      logger.warn({ err: String(err) }, "ai/chat non-stream error");
      res.status(500).json({ error: err instanceof Error ? err.message : "AI error" });
    }
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const keepalive = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* noop */ }
  }, 15_000);

  try {
    await aiStream(
      messages,
      (chunk) => {
        const payload = JSON.stringify({
          choices: [{ delta: { content: chunk }, finish_reason: null }],
        });
        res.write(`data: ${payload}\n\n`);
      },
      { model },
    );
    res.write("data: [DONE]\n\n");
  } catch (err) {
    logger.warn({ err: String(err) }, "ai/chat stream error");
    const errPayload = JSON.stringify({ error: err instanceof Error ? err.message : "AI error" });
    try { res.write(`data: ${errPayload}\n\n`); } catch { /* noop */ }
  } finally {
    clearInterval(keepalive);
    res.end();
  }
});

export default router;

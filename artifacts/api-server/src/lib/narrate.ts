import crypto from "node:crypto";

import { db, messagesTable } from "./db";
import { siteEventBus } from "./eventBus";
import { logger } from "./logger";
import { aiStream, FAST_MODEL, type AIMessage as PuterAIMessage } from "./ai";
const puterAIStream = aiStream;

type NarrateInput = {
  userId: string;
  siteId: string;
  intent: "thinking" | "planning" | "building" | "polishing" | "done";
  context: string;
  fallback?: string;
};

const SYSTEM_PROMPT = `You are OpenClaw, the autonomous orchestration engine of WebForge AI — narrating your build out loud to the user, like Linear's agent or v0. Speak in first person, present tense. Sound sharp, focused, and a little cinematic — like a senior engineer who enjoys their work.

Hard rules:
- 1 short paragraph (max 3 sentences, ~40 words)
- No bullet points, no headings, no markdown
- Mention concrete decisions the user can visualize (palette choice, layout approach, a specific feature)
- Never apologize, never hedge, never repeat the user's request verbatim
- End with a short forward-looking phrase that signals momentum (e.g. "Wiring it together now…")`;

const SHORT_TIMEOUT_MS = 7000;

/**
 * Stream a short "agent thought" out loud, persisting it to messagesTable
 * and broadcasting deltas over the SSE event bus so the UI can render
 * tokens as they arrive (like Replit Agent / Lovable / v0).
 *
 * On AI failure, falls back to a static line so the UX never stalls.
 */
export async function streamNarration(input: NarrateInput): Promise<string> {
  const narrationId = `nar_${crypto.randomBytes(6).toString("hex")}`;
  const userPrompt = `Phase: ${input.intent}\nContext: ${input.context}`;

  let buffer = "";

  siteEventBus.emitSite({
    type: "narration_start",
    siteId: input.siteId,
    narrationId,
    title: input.intent,
  });

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), SHORT_TIMEOUT_MS);

  try {
    const messages: PuterAIMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    await puterAIStream(
      messages,
      (delta) => {
        if (ctrl.signal.aborted) return;
        buffer += delta;
        siteEventBus.emitSite({
          type: "narration_delta",
          siteId: input.siteId,
          narrationId,
          delta,
        });
      },
      { model: FAST_MODEL },
    );
  } catch (err) {
    logger.warn({ err, siteId: input.siteId }, "narration stream failed");
  } finally {
    clearTimeout(timeout);
  }

  if (!buffer.trim()) {
    buffer = input.fallback ?? defaultLine(input.intent);
    siteEventBus.emitSite({
      type: "narration_delta",
      siteId: input.siteId,
      narrationId,
      delta: buffer,
    });
  }

  try {
    const [row] = await db
      .insert(messagesTable)
      .values({
        userId: input.userId,
        siteId: input.siteId,
        role: "agent",
        kind: "text",
        content: buffer.trim(),
        data: { narrationId, intent: input.intent, streamed: true },
      })
      .returning();
    siteEventBus.emitSite({
      type: "narration_end",
      siteId: input.siteId,
      narrationId,
      text: buffer.trim(),
    });
    siteEventBus.emitSite({
      type: "message_added",
      siteId: input.siteId,
      messageId: row.id,
    });
  } catch (err) {
    logger.warn({ err }, "failed to persist narration");
  }

  return buffer.trim();
}

function defaultLine(intent: NarrateInput["intent"]): string {
  switch (intent) {
    case "thinking":
      return "OpenClaw reading the brief — pulling out the structure, vibe, and a palette that fits.";
    case "planning":
      return "OpenClaw has a clear picture. Locking in the architecture and color story now.";
    case "building":
      return "OpenClaw generating all pages in parallel — shared CSS first, then every section simultaneously.";
    case "polishing":
      return "OpenClaw tightening typography, rhythm, and responsive breakpoints. Almost done.";
    case "done":
    default:
      return "OpenClaw done. Tap Preview to see your site live.";
  }
}

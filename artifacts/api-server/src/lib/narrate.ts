import crypto from "node:crypto";

import { db, messagesTable } from "./db";
import { siteEventBus } from "./eventBus";
import { logger } from "./logger";
import { puterAIStream, type PuterAIMessage } from "./puter";

type NarrateInput = {
  userId: string;
  siteId: string;
  intent: "thinking" | "planning" | "building" | "polishing" | "done";
  context: string;
  fallback?: string;
};

const SYSTEM_PROMPT = `You are WebForge, a senior product designer + engineer narrating your build out loud
to the user, like Linear's agent or v0. Speak in first person, present tense, sound
energetic, focused, and a little playful — like a craftsman thinking aloud.

Hard rules:
- 1 short paragraph (max 3 sentences, ~40 words)
- No bullet points, no headings, no markdown
- Mention concrete design choices the user can visualize (palette, layout, hero copy idea)
- Never apologize, never hedge, never repeat the user's request verbatim
- End with a short forward-looking phrase (e.g. "Stitching it together now…")`;

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
      { model: "gpt-4o-mini" },
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
      return "Got it — sketching the structure in my head, then I'll lay it out for you.";
    case "planning":
      return "I have a clear picture. Locking in the layout and palette now.";
    case "building":
      return "Painting the pixels — hero, sections, and a tight color story.";
    case "polishing":
      return "Tightening the typography and rhythm. Almost there.";
    case "done":
    default:
      return "Done. Tap Preview to see it live.";
  }
}

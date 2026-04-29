import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSiteQueryKey,
  getListSiteMessagesQueryKey,
} from "@workspace/api-client-react";

import { useAuth } from "@/lib/auth";

const apiBase =
  (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "") || "";

export type LiveNarration = {
  id: string;
  text: string;
  done: boolean;
  startedAt: number;
};

/**
 * Subscribe to live agent activity for a single site via Server-Sent Events.
 *
 * - Invalidates the React Query caches for site + messages on every server
 *   event so the UI is always fresh without polling.
 * - Maintains an in-flight `narration` map so the chat can render token-by-
 *   token "thinking out loud" bubbles before they're persisted to the DB.
 *
 * Web-only — on native we keep the polling fallback already in <CreateScreen/>.
 */
export function useSiteStream(siteId: string | null): {
  connected: boolean;
  narrations: LiveNarration[];
  currentFile: string | null;
} {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const [connected, setConnected] = useState(false);
  const [narrations, setNarrations] = useState<LiveNarration[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!siteId) return;
    if (Platform.OS !== "web") return;
    if (typeof EventSource === "undefined") return;

    let cancelled = false;
    let es: EventSource | null = null;

    void (async () => {
      const token = await getToken();
      if (cancelled || !token) return;
      const url = `${apiBase}/api/sites/${siteId}/events?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("hello", () => setConnected(true));
      es.addEventListener("error", () => setConnected(false));

      const invalidateSite = () =>
        qc.invalidateQueries({ queryKey: getGetSiteQueryKey(siteId) });
      const invalidateMessages = () =>
        qc.invalidateQueries({
          queryKey: getListSiteMessagesQueryKey(siteId),
        });

      es.addEventListener("site_updated", () => {
        invalidateSite();
      });
      es.addEventListener("message_added", () => {
        invalidateMessages();
        invalidateSite();
      });
      es.addEventListener("file_progress", (raw) => {
        try {
          const d = JSON.parse((raw as MessageEvent).data) as {
            currentFile: string | null;
          };
          setCurrentFile(d.currentFile);
        } catch {
          // ignore
        }
      });

      es.addEventListener("narration_start", (raw) => {
        try {
          const d = JSON.parse((raw as MessageEvent).data) as {
            narrationId: string;
          };
          setNarrations((prev) => [
            ...prev.filter((n) => n.id !== d.narrationId),
            { id: d.narrationId, text: "", done: false, startedAt: Date.now() },
          ]);
        } catch {
          // ignore
        }
      });
      es.addEventListener("narration_delta", (raw) => {
        try {
          const d = JSON.parse((raw as MessageEvent).data) as {
            narrationId: string;
            delta: string;
          };
          setNarrations((prev) =>
            prev.map((n) =>
              n.id === d.narrationId ? { ...n, text: n.text + d.delta } : n,
            ),
          );
        } catch {
          // ignore
        }
      });
      es.addEventListener("narration_end", (raw) => {
        try {
          const d = JSON.parse((raw as MessageEvent).data) as {
            narrationId: string;
            text: string;
          };
          // Mark as done so the UI fades it out and the persisted message
          // (which arrived via message_added) takes over.
          setNarrations((prev) =>
            prev.map((n) =>
              n.id === d.narrationId
                ? { ...n, text: d.text, done: true }
                : n,
            ),
          );
          // Sweep finished narrations after a short grace period.
          setTimeout(() => {
            setNarrations((prev) => prev.filter((n) => n.id !== d.narrationId));
          }, 350);
        } catch {
          // ignore
        }
      });
    })();

    return () => {
      cancelled = true;
      try {
        es?.close();
      } catch {
        // ignore
      }
      esRef.current = null;
      setConnected(false);
      setNarrations([]);
      setCurrentFile(null);
    };
  }, [siteId, qc, getToken]);

  return { connected, narrations, currentFile };
}

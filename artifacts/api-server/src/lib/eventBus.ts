import { EventEmitter } from "node:events";

export type SiteEvent =
  | { type: "site_updated"; siteId: string }
  | { type: "message_added"; siteId: string; messageId: string }
  | {
      type: "narration_start";
      siteId: string;
      narrationId: string;
      title?: string;
    }
  | {
      type: "narration_delta";
      siteId: string;
      narrationId: string;
      delta: string;
    }
  | {
      type: "narration_end";
      siteId: string;
      narrationId: string;
      text: string;
    }
  | {
      type: "file_progress";
      siteId: string;
      currentFile: string | null;
      bytes: number;
    };

class SiteEventBus extends EventEmitter {
  emitSite(ev: SiteEvent): void {
    this.emit(`site:${ev.siteId}`, ev);
    this.emit("site:*", ev);
  }
  subscribe(siteId: string, handler: (ev: SiteEvent) => void): () => void {
    const channel = `site:${siteId}`;
    this.on(channel, handler);
    return () => this.off(channel, handler);
  }
}

export const siteEventBus = new SiteEventBus();
siteEventBus.setMaxListeners(200);

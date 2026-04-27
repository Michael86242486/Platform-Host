import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { sitesTable } from "./sites";
import { usersTable } from "./users";

/**
 * Chat messages exchanged between the user and the WebForge agent inside
 * a single site. The mobile app reads these to render the chat tab.
 */
export const messagesTable = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "agent", "system"] }).notNull(),
    /** Visual category that the mobile UI uses to render the bubble. */
    kind: text("kind", {
      enum: [
        "text",
        "analysis",
        "plan",
        "awaiting_confirmation",
        "log",
        "build_started",
        "build_progress",
        "build_done",
        "build_failed",
      ],
    })
      .notNull()
      .default("text"),
    content: text("content").notNull(),
    /** Optional structured payload (plan JSON, log details, etc). */
    data: jsonb("data").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("messages_site_id_idx").on(t.siteId, t.createdAt),
  ],
);

export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = typeof messagesTable.$inferInsert;

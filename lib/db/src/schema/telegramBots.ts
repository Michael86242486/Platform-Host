import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

export const telegramBotsTable = pgTable(
  "telegram_bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    tokenPreview: text("token_preview").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    status: text("status", { enum: ["active", "stopped", "error"] })
      .notNull()
      .default("active"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("telegram_bots_user_id_idx").on(t.userId)],
);

export type TelegramBot = typeof telegramBotsTable.$inferSelect;
export type InsertTelegramBot = typeof telegramBotsTable.$inferInsert;

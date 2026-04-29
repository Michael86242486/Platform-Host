import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Per-user secrets (API keys, tokens, etc.) that the user adds via the
 * Telegram bot's `/setsecret NAME=value` command or the mobile app.
 *
 * `value` is stored already-encrypted (AES-256-GCM). The encryption /
 * decryption helper lives in `artifacts/api-server/src/lib/secrets.ts`.
 *
 * Names are uppercase identifiers (`/^[A-Z][A-Z0-9_]*$/`) and are unique
 * per user. The (userId, name) pair is the natural lookup key.
 */
export const secretsTable = pgTable(
  "secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Ciphertext with embedded iv + authTag, encoded as a single string. */
    value: text("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byUserName: uniqueIndex("secrets_user_name_idx").on(t.userId, t.name),
  }),
);

export type Secret = typeof secretsTable.$inferSelect;
export type InsertSecret = typeof secretsTable.$inferInsert;

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const otpsTable = pgTable("otps", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull(),
  code: text("code").notNull(),
  userId: text("user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Otp = typeof otpsTable.$inferSelect;
export type InsertOtp = typeof otpsTable.$inferInsert;

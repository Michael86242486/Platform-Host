import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * OpenClaw Memory — stores what the AI has learned about each user's
 * design taste, preferred stack, and style across all their builds.
 * This profile is injected into every future build to make WebForge
 * smarter and more personalized with every site created.
 */
export interface UserAIProfile {
  designTaste: string;          // e.g. "dark & technical"
  favoriteStack: string[];      // e.g. ["Alpine.js", "Chart.js", "GSAP"]
  preferredSiteTypes: string[]; // e.g. ["saas", "portfolio"]
  styleKeywords: string[];      // e.g. ["minimal", "dark", "neon"]
  colorPreferences: string[];   // e.g. ["#00FFC2", "#0A0E14"]
  totalBuilds: number;
  avgScore: number;             // rolling average of DeliveryScore.overall
  memory: string;               // 1-sentence AI memory note for future prompts
  lastUpdated: string;          // ISO timestamp
}

export const userProfilesTable = pgTable("user_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  profile: jsonb("profile").$type<UserAIProfile>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserProfile = typeof userProfilesTable.$inferSelect;
export type InsertUserProfile = typeof userProfilesTable.$inferInsert;

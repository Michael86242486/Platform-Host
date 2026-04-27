import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { sitesTable } from "./sites";
import { usersTable } from "./users";

export const jobsTable = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["analyze", "create", "edit", "retry"],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "done", "failed"],
    })
      .notNull()
      .default("queued"),
    progress: integer("progress").notNull().default(0),
    message: text("message"),
    instructions: text("instructions"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_user_id_idx").on(t.userId),
    index("jobs_site_id_idx").on(t.siteId),
    index("jobs_status_idx").on(t.status),
  ],
);

export type Job = typeof jobsTable.$inferSelect;
export type InsertJob = typeof jobsTable.$inferInsert;

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { usersTable } from "./users";

export interface SiteAnalysis {
  type: "website" | "bot" | "backend" | "tool";
  intent: string;
  audience: string | null;
  features: string[];
  pages: string[];
  styleHints: string[];
}

export interface SitePlanPage {
  path: string;
  title: string;
  purpose: string;
  sections: string[];
}

export interface SitePlan {
  type: SiteAnalysis["type"];
  summary: string;
  pages: SitePlanPage[];
  styles: { palette: string; mood: string };
  features: string[];
  notes: string[];
}

/** Map of relative file path -> file content (text). */
export type SiteFiles = Record<string, string>;

export const sitesTable = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    prompt: text("prompt").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "analyzing",
        "awaiting_confirmation",
        "building",
        "ready",
        "failed",
      ],
    })
      .notNull()
      .default("queued"),
    progress: integer("progress").notNull().default(0),
    message: text("message"),
    error: text("error"),
    coverColor: text("cover_color"),
    /** Structured project analysis (set in the analyze phase). */
    analysis: jsonb("analysis").$type<SiteAnalysis | null>(),
    /** Build plan returned to the user before construction starts. */
    plan: jsonb("plan").$type<SitePlan | null>(),
    /** Map of file path -> file content. Replaces single html/css/js columns. */
    files: jsonb("files").$type<SiteFiles | null>(),
    customDomain: text("custom_domain").unique(),
    customDomainStatus: text("custom_domain_status", {
      enum: ["pending", "verified", "failed"],
    }),
    customDomainToken: text("custom_domain_token"),
    customDomainError: text("custom_domain_error"),
    /** Puter subdomain assigned to this site (unique). The live URL is
     *  `https://<puterSubdomain>.puter.site/`. */
    puterSubdomain: text("puter_subdomain").unique(),
    /** Cached public Puter URL for this site (returned to clients). */
    puterPublicUrl: text("puter_public_url"),
    /** Root directory inside Puter that holds this site's files. */
    puterRootDir: text("puter_root_dir"),
    /** Status of the upload to Puter cloud hosting. */
    puterStatus: text("puter_status", {
      enum: ["pending", "uploading", "hosted", "failed"],
    }),
    /** Last error encountered while uploading to Puter (if any). */
    puterError: text("puter_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sites_user_id_idx").on(t.userId),
    index("sites_custom_domain_idx").on(t.customDomain),
  ],
);

export type Site = typeof sitesTable.$inferSelect;
export type InsertSite = typeof sitesTable.$inferInsert;

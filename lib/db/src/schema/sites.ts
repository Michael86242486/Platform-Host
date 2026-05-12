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
  type:
    | "website" | "saas" | "portfolio" | "restaurant" | "ecommerce"
    | "event" | "editorial" | "art" | "music" | "game" | "tool"
    | "bot" | "docs" | "nonprofit" | "personal" | "agency"
    | "directory" | "backend" | "mvp" | "dashboard" | "landing";
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

export interface SiteCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  files?: SiteFiles;
  progress: number;
}

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
    projectType: text("project_type", {
      enum: [
        "website", "game", "saas", "ecommerce", "portfolio",
        "dashboard", "landing", "mvp", "api", "tool", "bot",
      ],
    }).default("website"),
    githubRepo: text("github_repo"),
    githubBranch: text("github_branch").default("main"),
    githubSyncStatus: text("github_sync_status", {
      enum: ["none", "syncing", "synced", "failed"],
    }).default("none"),
    analysis: jsonb("analysis").$type<SiteAnalysis | null>(),
    plan: jsonb("plan").$type<SitePlan | null>(),
    files: jsonb("files").$type<SiteFiles | null>(),
    customDomain: text("custom_domain").unique(),
    customDomainStatus: text("custom_domain_status", {
      enum: ["pending", "verified", "failed"],
    }),
    customDomainToken: text("custom_domain_token"),
    customDomainError: text("custom_domain_error"),
    puterSubdomain: text("puter_subdomain").unique(),
    puterPublicUrl: text("puter_public_url"),
    puterRootDir: text("puter_root_dir"),
    puterStatus: text("puter_status", {
      enum: ["pending", "uploading", "hosted", "failed"],
    }),
    puterError: text("puter_error"),
    model: text("model"),
    checkpoints: jsonb("checkpoints").$type<SiteCheckpoint[] | null>(),
    shareToken: text("share_token").unique(),
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
    index("sites_project_type_idx").on(t.projectType),
  ],
);

export type Site = typeof sitesTable.$inferSelect;
export type InsertSite = typeof sitesTable.$inferInsert;

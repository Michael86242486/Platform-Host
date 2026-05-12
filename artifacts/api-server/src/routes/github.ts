/**
 * GitHub Integration Routes
 * Allows users to connect GitHub repos, import projects, and sync builds.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/auth";
import { db, usersTable, sitesTable } from "../lib/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const connectSchema = z.object({
  accessToken: z.string().min(10),
  username: z.string().min(1).max(100),
  avatarUrl: z.string().url().optional(),
});

const repoImportSchema = z.object({
  repoUrl: z.string().url(),
  branch: z.string().default("main"),
  siteId: z.string().uuid().optional(),
});

router.post("/github/connect", requireAuth, async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const { accessToken, username, avatarUrl } = parsed.data;
  try {
    await db
      .update(usersTable)
      .set({
        githubAccessToken: accessToken,
        githubUsername: username,
        githubAvatarUrl: avatarUrl ?? null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, req.user!.id));

    logger.info({ userId: req.user!.id, username }, "GitHub connected");
    res.json({ ok: true, username });
  } catch (err) {
    logger.error({ err }, "GitHub connect failed");
    res.status(500).json({ error: "connect_failed" });
  }
});

router.delete("/github/disconnect", requireAuth, async (req, res) => {
  try {
    await db
      .update(usersTable)
      .set({
        githubAccessToken: null,
        githubUsername: null,
        githubAvatarUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, req.user!.id));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "GitHub disconnect failed");
    res.status(500).json({ error: "disconnect_failed" });
  }
});

router.get("/github/status", requireAuth, async (req, res) => {
  const user = req.user!;
  res.json({
    connected: Boolean(user.githubUsername),
    username: user.githubUsername ?? null,
    avatarUrl: (user as { githubAvatarUrl?: string }).githubAvatarUrl ?? null,
  });
});

router.get("/github/repos", requireAuth, async (req, res) => {
  const user = req.user! as { githubAccessToken?: string | null };
  if (!user.githubAccessToken) {
    res.status(401).json({ error: "github_not_connected" });
    return;
  }
  try {
    const response = await fetch(
      "https://api.github.com/user/repos?sort=updated&per_page=30&type=all",
      {
        headers: {
          Authorization: `Bearer ${user.githubAccessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      res.status(response.status).json({ error: "github_api_error", detail: text.slice(0, 200) });
      return;
    }
    type GitHubRepo = {
      id: number;
      name: string;
      full_name: string;
      description: string | null;
      html_url: string;
      default_branch: string;
      language: string | null;
      updated_at: string;
      stargazers_count: number;
      private: boolean;
    };
    const repos = (await response.json()) as GitHubRepo[];
    res.json(
      repos.map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        url: r.html_url,
        defaultBranch: r.default_branch,
        language: r.language,
        updatedAt: r.updated_at,
        stars: r.stargazers_count,
        private: r.private,
      })),
    );
  } catch (err) {
    logger.error({ err }, "GitHub repos fetch failed");
    res.status(500).json({ error: "fetch_failed" });
  }
});

router.post("/github/import", requireAuth, async (req, res) => {
  const parsed = repoImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const { repoUrl, branch, siteId } = parsed.data;

  try {
    const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
    if (!repoMatch) {
      res.status(400).json({ error: "invalid_github_url" });
      return;
    }
    const [, owner, repo] = repoMatch;
    const fullName = `${owner}/${repo.replace(/\.git$/, "")}`;

    if (siteId) {
      await db
        .update(sitesTable)
        .set({
          githubRepo: fullName,
          githubBranch: branch,
          githubSyncStatus: "none",
          updatedAt: new Date(),
        })
        .where(eq(sitesTable.id, siteId));
      res.json({ ok: true, siteId, repo: fullName, branch });
    } else {
      res.json({
        ok: true,
        repo: fullName,
        branch,
        suggestedPrompt: `Import and enhance the GitHub repo ${fullName} (branch: ${branch}). Analyze the README, understand the project structure, and build an improved production-ready version with better UI, documentation, and missing features.`,
      });
    }
  } catch (err) {
    logger.error({ err }, "GitHub import failed");
    res.status(500).json({ error: "import_failed" });
  }
});

export default router;

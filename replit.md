# WebForge

A premium Expo mobile app that lets non-technical users create and host live
websites just by describing them. Pair the app with a hosted Telegram bot to
build, edit, and manage sites straight from chat.

## Architecture

This is a pnpm monorepo with three artifacts:

- `artifacts/webforge` — Expo (SDK 54) mobile app, dev-aesthetic dark UI with
  falling-code background, Clerk-powered auth (email + Google/Facebook/Apple
  SSO), expo-router navigation, React Query data layer.
- `artifacts/api-server` — Express 5 + Clerk JWT verification, Drizzle ORM on
  Postgres, in-process site generator and job queue, multi-bot Telegram
  manager. Mounted at `/api`.
- `artifacts/mockup-sandbox` — design preview server (template default).

Shared workspace packages:

- `lib/db` — Drizzle schemas (`users`, `sites`, `jobs`, `telegramBots`).
- `lib/api-spec` — OpenAPI source of truth.
- `lib/api-zod`, `lib/api-client-react` — generated Zod validators and
  React Query hooks (orval / openapi-zod).

## Mobile app

Routes:

- `/(auth)/sign-in`, `/(auth)/sign-up` — Clerk auth with email/password and
  social SSO. Falling-code matrix backdrop.
- `/(home)/index` — Dashboard with stats, recent sites, "Forge" CTA.
- `/(home)/sites` — List of all sites.
- `/(home)/bots` — Host/list/stop Telegram bots; lists supported commands.
- `/(home)/profile` — Profile + sign-out.
- `/create` — Modal: prompt input + suggestion chips, kicks off a build.
- `/site/[id]` — Site detail with a fake browser preview, blurred "Generating"
  overlay with progress bar (matches design reference), share/copy/retry/delete.

Theme tokens live in `constants/colors.ts` (dev-dark palette: `#0A0E14` bg,
`#00FFC2` primary, `#58A6FF` accent). All visuals lean into a developer
aesthetic — monospace accents, glowing dots, gradient CTAs.

## Backend

`POST /api/sites { prompt, name? }` enqueues a job. The in-process queue
(`lib/queue.ts`) walks through stages — reading prompt, choosing palette,
sketching layout, writing HTML, etc. — updating `sites.progress/message` so
the mobile UI can poll it. `lib/generator.ts` produces a deterministic
single-document site (HTML + inline CSS + JS) by picking a palette and copy
based on prompt keywords. Generated HTML is stored in `sites.html` and served
publicly at `GET /api/hosted/{slug}`.

Other routes:

- `GET /api/me` — ensure a `users` row exists for the Clerk user, return it.
- `GET /api/sites` / `GET /api/sites/:id` / `DELETE /api/sites/:id`.
- `POST /api/sites/:id/edit` — re-runs generation with new instructions.
- `POST /api/sites/:id/retry` — retries a failed build.
- `GET /api/jobs` — recent build jobs across the user's sites.
- `GET/POST/DELETE /api/bots` — host, list, stop hosted Telegram bots.

`lib/telegram.ts` is a multi-bot manager. On boot it loads every active bot
from the DB and starts polling. Each bot exposes the full WebForge command
set:

```
/create, /edit, /status, /preview, /mysites, /retry, /delete,
/tasks, /queue, /hostbot, /mybots, /stopbot
```

Bots are owned by the WebForge user who hosted them — anyone who chats with
a bot acts on the owner's account. The manager handles missing-arg flows by
asking a follow-up message and remembering the chat state.

## Auth

Clerk for both web (api-server JWT verification via `@clerk/express`) and
mobile (`@clerk/expo` with `expo-secure-store` token cache). Required env:

- `CLERK_SECRET_KEY` (server)
- `CLERK_PUBLISHABLE_KEY` (server) and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
  (mobile, forwarded by `webforge`'s `dev` script).
- `EXPO_PUBLIC_API_URL` — full origin of the api-server (defaults to the
  Replit dev domain in dev).

A row is auto-created in `users` on first authenticated request.

## Data model

```
users(id, clerkUserId, email, firstName, lastName, imageUrl)
sites(id, userId, name, slug UNIQUE, prompt, status, progress, message, error,
      coverColor, html, css, js, createdAt, updatedAt)
jobs(id, userId, siteId, kind, status, progress, message, instructions,
     createdAt, finishedAt)
telegramBots(id, userId, token, tokenPreview, username, displayName,
             status, lastError, createdAt, updatedAt)
```

## Dev / build

- `pnpm --filter @workspace/api-server run dev` — bundle + run the server.
- `pnpm --filter @workspace/webforge run dev` — start Expo on the assigned
  port. The dev script forwards Clerk + API env to Expo.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate Zod and React
  Query hooks after editing `lib/api-spec/openapi.yaml`.
- `pnpm --filter @workspace/db run db:push` — push Drizzle schema to
  Postgres (use `--force` to skip prompts).

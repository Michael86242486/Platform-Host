# WebForge

A premium Expo mobile app that lets non-technical users create and host live
websites just by describing them. Pair the app with a hosted Telegram bot to
build, edit, and manage sites straight from chat.

## Architecture

This is a pnpm monorepo with three artifacts:

- `artifacts/webforge` — Expo (SDK 54) mobile app, dev-aesthetic dark UI with
  falling-code background, Clerk-powered auth (email + Google/Facebook/Apple
  SSO), expo-router navigation, React Query data layer. The agent screen
  (`app/create.tsx`) is a full chat UI: message bubbles, suggestion chips,
  inline live preview, voice input, and a composer at the bottom that lets
  users keep refining the build with follow-up messages.
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
- `POST /api/sites/:id/domain { domain }` — attach a custom domain (CNAME +
  TXT verification). Issues a verification token.
- `POST /api/sites/:id/domain/verify` — looks up `_webforge.{domain}` TXT and
  flips the site to `verified` if `webforge-verify=<token>` is present.
- `DELETE /api/sites/:id/domain` — detach the domain.

When a request hits the api-server with a `Host` that matches a verified
custom domain (see `middlewares/customDomain.ts`), the request bypasses Clerk
and is served the site's HTML directly. Unverified domains get a friendly
"verify in the app" page.
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

## Live token-by-token streaming

Two layers of live streaming feed the chat UI:

1. **Server-Sent Events bus.** `lib/eventBus.ts` exposes a typed
   `siteEventBus`. The build queue (`lib/queue.ts`) emits `site_updated`,
   `message_added`, `file_progress`, and `narration_*` events at every
   meaningful change. The `GET /api/sites/:id/events` SSE endpoint
   (`routes/sites.ts`) authenticates via either the standard Bearer header
   or a `?token=wf_…` query param (EventSource can't set headers) and
   forwards every event to the subscriber, with a 20s keepalive ping.
2. **Token-by-token agent narration.** `lib/narrate.ts` calls OpenAI with
   `stream: true` to produce a short "thinking out loud" paragraph
   (`thinking`, `building`, `done` phases). Each token is broadcast as
   `narration_delta`; the final text is persisted as a regular agent
   message so it survives a refresh.

The chat UI (`artifacts/webforge/lib/useSiteStream.ts` +
`artifacts/webforge/app/create.tsx`) opens an `EventSource` for the active
site, invalidates the React Query caches on every server event (so
polling drops to zero once SSE is connected), and renders in-flight
narrations as live "typing" bubbles with a blinking caret. The inline
preview iframe also bumps its refresh key on every `file_progress` event
so users see the partial HTML stream in real time.

While the LLM is writing files, the queue worker upserts each partial file
into `sites.files` every ~220ms. The public route
`/api/hosted/:slug/(*splat)?` (in `routes/sites.ts`) detects status
`building` / `analyzing` and serves the partial bytes wrapped in
`buildingShell()` — a small overlay + `<meta http-equiv="refresh" content="0.7">`
so the iframe re-fetches and shows new tokens as they arrive. CSS and JS
files are streamed as-is.

## Telegram bot

- The system bot polls automatically when `WEBFORGE_TELEGRAM_BOT_TOKEN` is
  set. `ensureSystemBot()` auto-creates a "system" user the first time it
  runs so the bot can register before any mobile user signs up.
- Conversation flow: `/start` greets and asks what to build; any free text
  (or `/create <idea>`) kicks off an analyze-then-build job that auto-chains
  via the `__AUTO_BUILD__` sentinel on the analyze job's `instructions`. The
  bot immediately replies with the live preview URL so users can watch the
  HTML stream in their browser, then edits a single progress message as
  files are written, and finally posts the "live!" message with the URL.

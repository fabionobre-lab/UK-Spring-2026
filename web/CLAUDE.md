# Zarparia (web/)

Family travel-itinerary app. SvelteKit on a Cloudflare Worker (`trips`), D1
database `trips`, R2 bucket `trips-photos`. Live at
https://trips.fabionobre-ai.workers.dev. Part of the Aria Nobre app family —
see the repo-root CLAUDE.md for the design contract and deploy house rule.

## Commands (run in web/, or via the root wrapper `npm --prefix web run …`)

- `npm run dev` — Vite dev server
- `npm test` — vitest suite (unit tests in `test/`)
- `npm run check` — svelte-check typecheck (kept at 0 errors; CI gates on it)
- `npm run build` — vite build
- `npm run db:migrate:local` / `db:migrate:remote` — D1 migrations (`migrations/`)
- `npm run cf-typegen` — regenerate Worker types from wrangler.jsonc

## Deploy

Push to `main` deploys via GitHub Actions (`.github/workflows/deploy.yml`):
every branch runs svelte-check + vitest; only `main` deploys the Worker, then
smoke-checks `/api/health`. **Pushing to main IS deploying** — ask Fabio first.
Manual fallback: `cd web && npm run deploy` as a single command (never bare
`npx wrangler deploy` from the repo root — see root CLAUDE.md for the
wizard-scaffold hazard).

## Architecture map

- `src/lib/trip-engine.ts` — trip document model + derived helpers.
  `dayStops()` is the single per-day stop-numbering source shared by the day
  map, Day-Route stepper and timeline dots.
- `src/lib/TripView.svelte`, `src/lib/trip/` — itinerary renderer (days,
  blocks, segments, inspectors, plan variants).
- `src/lib/server/` — D1 access, sessions/auth, public links, accounts.
- `src/routes/api/` — JSON API (session-gated; returns 401 signed out).
- `src/routes/s/[token]/` — public share pages (token from `trip_public_links`).
- `src/routes/oauth/`, `src/routes/mcp/` — MCP connector + its OAuth flow
  (`oauth_clients/codes/tokens` tables); docs in `docs/MCP_CONNECTOR.md`.
- `src/routes/guide/`, `src/routes/roadmap/` — content in `src/lib/guide/`.
  House rule: a user-visible feature isn't done until its /guide entry is
  updated.
- The public roadmap is **two layers**: `src/lib/roadmap/roadmap.json` is the
  committed base snapshot, and D1 `roadmap_items` (migration 0014) is the
  admin-triaged overlay merged over it per request (`src/lib/roadmap/merge.ts`).
  Triage happens in-app at `/admin/roadmap` — publishing a roadmap entry needs
  no code edit and no deploy, so don't hand-edit roadmap.json to add one.

## Data & backups

D1 `trips` tables: trips, users, sessions, trip_photos, trip_shares,
trip_share_links, trip_public_links, trip_invites, feedback, oauth_*,
rate_limits, d1_migrations. Photos binary data lives in R2 (`PHOTOS`).

Backups: D1 Time Travel (~7-day retention, free plan). Restore runbook and a
successful 2026-08-05 practice drill live in
`C:\AI\AriaNobre\FAMILY-STANDARDS.md` §3. **Schema migrations are Tier 2**:
capture a Time Travel bookmark AND take a SQL export
(`npx wrangler d1 export trips --remote --output=backups/…`) before touching
production data. `web/backups/` is gitignored — never commit exports.

## Gotchas

- Fabio edits files live between sessions — always `git status` before staging.
- The Bash shell resets cwd to the repo root on every call; `cd web && …` must
  ride along each time (root package.json wraps the common scripts).
- Firebase handles identity only (email/password, verification, reset);
  our backend just mints D1 sessions from ID tokens (`/auth/login/firebase`).

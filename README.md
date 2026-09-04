# Heimdall

The all-seeing dashboard for every website you maintain: uptime and TLS health,
GitHub deploy drift (open pull requests pending merge, and production lagging
behind the latest GitHub deployment), SEO rank tracking, preview-environment
exposure, and heuristic legal/compliance checks (Impressum, Datenschutz,
cookie consent).

## Local development

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Copy `.env.example` to `.env.local` and fill in what you have:

- `DATABASE_URL` — already points at the local `docker-compose` Postgres.
- `GITHUB_TOKEN` — a fine-grained PAT with `contents:read`, `pull-requests:read`,
  and `deployments:read`, used for drift detection (open PRs against the prod
  branch, plus comparing the latest GitHub Deployment to the branch tip).
- `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` — DataForSEO credentials for SEO
  rank tracking. Without these, rank checks are skipped (logged, not fatal).
- `DISCORD_WEBHOOK_URL` — a Discord incoming webhook URL for alert
  notifications. Without it, alerts stay in-app only.
- `NTFY_BASE_URL` / `NTFY_TOKEN` — push alerts to a phone via
  [ntfy](https://ntfy.sh). Alerts go to every configured channel, so ntfy and
  Discord can run side by side or on their own. The base URL must be the ntfy
  server's public domain: ntfy is a separate Coolify resource in its own
  Docker network, so the internal `http://ntfy` hostname does not resolve from
  here. `NTFY_TOKEN` authenticates a publisher account that may write to
  Heimdall's topic and nothing else; a public server takes posts without it.
  The topic itself is a constant in `src/lib/ntfy.ts`, since the account's
  write-only grant covers only that one.
- `CRON_SECRET` — set this in production; cron routes check it via
  `Authorization: Bearer <CRON_SECRET>`. Left unset, cron routes are open
  (fine for local dev, required before deploying).

## Architecture

Single Next.js app (no separate worker/queue infra) — see
`src/app/api/cron/*` for the scheduled check endpoints, fired by the `cron`
container (`crons.json`) in production. Data model lives in `src/db/schema.ts`
(Drizzle). Check implementations live in `src/checks/*`; SEO providers behind
a pluggable interface in `src/providers/*`.

### Local cron

`crons.json`'s `crons` array is the single source of truth for schedules in
both environments — `pnpm dev` runs `next dev` and `scripts/local-cron.ts`
together (via `concurrently`, labeled `next`/`cron` in the log output). The
same script runs as its own container in production, reading the same file
and firing an HTTP request at each route on its schedule, so both
environments behave identically. If you change a schedule, only edit
`crons.json`; both environments pick it up. The app also reads the file at
runtime to show each check's cadence in the UI.

- If `next dev` runs on a non-default port, set `APP_URL` (e.g.
  `APP_URL=http://localhost:4000 pnpm cron:local`) so the cron runner targets
  the right server.
- `CRON_SECRET` is honored the same way as production, if set.
- `pnpm cron:local:now` fires every job once immediately in addition to
  scheduling it — useful when actively testing a check without waiting for
  the next tick. It's a separate script (not part of `pnpm dev`) because
  firing immediately can race `next dev` still booting.

## Deployment

Self-hosted on Coolify as a "Docker Compose" resource built from
`docker-compose.prod.yml`: `app` (Next.js standalone), `cron` (the schedule
runner above) and `postgres` on a named volume. `Dockerfile` builds all of
it; `docker-entrypoint.sh` applies pending migrations before starting the
server, so a failed migration stops the container instead of serving against
a stale schema.

Two environment variables matter only in production: `AUTH_URL` and
`AUTH_TRUST_HOST`. Auth.js derives `trustHost` from those (or from a
platform marker like `VERCEL`), and off such a platform every sign-in fails
with `UntrustedHost` unless they are set. Both live in the compose file.

See `docs/superpowers/specs/2026-08-26-coolify-migration-design.md` for the
reasoning and `docs/superpowers/plans/2026-08-26-coolify-migration.md` for
the step-by-step record.

## Scripts

- `pnpm dev` — start the app and the local cron runner together
- `pnpm dev:next` — start only the Next.js app
- `pnpm cron:local` / `pnpm cron:local:now` — run only the local cron runner
- `pnpm build` / `pnpm start` — production build/run
- `pnpm db:generate` — generate a Drizzle migration from schema changes
- `pnpm db:migrate` — apply migrations
- `pnpm db:studio` — browse the database with Drizzle Studio

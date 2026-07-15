# Heimdall

The all-seeing dashboard for every website you maintain: uptime and TLS health,
GitHub deploy drift (undeployed commits sitting in a branch), SEO rank
tracking, preview-environment exposure, and heuristic legal/compliance checks
(Impressum, Datenschutz, cookie consent).

## Local development

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Copy `.env.example` to `.env.local` and fill in what you have:

- `DATABASE_URL` — already points at the local `docker-compose` Postgres.
- `GITHUB_TOKEN` — a fine-grained PAT with `contents:read`, used for drift
  detection via `compareCommits`.
- `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` — DataForSEO credentials for SEO
  rank tracking. Without these, rank checks are skipped (logged, not fatal).
- `DISCORD_WEBHOOK_URL` — a Discord incoming webhook URL for alert
  notifications. Without it, alerts stay in-app only.
- `CRON_SECRET` — set this in production; cron routes check it via
  `Authorization: Bearer <CRON_SECRET>`. Left unset, cron routes are open
  (fine for local dev, required before deploying).

## Architecture

Single Next.js app (no separate worker/queue infra) — see
`src/app/api/cron/*` for the scheduled check endpoints, triggered by Vercel
Cron (`vercel.json`) in production. Data model lives in `src/db/schema.ts`
(Drizzle). Check implementations live in `src/checks/*`; SEO providers behind
a pluggable interface in `src/providers/*`.

### Local cron

`vercel.json`'s `crons` array is the single source of truth for schedules in
both environments — `pnpm dev` runs `next dev` and `scripts/local-cron.ts`
together (via `concurrently`, labeled `next`/`cron` in the log output). The
cron script reads `vercel.json` directly and fires an HTTP request at each
route on its schedule, exactly like Vercel Cron does in production — no
route code needs to know it isn't running on Vercel. If you change a
schedule, only edit `vercel.json`; both environments pick it up.

- If `next dev` runs on a non-default port, set `APP_URL` (e.g.
  `APP_URL=http://localhost:4000 pnpm cron:local`) so the cron runner targets
  the right server.
- `CRON_SECRET` is honored the same way as production, if set.
- `pnpm cron:local:now` fires every job once immediately in addition to
  scheduling it — useful when actively testing a check without waiting for
  the next tick. It's a separate script (not part of `pnpm dev`) because
  firing immediately can race `next dev` still booting.

## Scripts

- `pnpm dev` — start the app and the local cron runner together
- `pnpm dev:next` — start only the Next.js app
- `pnpm cron:local` / `pnpm cron:local:now` — run only the local cron runner
- `pnpm build` / `pnpm start` — production build/run
- `pnpm db:generate` — generate a Drizzle migration from schema changes
- `pnpm db:migrate` — apply migrations
- `pnpm db:studio` — browse the database with Drizzle Studio

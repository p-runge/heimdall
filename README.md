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
`src/app/api/cron/*` for the scheduled check endpoints, meant to be triggered
by Vercel Cron (`vercel.json`) in production. Data model lives in
`src/db/schema.ts` (Drizzle). Check implementations live in `src/checks/*`;
SEO providers behind a pluggable interface in `src/providers/*`.

## Scripts

- `pnpm dev` — start the app
- `pnpm build` / `pnpm start` — production build/run
- `pnpm db:generate` — generate a Drizzle migration from schema changes
- `pnpm db:migrate` — apply migrations
- `pnpm db:studio` — browse the database with Drizzle Studio

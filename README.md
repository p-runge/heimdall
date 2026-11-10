# Heimdall

Heimdall is a self-hosted dashboard for agencies and freelancers who look after
a lot of client websites. It checks every site on a schedule and fires an alert
when something breaks: a site goes down, a certificate is about to expire, a
merged change never reached production, a preview environment is open to
search engines, or a page loses its imprint link.

Sites are grouped by client. Each site has a primary URL and, optionally, a
preview URL, a GitHub repository and a list of SEO keywords.

## Features

- **Uptime and response checks.** Every minute, Heimdall requests the site's
  root page and records status code and response time. It also reads the
  sitemap once a day, groups the URLs into page types (`/`, `/blog/*`, ...) and
  checks one sample URL per type on a 10-minute rotation, so a broken template
  shows up even when the homepage is fine.
- **TLS expiry.** The health check reads the certificate on port 443 and warns
  14 days before it expires, critical below 3 days.
- **Deploy drift.** For sites linked to a GitHub repository, Heimdall lists open
  pull requests against the production branch (flagging ones older than three
  days) and compares the latest GitHub Deployment with the branch tip, so you
  see when production lags behind what was merged.
- **Preview exposure.** If a site has a preview URL, Heimdall checks that it is
  either password protected (401/403) or marked `noindex`. A preview that
  answers 200 without either raises an alert.
- **Legal and compliance heuristics.** A daily check looks for an imprint
  (Impressum) and a privacy policy link and detects common cookie consent tools
  (Cookiebot, Usercentrics, Borlabs Cookie, OneTrust, CookieYes, Klaro). These
  are aimed at German and EU sites and are heuristics, not legal advice.
- **SEO rank tracking.** Track Google positions for keywords per site, country
  and device, with a history chart and alerts on rank drops. Rank checks go
  through [DataForSEO](https://dataforseo.com) and cost money per keyword, so
  they are opt-in per site.
- **Alerts.** Every check opens and resolves alerts on its own. Alerts can be
  acknowledged in the UI and are sent to Discord (webhook) and/or
  [ntfy](https://ntfy.sh) push notifications, with ntfy priority mapped per
  alert type and severity.
- **Live checks on page view.** Opening a site re-runs its checks (throttled to
  once per minute), so the page never shows stale data.
- **Google sign-in** limited to a Google Workspace domain, a list of email
  addresses, or both.

## Stack

- [Next.js](https://nextjs.org) 16 (App Router) with React 19 and Tailwind CSS 4
- PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)
- [Auth.js](https://authjs.dev) (NextAuth v5) with Google OAuth
- Environment validation with [T3 Env](https://env.t3.gg) and Zod (`src/env.ts`)
- pnpm

There is no separate worker or queue. Each scheduled check is a route under
`src/app/api/cron/*`, and a small runner (`scripts/local-cron.ts`) calls those
routes on the schedules in `crons.json`. Check logic lives in `src/checks/*`,
the data model in `src/db/schema.ts`, and the rank provider sits behind an
interface in `src/providers/*`.

## Local setup

You need Node.js 22, pnpm and Docker.

```bash
pnpm install
cp .env.example .env.local
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

`docker compose up` starts Postgres on port 5544, which matches the default
`DATABASE_URL` in `.env.example`. `pnpm dev` starts Next.js and the cron runner
together. The app is at http://localhost:3000.

### Environment variables

These are required, the app refuses to start without them.

| Variable                                   | Purpose                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Postgres connection string. The default points at the local Docker database. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`     | Google OAuth client, see below.                                              |
| `AUTH_SECRET`                              | Encrypts the session cookie. Generate one with `npx auth secret`.            |
| `ALLOWED_EMAIL_DOMAIN` and/or `ALLOWED_EMAILS` | Who may sign in. At least one of the two must be set.                    |

`ALLOWED_EMAIL_DOMAIN` lets in every account on a Google Workspace domain,
checked against the verified `hd` claim on Google's ID token.
`ALLOWED_EMAILS` is a comma-separated list of addresses and also works for
plain Gmail accounts. With both set, either one is enough to sign in.

To create the OAuth client, open
[Google Cloud credentials](https://console.cloud.google.com/apis/credentials),
create an OAuth client of type "Web application" and add
`http://localhost:3000/api/auth/callback/google` as a redirect URI. If only
your Workspace domain signs in, set the consent screen's user type to
"Internal". For Gmail addresses it has to be "External", with those addresses
added as test users or the app published.

Everything else is optional. Each integration switches itself off when its
variables are missing, and the settings page shows which ones are active.

| Variable                                  | Enables                                                                                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                            | Deploy drift checks. A fine-grained token with `contents:read`, `pull-requests:read` and `deployments:read` on the repositories you track.                                                                           |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | SEO rank tracking. Without them, rank checks are skipped.                                                                                                                                                            |
| `DISCORD_WEBHOOK_URL`                     | Alerts posted to a Discord channel.                                                                                                                                                                                  |
| `NTFY_BASE_URL`, `NTFY_TOKEN`, `NTFY_TOPIC` | Alerts pushed through ntfy. The base URL must be reachable from Heimdall. The token is optional on servers that accept anonymous posts. The topic defaults to `heimdall`; on a public server like ntfy.sh, pick one nobody can guess. |
| `CRON_SECRET`                             | Protects the cron routes. When set, they require `Authorization: Bearer <CRON_SECRET>`. Leave it empty locally, always set it in production.                                                                         |

Without Discord or ntfy, alerts only show up in the app.

### Schedules

`crons.json` is the only place schedules are defined. The local runner, the
production cron container and the cadence shown in the UI all read it, so a
change there applies everywhere.

- If `next dev` runs on another port, point the runner at it:
  `APP_URL=http://localhost:4000 pnpm cron:local`.
- `pnpm cron:local:now` fires every job once right away and then keeps the
  schedule. It is not part of `pnpm dev`, because firing immediately can race
  `next dev` while it is still booting.

### Scripts

- `pnpm dev` starts the app and the cron runner
- `pnpm dev:next` starts only Next.js
- `pnpm cron:local` / `pnpm cron:local:now` run only the cron runner
- `pnpm build` / `pnpm start` build and run for production
- `pnpm test` runs the unit tests
- `pnpm lint` runs ESLint
- `pnpm db:generate` creates a Drizzle migration from schema changes
- `pnpm db:migrate` applies migrations
- `pnpm db:studio` opens Drizzle Studio

## Running your own instance

The repository ships a production stack in `docker-compose.prod.yml`, built
from the `Dockerfile`. It has three services:

- `app`, the Next.js standalone server on port 3000. On start,
  `docker-entrypoint.sh` applies pending migrations and only then starts the
  server, so a failed migration stops the container instead of serving against
  an outdated schema.
- `cron`, the schedule runner, calling `app` over the internal Docker network.
- `postgres`, with its data on a named volume.

The compose file is written for [Coolify](https://coolify.io), which is how the
reference instance runs, but it works with any Docker host. Before deploying:

1. Provide the environment variables listed above, plus two more:
   - `AUTH_URL`, your public URL, e.g. `https://heimdall.example.com`. Outside
     platforms like Vercel, Auth.js only trusts the request host when
     `AUTH_URL` or `AUTH_TRUST_HOST` is set, and every sign-in fails with
     `UntrustedHost` otherwise. The compose file already sets
     `AUTH_TRUST_HOST`.
   - `SERVICE_PASSWORD_POSTGRES`, the database password. Coolify generates it
     automatically. Elsewhere, put it in a `.env` file next to the compose file
     along with the other variables.
2. Put a reverse proxy with TLS in front of `app`. The service only exposes
   port 3000 to the Docker network and publishes no host port. Without a proxy,
   add a `ports` mapping.
3. Add `https://<your-domain>/api/auth/callback/google` as a redirect URI to
   your Google OAuth client.

Then run:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## License

[MIT](LICENSE)

# Migrating Heimdall from Vercel + Neon to Coolify

Date: 2026-08-26
Status: draft, awaiting review

## Why

Production has been returning HTTP 500 on every route. The Vercel runtime logs
show the same Postgres error on every request and every cron run:

```
[cause]: Your account or project has exceeded the compute time quota.
         Upgrade your plan to increase limits.
         severity_local: 'ERROR', code: '53000'
```

Neon refuses all connections because the plan's compute-time quota is used up.
The `/api/cron/health` route runs on `* * * * *`, and Neon only suspends compute
after roughly five minutes of inactivity, so the database never idles. A
once-per-minute cron therefore bills 24/7 compute for a tool that needs a few
minutes of database time per hour. `/api/cron/rank-poll` on `*/10` keeps it awake
on its own.

Every page dies with the database, including `/login`, because the root layout
renders `AlertsNavLink` (`src/app/layout.tsx:60`), which queries the `alerts`
table (`src/components/alerts-nav-link.tsx:22`). There is no page left to serve.

Self-hosting Postgres removes the quota entirely. It also matches where the other
Progani projects are heading: Bulkratte already runs on the same Coolify instance
with the same build pack.

## Goals

- Run Heimdall on the existing Coolify instance at `coolify.progani.com`.
- Run Postgres in the same Docker Compose stack, on a named volume.
- Keep `heimdall.progani.com` as the production domain.
- Keep one source of truth for cron schedules, since the UI reads them at runtime.

## Non-goals

- Migrating existing data. Philipp chose a clean start, so no `pg_dump` from Neon
  is needed. This also removes the dependency on unblocking the Neon quota.
- Backups. Deliberately deferred. See "Deferred" below.
- Changing cron frequencies. Self-hosted Postgres has no compute quota, so the
  once-per-minute health check only costs CPU on our own server.

## Target architecture

One Coolify resource of type "Docker Compose", pointing at
`docker-compose.prod.yml` in the repo root on branch `main`. Three services:

| Service | Role | Reachable from |
|---|---|---|
| `app` | Next.js standalone server, applies migrations on startup | Traefik, port 3000 |
| `cron` | Node process running `croner`, calls `http://app:3000/api/cron/*` | internal only |
| `postgres` | `postgres:17-alpine`, named volume | internal only |

The compose file declares no `networks:` block. Coolify creates a per-resource
bridge network and attaches Traefik to it. Bulkratte had to add a
`traefik.docker.network` label precisely because it joins an external network;
keeping every Heimdall service on Coolify's own network avoids that class of 504
routing failure.

The cron runner calls the app over the internal Docker hostname rather than the
public domain. Jobs then keep running when Traefik or DNS is broken, and
`CRON_SECRET` never leaves the Docker network.

Postgres publishes no host port. The local development stack in
`docker-compose.yml` stays as it is, still on port 5544.

## Code changes

### New files

**`Dockerfile`** (multi-stage, modelled on `bulkratte/Dockerfile`):

- Builder stage on `node:22-slim` with corepack and pnpm, `pnpm install
  --frozen-lockfile`, then `pnpm build`.
- Runner stage copying `.next/standalone`, `.next/static` and `public`.
- The builder must copy `crons.json` into the standalone output. Next's file
  tracer does not include it, and `src/lib/cronSchedule.ts` reads it at runtime
  through `process.cwd()`.
- Bulkratte hit a `MODULE_NOT_FOUND` on `@swc/helpers/esm/...` because the tracer
  copies only the `cjs` build into the standalone bundle while
  `next/dist/server/require-hook.js` loads the `esm` build at startup. Verify
  whether Heimdall's bundle has the same gap; port Bulkratte's copy step if so.

**`docker-compose.prod.yml`**: the three services above, plus a named volume for
Postgres data. The Postgres password comes from Coolify's `SERVICE_PASSWORD_*`
magic variable so it is generated once and shared across services.

**`docker-entrypoint.sh`**: runs the pending migrations, then starts the
standalone server. A failed migration must abort the start with a non-zero exit
so a broken schema cannot serve traffic.

**`.dockerignore`**: the repo has none. Without it the build context carries
`node_modules` and every `.env*` file, so `.env.prod`, `.env.local` and
`.env.coolify` would all be baked into an image layer. This has to land before
anything builds.

### Modified files

**`next.config.ts`**: add `output: "standalone"`.

**`package.json`**: add `"packageManager": "pnpm@10.30.3"`. The field is missing,
so `corepack enable` in the Dockerfile has no pinned version to resolve.

**`src/env.ts`**: add a `skipValidation` escape hatch driven by an env var.
`next.config.ts` imports the env schema, so `next build` currently aborts without
a real `DATABASE_URL`. The Docker build has no database, so validation has to be
skippable during the image build and must still run when the container starts.

**`vercel.json` becomes `crons.json`**: the file is pure schedule configuration
once Vercel is gone. Both readers need updating: `src/lib/cronSchedule.ts:18` and
`scripts/local-cron.ts:19`. Also drop the `buildCommand` and Vercel cron keys.

**`scripts/local-cron.ts`**: becomes the production cron runner as well. It
already targets `process.env.APP_URL` and sends the `CRON_SECRET` bearer header,
so the `cron` service only needs `APP_URL=http://app:3000`. Its interface types
should lose the `Vercel` prefix.

**Deleted: `scripts/deploy/migrate-if-production.sh`**. The `VERCEL_ENV` gate has
no meaning on Coolify. `scripts/migrate-prod.ts` stays, but it runs through `tsx`,
which is a devDependency and absent from the standalone runner image. The
Dockerfile needs a slim migration layer that carries `tsx`, `drizzle-orm`,
`postgres` and the `drizzle/` folder.

### Auth.js on a non-Vercel host

`@auth/core` (`lib/utils/env.js:39`) resolves trust like this:

```js
config.trustHost ??= !!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? NODE_ENV !== "production")
```

Vercel sets `VERCEL`, which is why sign-in works there without configuration. On
Coolify none of those are set and `NODE_ENV=production`, so `trustHost` resolves
to `false` and every sign-in fails with `UntrustedHost`. Production must set
`AUTH_URL=https://heimdall.progani.com` and `AUTH_TRUST_HOST=true`, as Bulkratte
does.

### Static prerendering against the database

No route in `src/app` exports `dynamic` or `revalidate`, and `next.config.ts` sets
no `cacheComponents`. Pages call `auth()`, which reads cookies and therefore opts
into dynamic rendering, but the root layout's `AlertsNavLink` queries the database
without any dynamic API of its own. If `next build` tries to prerender it, the
image build fails without a reachable database.

Bulkratte solved the equivalent problem by building on the host network with the
production database reachable. That is a lot of machinery for a dashboard that
sits behind a login and gains nothing from static output.

**Resolved during implementation (2026-08-26):** the build reports every app route
as `f (Dynamic)`; only `/icon.svg` and `/robots.txt` are static. Nothing is
prerendered against the database and no route needs `force-dynamic`.

The build does still need a `DATABASE_URL`, for a different reason.
`src/db/index.ts` throws when the variable is missing and calls `postgres()` on
it, both at module scope, and Next imports that module while collecting route
data. A syntactically valid URL pointing nowhere is enough, since postgres-js
connects lazily. The builder stage sets one alongside `SKIP_ENV_VALIDATION`.

## Coolify setup

Coolify 4.3.2, single server `localhost` (`f7ivu01e4bgmpi86doc76mvi`), Docker
29.7.0, Compose 5.3.1. A GitHub App source already exists (`source_id: 2`, used by
Bulkratte for `p-runge/bulkratte`); Heimdall lives at `p-runge/heimdall` and can
reuse it.

Steps, performed over the Coolify API:

1. Create a project named "Heimdall".
2. Create an application: build pack `dockercompose`, compose location
   `/docker-compose.prod.yml`, base directory `/`, repository `p-runge/heimdall`,
   branch `main`, ports exposes `3000`.
3. Map the domain to the `app` service via `docker_compose_domains`:
   `{"app": {"domain": "https://heimdall.progani.com"}}`.
4. Set environment variables: the ones in `.env.example`, plus `AUTH_URL` and
   `AUTH_TRUST_HOST`. `DATABASE_URL` points at `postgres:5432` on the internal
   network. Generate a fresh `AUTH_SECRET` and `CRON_SECRET` rather than reusing
   the Vercel values.
5. Deploy and verify against Coolify's generated subdomain before touching DNS.

`.env.coolify` in this repo currently carries Bulkratte's application UUID
(`e6s3cl5qdlp582boymwc6u7a`, the `bulkratte:main` resource), presumably copied
across projects. Point `COOLIFY_APP_UUID_PROD` at the new Heimdall resource once
it exists. The file is gitignored and stays that way.

Google OAuth needs no change as long as the domain stays the same. The redirect
URI `https://heimdall.progani.com/api/auth/callback/google` is already registered.

## Cutover

Production is already down, so there is no working deployment to protect and no
maintenance window to negotiate. Even so, the new stack gets verified on Coolify's
generated subdomain before the domain moves.

1. Deploy the stack, reachable only through the Coolify subdomain.
2. Verify (see below) with an empty database.
3. Philipp repoints the `heimdall.progani.com` DNS record to the Coolify server.
   This is the only manual step outside the repo and Coolify.
4. Confirm the certificate is issued and sign-in works on the real domain.
5. Only then remove the Vercel project and the Neon database.

## Verification

- The image builds without a reachable database.
- The container starts, migrations apply to the empty database, `/login` returns
  200.
- Google sign-in succeeds and rejects accounts outside `ALLOWED_EMAIL_DOMAIN`.
- A client and a site can be created.
- `/api/cron/health` runs from the `cron` container and writes a health run.
- The site detail page shows the "every X minutes" cadence, proving `crons.json`
  is present in the runtime image.
- Restarting the stack preserves the data, proving the volume is wired correctly.

## Deferred

**Backups.** All data will live in a single Docker volume on one server, with no
second copy and outside Coolify's backup UI, which only covers its own database
resources. That is tolerable for a freshly seeded monitoring history and not
tolerable a few months in. Bulkratte already has a working restic-to-R2 backup
service under `services/backup/` that can be adapted.

**Reducing the blast radius of a database outage.** This incident took out
`/login` as well, because the root layout queries the database on every render.
Nothing about the migration fixes that. Wrapping `AlertsNavLink` so a failed query
degrades instead of failing the render, plus an `error.tsx`, would have kept a
readable page up throughout.

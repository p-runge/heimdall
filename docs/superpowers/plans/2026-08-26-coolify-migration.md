# Coolify migration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Heimdall off Vercel + Neon onto the existing Coolify instance, with Postgres running in the same Docker Compose stack.

**Architecture:** One Coolify "Docker Compose" resource builds `Dockerfile` from the repo and runs three services: `app` (Next.js standalone, migrates on start), `cron` (croner calling the app over the internal network), and `postgres` (named volume, no published port). Coolify supplies the network and TLS.

**Tech Stack:** Next.js 16.2.10, React 19.2.4, Auth.js 5.0.0-beta.31, Drizzle 0.45.2, postgres-js 3.4.9, croner 10.0.1, pnpm 10.30.3, Node 22, Postgres 17, Coolify 4.3.2.

**Spec:** `docs/superpowers/specs/2026-08-26-coolify-migration-design.md`

## Global constraints

- Domain stays `heimdall.progani.com`. Google OAuth redirect URI is unchanged.
- Fresh, empty database. No data migrates from Neon.
- Cron schedules live in exactly one file, read at runtime by the app for its
  "every X minutes" display. Never duplicate them into the compose file.
- The compose file declares no `networks:` block. Coolify manages the network;
  a custom one causes intermittent 504s because Traefik is not attached to it.
- Production must set `AUTH_URL` and `AUTH_TRUST_HOST=true`. Without them
  `@auth/core` resolves `trustHost` to `false` off Vercel and every sign-in fails.
- `SKIP_ENV_VALIDATION` is set only in the Docker builder stage, never at runtime.
  `src/instrumentation.ts:3` validates the environment when the container starts.
- Postgres publishes no host port. `docker-compose.yml` (local dev, port 5544)
  stays untouched.

## No test framework

This repo has no test runner and no test script, and the work here is
Dockerfiles, compose files and platform configuration. Instead of unit tests,
every task states an exact command and the exact output that proves the step
worked. Run the verification before the implementation step where the plan says
so; a verification that passes before the change means the step proved nothing.

## Commits and pushes

Coolify deploys from `p-runge/heimdall` on `main`, so the code has to be pushed
before it can deploy. Philipp approved working directly on `main`. Each task ends
with a commit; **ask before the first `git push`**, since that is the point where
the change leaves this machine.

## Coolify facts (verified 2026-08-26)

| Thing | Value |
|---|---|
| Instance | `https://coolify.progani.com`, version 4.3.2 |
| Server | `f7ivu01e4bgmpi86doc76mvi` (`localhost`, Docker 29.7.0, Compose 5.3.1) |
| Destination | `ybbk8f805rwfrgitystbxe83` (standalone, network `coolify`) |
| GitHub App source | `kgfmnmcn9f1oy8c9nrbw8bpe` (`p-runge-coolify`, installation 150298360) |
| Team | `Progani` (root team, id 0) |
| Reference resource | Bulkratte `e6s3cl5qdlp582boymwc6u7a`, same build pack |

Credentials live in `.env.coolify` (gitignored). The token is a Laravel Sanctum
token of the form `<id>|<secret>`; the pipe makes naive shell sourcing execute the
secret as a command. Always read it with:

```bash
COOLIFY_URL="$(grep '^COOLIFY_URL=' .env.coolify | cut -d= -f2- | tr -d '"'"'"'\r')"
COOLIFY_TOKEN="$(grep '^COOLIFY_TOKEN=' .env.coolify | cut -d= -f2- | tr -d '"'"'"'\r')"
```

Never `cat` an API response that can contain private keys (`/api/v1/security/keys`).

---

## File structure

| File | Responsibility |
|---|---|
| `.dockerignore` (new) | Keep secrets and `node_modules` out of the build context |
| `Dockerfile` (new) | Three stages: `builder`, `runner` (app + migrator), `cron` |
| `docker-entrypoint.sh` (new) | Migrate, then exec the standalone server |
| `docker-compose.prod.yml` (new) | The three production services and the data volume |
| `crons.json` (renamed from `vercel.json`) | The one schedule source |
| `next.config.ts` | Adds `output: "standalone"` |
| `src/env.ts` | Adds the build-time validation escape hatch |
| `src/lib/cronSchedule.ts` | Reads `crons.json` instead of `vercel.json` |
| `scripts/local-cron.ts` | Same, and becomes the production runner |
| `package.json` | Pins `packageManager` so corepack is deterministic |
| `scripts/deploy/migrate-if-production.sh` | Deleted with the Vercel build hook |

---

## Task 1: Build context hygiene and toolchain pin

Without `.dockerignore` the build context includes `node_modules` and every
`.env*` file, which puts `.env.prod`, `.env.local` and `.env.coolify` (all real
secrets) into the image. Do this before anything builds.

**Files:**
- Create: `.dockerignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a build context safe to `COPY . .` from, and `pnpm@10.30.3` pinned
  for `corepack enable` in Task 4.

- [ ] **Step 1: Prove the problem**

```bash
ls -la .env.prod .env.local .env.coolify
```

Expected: all three exist. Any `docker build` from this directory today would
copy them into the image layer.

- [ ] **Step 2: Write `.dockerignore`**

```
# Keep the Docker build context small and free of secrets.
node_modules
.next
.git
.github
.claude
.vscode
.vercel
drizzle.config.ts
docs
**/.env
**/.env.*
!.env.example
**/*.log
tsconfig.tsbuildinfo
```

`drizzle.config.ts` is excluded because it reads `.env` for local tooling; the
image migrates through `scripts/migrate-prod.ts`, which takes `DATABASE_URL`
straight from the environment.

- [ ] **Step 3: Pin the package manager**

In `package.json`, directly after `"private": true,`:

```json
  "packageManager": "pnpm@10.30.3",
```

- [ ] **Step 4: Verify the context excludes secrets**

```bash
printf 'FROM busybox\nCOPY . /ctx\nRUN ls -a /ctx | grep -c "^\\.env" || true\n' > /tmp/ctx.Dockerfile
docker build -q -f /tmp/ctx.Dockerfile -t heimdall-ctx-check . && \
docker run --rm heimdall-ctx-check sh -c 'ls -a /ctx | grep "^\.env" || echo "NO ENV FILES"'
```

Expected: `.env.example` only, or `NO ENV FILES`. If `.env.prod`, `.env.local` or
`.env.coolify` appear, `.dockerignore` is wrong. Clean up afterwards:
`docker rmi heimdall-ctx-check`.

- [ ] **Step 5: Commit**

```bash
git add .dockerignore package.json
git commit -m "build: add dockerignore and pin pnpm for container builds"
```

---

## Task 2: Standalone output and build-time env escape hatch

`next.config.ts:2` imports the env schema, so `next build` currently fails
without a real `DATABASE_URL`. The image build has no database. This task also
answers the spec's open question about whether the build reaches the database.

**Files:**
- Modify: `next.config.ts`, `src/env.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `.next/standalone/server.js` and the `SKIP_ENV_VALIDATION` env var
  that Task 4's builder stage sets.

- [ ] **Step 1: Prove the build fails without env**

```bash
DATABASE_URL="not-a-url" pnpm build
```

Expected: fails with `Invalid environment variables` from `@t3-oss/env-nextjs`.
Do not skip this: it is what proves the escape hatch is needed.

Note `env -u DATABASE_URL` does *not* work here. Next loads `.env.local` itself,
so unsetting the shell variable changes nothing. A real environment variable
takes precedence over the file, which is why an invalid value is the way to force
the failure.

If a dev server is running (`.next/dev/lock` present), stop here and say so.
Building while `next dev` runs corrupts the generated route types.

- [ ] **Step 2: Add the escape hatch to `src/env.ts`**

Add as the last property of the `createEnv({...})` object, after
`experimental__runtimeEnv: {}`:

```ts
  // The container image builds without a database or OAuth credentials. Runtime
  // validation still runs: src/instrumentation.ts imports this module on server
  // start, and SKIP_ENV_VALIDATION is set only in the Docker builder stage.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
```

- [ ] **Step 3: Add standalone output to `next.config.ts`**

Replace the `nextConfig` declaration with:

```ts
const nextConfig: NextConfig = {
  // Self-hosted on Coolify: emit .next/standalone so the runtime image carries
  // only the server and its traced dependencies.
  output: "standalone",
};
```

- [ ] **Step 4: Verify the build succeeds with no env at all**

```bash
SKIP_ENV_VALIDATION=1 DATABASE_URL="postgres://build:build@127.0.0.1:5432/build" \
  pnpm build
```

Expected: build completes and `.next/standalone/server.js` exists.

The dummy `DATABASE_URL` is required and is not a workaround for lazy validation.
`src/db/index.ts:8` throws when the variable is missing and `postgres()` on line
11 parses it, both at module scope. Next imports those modules while collecting
route data, so a missing or unparseable value fails the build with
`Failed to collect page data for /api/cron/rank-submit`. postgres-js connects
lazily, so a syntactically valid URL pointing nowhere is enough. Task 4's builder
stage sets the same pair.

**Resolved 2026-08-26:** the spec's open question about prerendering is answered.
The build reports every app route as `ƒ (Dynamic)`; only `/icon.svg` and
`/robots.txt` are static. Nothing is prerendered against the database, so
`export const dynamic = "force-dynamic"` is not needed anywhere.

- [ ] **Step 5: Confirm the standalone output**

```bash
test -f .next/standalone/server.js && echo "standalone OK"
```

Expected: `standalone OK`.

- [ ] **Step 6: Commit**

```bash
git add next.config.ts src/env.ts
git commit -m "build: emit standalone output and allow env validation skip at build time"
```

---

## Task 3: Retire Vercel configuration

`vercel.json` holds the cron schedules that the running app reads for its cadence
display. It becomes `crons.json` and loses the Vercel-only keys.

**Files:**
- Rename: `vercel.json` → `crons.json`
- Modify: `src/lib/cronSchedule.ts`, `scripts/local-cron.ts`
- Delete: `scripts/deploy/migrate-if-production.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: `crons.json` at the repo root with shape
  `{ "crons": [{ "path": string, "schedule": string }] }`, read by both
  `src/lib/cronSchedule.ts` and `scripts/local-cron.ts` through
  `join(process.cwd(), "crons.json")`. Task 4 copies it into both images.

- [ ] **Step 1: Record the current behaviour to compare against**

```bash
pnpm exec tsx -e 'import {describeCronInterval} from "./src/lib/cronSchedule"; console.log(describeCronInterval("/api/cron/health"), "|", describeCronInterval("/api/cron/rank-poll"))'
```

Expected: `every 1 minute | every 10 minutes`. This must still hold at Step 5.

- [ ] **Step 2: Rename the file and strip the Vercel keys**

```bash
git mv vercel.json crons.json
```

Then edit `crons.json` to drop `buildCommand`, keeping only:

```json
{
  "crons": [
    { "path": "/api/cron/health", "schedule": "* * * * *" },
    { "path": "/api/cron/discover-pages", "schedule": "0 5 * * *" },
    { "path": "/api/cron/drift", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/compliance", "schedule": "0 4 * * *" },
    { "path": "/api/cron/preview", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/rank-submit", "schedule": "0 3 * * *" },
    { "path": "/api/cron/rank-poll", "schedule": "*/10 * * * *" }
  ]
}
```

- [ ] **Step 3: Update `src/lib/cronSchedule.ts`**

Rename the interfaces `VercelCronEntry` → `CronEntry` and `VercelConfig` →
`CronConfig` (updating both usages), and change line 18:

```ts
  const configPath = join(process.cwd(), "crons.json");
```

- [ ] **Step 4: Update `scripts/local-cron.ts`**

Same interface renames, then replace lines 18-19:

```ts
const cronConfigPath = join(process.cwd(), "crons.json");
const config = JSON.parse(readFileSync(cronConfigPath, "utf-8")) as CronConfig;
```

And line 23's message:

```ts
  console.log("no cron entries found in crons.json");
```

The `APP_URL` default on line 14 stays; the compose file overrides it with the
internal hostname.

- [ ] **Step 5: Verify nothing changed behaviourally**

```bash
pnpm exec tsx -e 'import {describeCronInterval} from "./src/lib/cronSchedule"; console.log(describeCronInterval("/api/cron/health"), "|", describeCronInterval("/api/cron/rank-poll"))'
grep -rn "vercel" src scripts --include="*.ts" || echo "NO VERCEL REFS"
pnpm lint
```

Expected: `every 1 minute | every 10 minutes`, then `NO VERCEL REFS`, then lint
passes.

- [ ] **Step 6: Delete the Vercel build hook**

```bash
git rm scripts/deploy/migrate-if-production.sh
rmdir scripts/deploy 2>/dev/null || true
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: replace vercel.json with crons.json as the schedule source"
```

---

## Task 4: Dockerfile and entrypoint

Three stages. `builder` compiles once; `runner` and `cron` both start from it, so
the pnpm install is shared. `tsx` is a devDependency and absent from the traced
standalone bundle, so the migrator and the cron runner each get their own small
`node_modules` in a directory of their own, well away from the standalone tree.

**Files:**
- Create: `Dockerfile`, `docker-entrypoint.sh`

**Interfaces:**
- Consumes: `.next/standalone` from Task 2, `crons.json` from Task 3.
- Produces: two build targets. `--target runner` exposes port 3000 and runs
  `docker-entrypoint.sh`; `--target cron` runs `scripts/local-cron.ts` against
  `$APP_URL`. Task 5's compose file selects between them with `target:`.

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
# Heimdall for self-hosting on Coolify. Built from the repo root as a Docker
# Compose resource; see docker-compose.prod.yml.

# ---- builder: install dependencies and build the standalone server ----
FROM node:22-slim AS builder
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# The image build has no database and no OAuth credentials. Runtime validation is
# unaffected: src/instrumentation.ts imports src/env on server start, and this
# variable is confined to this stage.
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runner: standalone server plus a self-contained migrator ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Read at runtime by src/lib/cronSchedule.ts for the cadence shown in the UI.
# Next's file tracer does not include it.
COPY --from=builder /app/crons.json ./crons.json

# The migrator lives in its own directory with its own dependencies: tsx is a
# devDependency, and drizzle-orm's migrator is never imported by the app, so
# neither is present in the traced standalone node_modules. Installing here
# instead of /app keeps the two dependency trees from colliding.
WORKDIR /migrate
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate-prod.ts ./migrate-prod.ts
RUN npm init -y > /dev/null \
 && npm install --no-save --no-audit --no-fund \
      tsx@4.23.1 drizzle-orm@0.45.2 postgres@3.4.9

WORKDIR /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# ---- cron: fires the schedules in crons.json against the app ----
FROM node:22-slim AS cron
WORKDIR /cron
ENV NODE_ENV=production
COPY --from=builder /app/crons.json ./crons.json
COPY --from=builder /app/scripts/local-cron.ts ./cron.ts
RUN npm init -y > /dev/null \
 && npm install --no-save --no-audit --no-fund tsx@4.23.1 croner@10.0.1
CMD ["./node_modules/.bin/tsx", "cron.ts"]
```

- [ ] **Step 2: Write `docker-entrypoint.sh`**

```sh
#!/bin/sh
# Apply pending migrations, then hand the container over to the Next.js server.
set -eu

echo "[entrypoint] applying pending migrations"
cd /migrate
./node_modules/.bin/tsx migrate-prod.ts

echo "[entrypoint] starting Next.js"
cd /app
exec node server.js
```

`set -e` plus `scripts/migrate-prod.ts`'s own `process.exit(1)` on failure means
a broken migration stops the container instead of serving against a stale schema.

- [ ] **Step 3: Build both targets**

```bash
docker build --target runner -t heimdall-app:test .
docker build --target cron   -t heimdall-cron:test .
```

Expected: both succeed. A `MODULE_NOT_FOUND` for `@swc/helpers/esm/...` at
container start (Step 4) is the known standalone tracer gap noted in the spec;
port the copy step from `~/Documents/progani/bulkratte/Dockerfile` if it appears.

- [ ] **Step 4: Verify the runner starts and migrates against a real database**

```bash
docker network create heimdall-test 2>/dev/null || true
docker run -d --name heimdall-pg --network heimdall-test \
  -e POSTGRES_USER=heimdall -e POSTGRES_PASSWORD=test -e POSTGRES_DB=heimdall \
  postgres:17-alpine
sleep 5
docker run --rm --network heimdall-test -p 127.0.0.1:$PORT:3000 \
  -e DATABASE_URL="postgres://heimdall:test@heimdall-pg:5432/heimdall" \
  -e AUTH_SECRET=test-secret-not-real \
  -e AUTH_GOOGLE_ID=test -e AUTH_GOOGLE_SECRET=test \
  -e ALLOWED_EMAIL_DOMAIN=progani.com \
  -e AUTH_URL=http://localhost:$PORT -e AUTH_TRUST_HOST=true \
  --name heimdall-app heimdall-app:test
```

Expected in the logs: `[entrypoint] applying pending migrations`, then
`[entrypoint] starting Next.js`, then Next reporting it is ready. In another
shell:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$PORT/login"
```

Expected: `200`. A 500 here means the environment or the migration is wrong, not
Coolify.

- [ ] **Step 5: Tear the test containers down**

```bash
docker rm -f heimdall-app heimdall-pg
docker network rm heimdall-test
docker rmi heimdall-app:test heimdall-cron:test
```

Verify with `docker ps -a | grep heimdall` returning nothing.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-entrypoint.sh
git commit -m "build: add multi-stage Dockerfile with migrating entrypoint and cron target"
```

---

## Task 5: Production compose file

**Files:**
- Create: `docker-compose.prod.yml`

**Interfaces:**
- Consumes: the `runner` and `cron` targets from Task 4.
- Produces: the service name `app`, which Task 6 maps the domain onto, and the
  environment variable names Task 6 sets in Coolify.

- [ ] **Step 1: Write `docker-compose.prod.yml`**

```yaml
# Heimdall production stack for Coolify. Deploy as a "Docker Compose" resource
# with build context = repo root and compose file = /docker-compose.prod.yml.
# Assign heimdall.progani.com to the `app` service (port 3000) in Coolify.
#
# No `networks:` block on purpose: Coolify creates a per-resource network and
# attaches Traefik to it. A custom network leaves Traefik unable to route and
# produces intermittent 504s.

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: runner
    restart: unless-stopped
    expose:
      - "3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: "postgres://heimdall:${SERVICE_PASSWORD_POSTGRES}@postgres:5432/heimdall"
      # Auth.js resolves trustHost from AUTH_URL/AUTH_TRUST_HOST/VERCEL/CF_PAGES.
      # None are set off Vercel, so without these two every sign-in fails with
      # UntrustedHost. See @auth/core lib/utils/env.js.
      AUTH_URL: "https://heimdall.progani.com"
      AUTH_TRUST_HOST: "true"
      AUTH_SECRET: "${AUTH_SECRET}"
      AUTH_GOOGLE_ID: "${AUTH_GOOGLE_ID}"
      AUTH_GOOGLE_SECRET: "${AUTH_GOOGLE_SECRET}"
      ALLOWED_EMAIL_DOMAIN: "${ALLOWED_EMAIL_DOMAIN}"
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
      DATAFORSEO_LOGIN: "${DATAFORSEO_LOGIN}"
      DATAFORSEO_PASSWORD: "${DATAFORSEO_PASSWORD}"
      DISCORD_WEBHOOK_URL: "${DISCORD_WEBHOOK_URL}"
      CRON_SECRET: "${CRON_SECRET}"
    depends_on:
      postgres:
        condition: service_healthy

  # Fires the schedules in crons.json over the internal network, so the jobs keep
  # running when Traefik or DNS is broken and CRON_SECRET never leaves Docker.
  cron:
    build:
      context: .
      dockerfile: Dockerfile
      target: cron
    restart: unless-stopped
    environment:
      APP_URL: "http://app:3000"
      CRON_SECRET: "${CRON_SECRET}"
    depends_on:
      app:
        condition: service_started

  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: heimdall
      POSTGRES_PASSWORD: "${SERVICE_PASSWORD_POSTGRES}"
      POSTGRES_DB: heimdall
    volumes:
      - heimdall-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U heimdall -d heimdall"]
      interval: 5s
      timeout: 5s
      retries: 20

volumes:
  heimdall-postgres-data:
```

- [ ] **Step 2: Verify the file parses and resolves**

```bash
SERVICE_PASSWORD_POSTGRES=x AUTH_SECRET=x AUTH_GOOGLE_ID=x AUTH_GOOGLE_SECRET=x \
ALLOWED_EMAIL_DOMAIN=progani.com GITHUB_TOKEN= DATAFORSEO_LOGIN= \
DATAFORSEO_PASSWORD= DISCORD_WEBHOOK_URL= CRON_SECRET=x \
docker compose -f docker-compose.prod.yml config > /dev/null && echo "COMPOSE OK"
```

Expected: `COMPOSE OK` with no warnings about undefined variables.

- [ ] **Step 3: Confirm no custom network slipped in**

```bash
grep -n "^networks:\|^\s*networks:" docker-compose.prod.yml || echo "NO CUSTOM NETWORK"
```

Expected: `NO CUSTOM NETWORK`.

- [ ] **Step 4: Run the full stack locally**

```bash
SERVICE_PASSWORD_POSTGRES=localtest AUTH_SECRET=local-secret-not-real \
AUTH_GOOGLE_ID=test AUTH_GOOGLE_SECRET=test ALLOWED_EMAIL_DOMAIN=progani.com \
GITHUB_TOKEN= DATAFORSEO_LOGIN= DATAFORSEO_PASSWORD= DISCORD_WEBHOOK_URL= \
CRON_SECRET=localcron \
docker compose -f docker-compose.prod.yml -p heimdall-local up -d --build
```

Then:

```bash
docker compose -p heimdall-local logs cron | head -20
```

Expected: `Heimdall local cron runner — targeting http://app:3000` followed by
seven `scheduled ...` lines. That proves `crons.json` reached the cron image.

```bash
docker compose -p heimdall-local logs app | grep -i "migrations\|ready"
```

Expected: the migration line, then Next reporting ready.

- [ ] **Step 5: Tear the local stack down**

```bash
docker compose -f docker-compose.prod.yml -p heimdall-local down -v
docker ps -a --filter "name=heimdall-local" --format '{{.Names}}'
```

Expected: no output from the second command.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "build: add production compose stack with app, cron and postgres"
```

- [ ] **Step 7: Ask before pushing, then push**

This is the first time the work leaves the machine, and Coolify cannot deploy
until it does. Ask Philipp, then:

```bash
git push origin main
```

---

## Task 6: Create the Coolify resource

**Files:** none in the repo. Everything here is API calls.

**Interfaces:**
- Consumes: the pushed `docker-compose.prod.yml` and `Dockerfile`.
- Produces: a Coolify application UUID, referred to below as `$APP_UUID`, which
  Task 7 deploys and which replaces the stale value in `.env.coolify`.

- [ ] **Step 1: Load credentials**

```bash
COOLIFY_URL="$(grep '^COOLIFY_URL=' .env.coolify | cut -d= -f2- | tr -d '"'"'"'\r')"
COOLIFY_TOKEN="$(grep '^COOLIFY_TOKEN=' .env.coolify | cut -d= -f2- | tr -d '"'"'"'\r')"
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/version"
```

Expected: `4.3.2`. Anything else means the token is wrong or was rotated.

- [ ] **Step 2: Create the project**

```bash
curl -s -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Heimdall","description":"Site monitoring dashboard"}' \
  "$COOLIFY_URL/api/v1/projects"
```

Expected: JSON with a `uuid`. Save it as `$PROJECT_UUID`. Then read its
environment:

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/projects/$PROJECT_UUID"
```

Expected: an `environments` array with one entry named `production`. Save its
`uuid` as `$ENV_UUID`.

- [ ] **Step 3: Create the application**

```bash
curl -s -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_uuid\": \"$PROJECT_UUID\",
    \"environment_uuid\": \"$ENV_UUID\",
    \"server_uuid\": \"f7ivu01e4bgmpi86doc76mvi\",
    \"destination_uuid\": \"ybbk8f805rwfrgitystbxe83\",
    \"github_app_uuid\": \"kgfmnmcn9f1oy8c9nrbw8bpe\",
    \"git_repository\": \"p-runge/heimdall\",
    \"git_branch\": \"main\",
    \"build_pack\": \"dockercompose\",
    \"docker_compose_location\": \"/docker-compose.prod.yml\",
    \"base_directory\": \"/\",
    \"ports_exposes\": \"3000\",
    \"name\": \"heimdall\",
    \"instant_deploy\": false
  }" \
  "$COOLIFY_URL/api/v1/applications/private-github-app"
```

Expected: JSON with a `uuid`. Save as `$APP_UUID`.

A 422 lists the fields the endpoint actually wants; add them and retry. Compare
against the working Bulkratte resource if the shape is unclear:
`curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/applications/e6s3cl5qdlp582boymwc6u7a"`.

- [ ] **Step 4: Set the environment variables**

Generate fresh secrets rather than reusing the Vercel ones:

```bash
AUTH_SECRET_NEW="$(openssl rand -base64 32)"
CRON_SECRET_NEW="$(openssl rand -hex 32)"
```

Read `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `GITHUB_TOKEN`, `DATAFORSEO_LOGIN`,
`DATAFORSEO_PASSWORD` and `DISCORD_WEBHOOK_URL` out of `.env.prod` with the same
`grep | cut` pattern used for the Coolify token. Then POST each one:

```bash
set_env() {
  curl -s -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"$1\",\"value\":\"$2\",\"is_preview\":false}" \
    "$COOLIFY_URL/api/v1/applications/$APP_UUID/envs"
}
read_prod() { grep "^$1=" .env.prod | cut -d= -f2- | tr -d '"'"'"'\r'; }

set_env SERVICE_PASSWORD_POSTGRES "$(openssl rand -hex 24)"
set_env AUTH_SECRET "$AUTH_SECRET_NEW"
set_env CRON_SECRET "$CRON_SECRET_NEW"
set_env ALLOWED_EMAIL_DOMAIN "progani.com"
set_env AUTH_GOOGLE_ID "$(read_prod AUTH_GOOGLE_ID)"
set_env AUTH_GOOGLE_SECRET "$(read_prod AUTH_GOOGLE_SECRET)"
set_env GITHUB_TOKEN "$(read_prod GITHUB_TOKEN)"
set_env DATAFORSEO_LOGIN "$(read_prod DATAFORSEO_LOGIN)"
set_env DATAFORSEO_PASSWORD "$(read_prod DATAFORSEO_PASSWORD)"
set_env DISCORD_WEBHOOK_URL "$(read_prod DISCORD_WEBHOOK_URL)"
```

If any `read_prod` returns empty, check whether that integration is configured at
all. `GITHUB_TOKEN`, `DATAFORSEO_*` and `DISCORD_WEBHOOK_URL` are optional in
`src/env.ts`; the other four are not and an empty value will fail the container's
startup validation.

Do not echo the values. Verify by listing keys only:

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/applications/$APP_UUID/envs" \
  | python3 -c "import sys,json;[print(e['key']) for e in json.load(sys.stdin)]"
```

Expected: `SERVICE_PASSWORD_POSTGRES`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL_DOMAIN`, `CRON_SECRET`, `GITHUB_TOKEN`,
`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `DISCORD_WEBHOOK_URL`.

`AUTH_URL` and `AUTH_TRUST_HOST` are hardcoded in the compose file and need no
entry here.

- [ ] **Step 5: Point `.env.coolify` at the right resource**

Replace the stale Bulkratte UUID:

```bash
sed -i '' "s|^COOLIFY_APP_UUID_PROD=.*|COOLIFY_APP_UUID_PROD=$APP_UUID|" .env.coolify
grep '^COOLIFY_APP_UUID_PROD=' .env.coolify
```

Expected: the new UUID. The file is gitignored, so there is nothing to commit.

---

## Task 7: Deploy and verify on the Coolify subdomain

**Interfaces:**
- Consumes: `$APP_UUID` from Task 6.
- Produces: a running stack proven correct before DNS moves.

- [ ] **Step 1: Trigger the deploy**

```bash
curl -s -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/deploy?uuid=$APP_UUID&force=false"
```

Expected: JSON with a `deployment_uuid`.

- [ ] **Step 2: Watch it to completion**

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/deployments/$DEPLOYMENT_UUID" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('status'))"
```

Expected: eventually `finished`. On `failed`, read the deployment logs from the
same response before changing anything. The likely first-time failures are the
`@swc/helpers` gap from Task 4 Step 3 and a missing environment variable.

- [ ] **Step 3: Find the generated URL and check it responds**

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/applications/$APP_UUID" \
  | python3 -c "import sys,json;a=json.load(sys.stdin);print(a.get('fqdn'),a.get('docker_compose_domains'))"
```

Then, against whichever domain is configured:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://<domain>/login"
```

Expected: `200`. A 500 means the app started but the database or env is wrong;
read the container logs rather than redeploying.

- [ ] **Step 4: Verify sign-in end to end**

Open the URL in a browser, sign in with a `@progani.com` Google account.

Expected: redirect to the dashboard. A screen mentioning `UntrustedHost` means
`AUTH_URL`/`AUTH_TRUST_HOST` did not reach the container.

- [ ] **Step 5: Verify the data path**

Create a client and a site through the UI.

Expected: within a minute of adding a site, the site's detail page shows a health
check result, and the page shows the cadence text "every 1 minute". The health
result proves the `cron` container reaches the app over the internal network with
a matching `CRON_SECRET`; the cadence text proves `crons.json` made it into the
runtime image.

There is no shell access to the Coolify host from here, only the API. If no
health result appears, read the container logs through Coolify rather than
guessing:

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/applications/$APP_UUID/logs?lines=200"
```

A 401 from `/api/cron/health` in those logs means `CRON_SECRET` differs between
the `app` and `cron` services, which cannot happen through the compose file and
points at a stray per-service override in Coolify.

- [ ] **Step 6: Verify the volume survives a restart**

Restart the stack from the Coolify UI, then reload the dashboard.

Expected: the client and site created in Step 5 are still there. If they are
gone, the volume is not wired up and nothing else matters.

---

## Task 8: DNS cutover

- [ ] **Step 1: Hand off to Philipp**

The Coolify API reports the server's IP as `host.docker.internal`, which is its
own view from inside the container, not a routable address. Get the real one from
the instance's own hostname:

```bash
dig +short coolify.progani.com
```

Give him that address and tell him the stack is verified. He changes the
`heimdall.progani.com` record at the registrar. This is the one step outside the
repo and Coolify.

- [ ] **Step 2: Set the production domain in Coolify**

```bash
curl -s -X PATCH -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"docker_compose_domains":"{\"app\":{\"domain\":\"https://heimdall.progani.com\"}}"}' \
  "$COOLIFY_URL/api/v1/applications/$APP_UUID"
```

Then redeploy so Traefik picks up the new router.

- [ ] **Step 3: Verify the real domain**

```bash
dig +short heimdall.progani.com
curl -s -o /dev/null -w "%{http_code} %{ssl_verify_result}\n" https://heimdall.progani.com/login
```

Expected: the Coolify server's IP, then `200 0` (`ssl_verify_result` of 0 means
the Let's Encrypt certificate is valid). Certificate issuance can take a minute
after the record propagates.

- [ ] **Step 4: Sign in on the production domain**

Expected: sign-in works. This is the same check as Task 7 Step 4 but against the
domain registered with Google OAuth, so it also proves the redirect URI matches.

---

## Task 9: Decommission Vercel and Neon

Do not start this until Task 8 passes. Every step destroys something.

- [ ] **Step 1: Confirm with Philipp** that the Coolify deployment has been
  running correctly for long enough to trust, and that he wants the old
  infrastructure removed. Ask separately for Vercel and for Neon.

- [ ] **Step 2: Remove the Vercel project** only on explicit approval.

- [ ] **Step 3: Remove the Neon database** only on explicit approval. Once it is
  gone the data is unrecoverable, which is acceptable only because the migration
  deliberately started from an empty database.

- [ ] **Step 4: Remind Philipp to rotate the Coolify API token**, which he
  deferred to the end of the migration.

- [ ] **Step 5: Prune the repo**

```bash
rm -rf .vercel
git status --short
```

`.vercel/` is the local link to the deleted Vercel project. Check whether it is
gitignored before committing anything.

---

## Deferred, not in this plan

Both are in the spec and neither blocks the migration.

**Backups.** All data will sit in one Docker volume on one server with no second
copy. Bulkratte's `services/backup/` (restic to Cloudflare R2, nightly) is a
working template to adapt.

**Database-outage blast radius.** The outage that started this work took out
`/login` too, because the root layout queries the database on every render.
Wrapping `AlertsNavLink` so a failed query degrades instead of failing the render,
plus an `error.tsx`, would keep a readable page up next time.

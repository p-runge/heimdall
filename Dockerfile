# syntax=docker/dockerfile:1
# Heimdall for self-hosting on Coolify. Built from the repo root as a Docker
# Compose resource; see docker-compose.prod.yml.

# ---- builder: install dependencies and build the standalone server ----
FROM node:22-slim AS builder
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# The image build has no database and no OAuth credentials, so validation is
# skipped here. Runtime validation is unaffected: src/instrumentation.ts imports
# src/env on server start, and this variable is confined to this stage.
#
# DATABASE_URL is still required despite that skip. src/db/index.ts throws when
# it is missing and calls postgres() on it, both at module scope, and Next
# imports that module while collecting route data. postgres-js connects lazily,
# so a syntactically valid URL pointing nowhere is enough.
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
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
# Next's tracer already picks this up, but the app is unusable without it, so
# copy it explicitly rather than depending on tracer behaviour.
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

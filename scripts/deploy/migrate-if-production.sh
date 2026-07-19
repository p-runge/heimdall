#!/usr/bin/env bash
set -euo pipefail

# Runs pending Drizzle migrations before the build, but only for real Vercel
# Production deployments — Preview/Development builds share the same DATABASE_URL
# (no per-branch DB), so they must never touch it.
#
# VERCEL_ENV is set automatically by Vercel during the build step (production |
# preview | development). It is unset for local builds, so this is a no-op locally.

# Load environment variables from .env.local or .env for local testing/simulation.
# On Vercel, these files don't exist and env vars are already injected — no-op there.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
elif [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "🚀 VERCEL_ENV=production — applying pending database migrations..."
  pnpm db:migrate:prod
else
  echo "⏭️  VERCEL_ENV=${VERCEL_ENV:-<unset>} — skipping database migrations."
fi

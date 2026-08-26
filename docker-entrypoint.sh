#!/bin/sh
# Apply pending migrations, then hand the container over to the Next.js server.
set -eu

echo "[entrypoint] applying pending migrations"
cd /migrate
./node_modules/.bin/tsx migrate-prod.ts

echo "[entrypoint] starting Next.js"
cd /app
exec node server.js

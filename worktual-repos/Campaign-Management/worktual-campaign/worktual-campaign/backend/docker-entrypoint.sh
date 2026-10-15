#!/bin/sh
set -e

cd /app/backend

if [ "${RUN_DB_MIGRATE:-0}" = "1" ]; then
  echo "[backend] Running prisma migrate deploy..."
  npx prisma migrate deploy
fi

exec "$@"

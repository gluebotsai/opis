#!/bin/sh
set -e
if [ "$1" = "uvicorn" ] || [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  alembic upgrade head
fi
exec "$@"

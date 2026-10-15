#!/usr/bin/env bash
# Start backends with public API prefixes + web with VITE_* prefix env, then run Playwright.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PORTS="3000 3001 3002 3004 5173 8000"
echo "Stopping services on ports: $PORTS"
for port in $PORTS; do
  lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
done
sleep 2

LOG_DIR="${TMPDIR:-/tmp}/ccaas-prefix-e2e-$$"
mkdir -p "$LOG_DIR"
: >"$LOG_DIR/pids"

start_service() {
  local name="$1"
  shift
  echo "Starting $name..."
  (cd "$ROOT" && "$@") >"$LOG_DIR/$name.log" 2>&1 &
  echo $! >>"$LOG_DIR/pids"
}

cleanup() {
  if [[ -n "${WEB_ENV_BACKUP:-}" && -f "$WEB_ENV_BACKUP" ]]; then
    cp "$WEB_ENV_BACKUP" apps/web/.env
  fi
  if [[ -f "$LOG_DIR/pids" ]]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null || true
    done <"$LOG_DIR/pids"
  fi
}
trap cleanup EXIT

start_service cc-core sh -c \
  'cd apps/cc-core && API_V1_PUBLIC_BASE=/cc-core-api/v1 SOCKET_IO_PATH=/cc-core-api/socket.io npx tsx src/index.ts'
start_service platform sh -c \
  'cd apps/platform-service && API_V1_PUBLIC_BASE=/platform-api/v1 npx tsx src/index.ts'
start_service nlp sh -c \
  'cd apps/nlp && API_V1_PUBLIC_BASE=/nlp-api/v1 UV_CACHE_DIR=.uv-cache uv run uvicorn app.main:app --app-dir src --host 0.0.0.0 --port 8000'
start_service social sh -c \
  'cd apps/social-service && WEBHOOK_PUBLIC_PREFIX=/social-api PORT=3004 npx tsx src/index.ts'
start_service chat npm run dev:chat-service

WEB_ENV_BACKUP=""
if [[ -f apps/web/.env ]]; then
  WEB_ENV_BACKUP="$LOG_DIR/web.env.bak"
  cp apps/web/.env "$WEB_ENV_BACKUP"
fi
cp apps/web/.env.prefix apps/web/.env
start_service web sh -c 'cd apps/web && npm run dev'

wait_for() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 90); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "$label ready"
      return 0
    fi
    sleep 1
  done
  echo "FAILED: $label not ready ($url)" >&2
  tail -30 "$LOG_DIR/$label.log" 2>/dev/null || tail -30 "$LOG_DIR"/*.log >&2 || true
  exit 1
}

wait_for "http://localhost:3000/health" "cc-core"
wait_for "http://localhost:3001/health" "platform"
wait_for "http://localhost:8000/health" "nlp"
wait_for "http://localhost:5173" "web"

echo "Running Playwright prefix-path E2E..."
PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e -w web -- e2e/prefix-api-paths.spec.ts

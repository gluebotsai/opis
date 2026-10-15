#!/usr/bin/env bash
# meeting-service on host :8050 (docker-compose.local.yml) — frees :8030 for QA SSH tunnels.
# Set root .env MEETING_SERVICE_URL=http://127.0.0.1:8050 and restart Vite after this.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MS="$ROOT/meeting-service"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.local.yml)

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon unreachable (Colima often shows 'running' while docker.sock is stale)."
  echo "Try: colima start   # or open Docker Desktop"
  echo "Then: docker info"
  exit 1
fi

if [[ ! -f "$MS/.env" ]]; then
  echo "Missing $MS/.env — copy meeting-service/.env.example and set CRM_BOT_API_KEY, VEXA_*, etc."
  exit 1
fi

if [[ -f "$ROOT/.env" ]]; then
  "$ROOT/scripts/sync-meeting-service-env.sh" "$ROOT/.env" "$MS/.env"
fi

cd "$MS"
"${COMPOSE[@]}" up -d --build postgres redis whisper-adapter meeting-service meeting-worker

echo "Waiting for http://127.0.0.1:8050/healthz ..."
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8050/healthz >/dev/null 2>&1; then
    echo "meeting-service up on :8050"
    if grep -q '^MEETING_SERVICE_URL=http://127.0.0.1:8030' "$ROOT/.env" 2>/dev/null; then
      echo ""
      echo "Update root .env for Vite proxy:"
      echo "  MEETING_SERVICE_URL=http://127.0.0.1:8050"
      echo "Then restart dev:  $ROOT/scripts/down-dev.sh && $ROOT/scripts/up-dev.sh"
    fi
    echo ""
    echo "Smoke:  $ROOT/scripts/verify-meeting-assist-local.sh"
    exit 0
  fi
  sleep 2
done

echo "ERROR: meeting-service did not become healthy — ${COMPOSE[*]} logs meeting-service"
exit 1

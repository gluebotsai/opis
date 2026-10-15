#!/usr/bin/env bash
# meeting-service stack in Docker only (Postgres, Redis, whisper-adapter, API, worker).
# CRM stays native via ./scripts/up-dev.sh — set MEETING_SERVICE_URL=http://127.0.0.1:8030 in root .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MS="$ROOT/meeting-service"

docker context use colima >/dev/null 2>&1 || true
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon unreachable (Colima often shows 'running' while docker.sock is missing)."
  echo ""
  echo "Recovery (run in order; stop when docker info shows a Server section):"
  echo "  docker context use colima"
  echo "  colima stop && sleep 3 && colima start"
  echo "  docker info"
  echo ""
  echo "If you see 'configuration errors' or 'instance is stopped' after restart:"
  echo "  colima stop"
  echo "  colima delete    # removes the Colima VM only — re-pull images on next up"
  echo "  colima start --cpu 4 --memory 8"
  echo "  docker context use colima && docker info"
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
# Bring up the full stack so worker/API share the compose network with postgres/redis.
# After Colima restarts, a stale worker often loses DNS for host "postgres".
docker compose up -d --build postgres redis whisper-adapter vexa-postgres vexa-minio vexa-minio-init vexa-lite meeting-service meeting-worker

echo "Waiting for http://127.0.0.1:8030/healthz ..."
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8030/healthz >/dev/null 2>&1; then
    echo "meeting-service up on :8030 (Vite proxies /addons/meet → MEETING_SERVICE_URL)"
    if ! docker compose exec -T meeting-worker python -c "import socket; socket.gethostbyname('postgres')" >/dev/null 2>&1; then
      echo "Recreating meeting-worker (postgres DNS failed — common after colima restart)..."
      docker compose up -d --force-recreate meeting-worker
      sleep 3
    fi
    if docker compose exec -T meeting-worker python -c "import socket; socket.gethostbyname('postgres')" >/dev/null 2>&1; then
      echo "meeting-worker can reach postgres"
      echo "Patching vexa-lite for live PCM (stock image has no Worktual forwarder)..."
      ./scripts/patch-vexa-live-pcm.sh || echo "WARN: live-PCM patch failed — docker logs vexa-lite"
    else
      echo "WARN: meeting-worker still cannot resolve postgres — run:"
      echo "  cd $MS && docker compose down && docker compose up -d --build"
    fi
    exit 0
  fi
  sleep 2
done

echo "ERROR: meeting-service did not become healthy — docker compose logs meeting-service"
exit 1

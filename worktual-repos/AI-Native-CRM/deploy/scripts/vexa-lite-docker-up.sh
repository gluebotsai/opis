#!/usr/bin/env bash
# Vexa Lite "make up" without GNU make — same as vendor/vexa/deploy/lite/Makefile up.
# Usage: VEXA_ENV=/path/to/vendor/vexa/.env HOST_GATEWAY_PORT=18056 bash deploy/scripts/vexa-lite-docker-up.sh
set -euo pipefail

ENV_FILE="${VEXA_ENV:?Set VEXA_ENV to vendor/vexa/.env}"
HOST_GATEWAY_PORT="${HOST_GATEWAY_PORT:-18056}"
# Terminal/agent UIs are optional for CRM notetaker; leave unset to avoid host port clashes.
HOST_TERMINAL_PORT="${HOST_TERMINAL_PORT:-}"
HOST_AGENT_PORT="${HOST_AGENT_PORT:-}"
MINIO_IMAGE="${MINIO_IMAGE:-quay.io/minio/minio:latest}"
NETWORK="${VEXA_LITE_NETWORK:-vexa-lite-net}"
PG_CONTAINER="${VEXA_PG_CONTAINER:-vexa-lite-postgres}"
MINIO_CONTAINER="${VEXA_MINIO_CONTAINER:-vexa-lite-minio}"
APP_CONTAINER="${VEXA_APP_CONTAINER:-vexa-lite}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-vexa-access-key}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-vexa-secret-key}"
MINIO_BUCKET="${MINIO_BUCKET:-vexa}"
DOCKERHUB_USER="${DOCKERHUB_USER:-vexaai}"
IMAGE_NAME="${IMAGE_NAME:-vexa-lite}"
LOCAL_TAG="${LOCAL_TAG:-vexa-lite:dev}"

docker info >/dev/null 2>&1 || { echo "ERROR: Docker is not running." >&2; exit 1; }

envv() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*//; s/[[:space:]]+$//'
}

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

ADMIN_TK="$(envv ADMIN_TOKEN)"
TX_URL="$(envv TRANSCRIPTION_SERVICE_URL)"
TX_TOKEN="$(envv TRANSCRIPTION_SERVICE_TOKEN)"
IMAGE_TAG="$(envv IMAGE_TAG)"
IMAGE_TAG="${IMAGE_TAG:-v012}"
if docker image inspect "$LOCAL_TAG" >/dev/null 2>&1; then
  IMG="$LOCAL_TAG"
else
  IMG="${DOCKERHUB_USER}/${IMAGE_NAME}:${IMAGE_TAG}"
fi

CLAUDE_MOUNT=()
if [[ -f "${HOME}/.claude/.credentials.json" ]]; then
  echo "  Mounting Claude credentials into Vexa Lite"
  CLAUDE_MOUNT=(
    -v "${HOME}/.claude/.credentials.json:/var/lib/vexa/host-claude-credentials:ro"
    -e "HOST_CLAUDE_CREDENTIALS=/var/lib/vexa/host-claude-credentials"
  )
fi

echo "Starting PostgreSQL ($PG_CONTAINER)..."
if ! docker ps -q -f "name=^/${PG_CONTAINER}$" | grep -q .; then
  docker rm -f "$PG_CONTAINER" 2>/dev/null || true
  docker run -d --name "$PG_CONTAINER" --network "$NETWORK" --restart unless-stopped \
    -e POSTGRES_DB=vexa -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e TZ=UTC -e PGTZ=UTC \
    -v vexa-lite-pgdata:/var/lib/postgresql/data \
    postgres:17-alpine -c idle_in_transaction_session_timeout=60000 >/dev/null
  for _ in $(seq 1 24); do
    docker exec "$PG_CONTAINER" pg_isready -U postgres -d vexa -q 2>/dev/null && break
    sleep 2
  done
fi
echo "  ✓ PostgreSQL ready"

echo "Starting MinIO ($MINIO_CONTAINER)..."
if ! docker ps -q -f "name=^/${MINIO_CONTAINER}$" | grep -q .; then
  docker rm -f "$MINIO_CONTAINER" 2>/dev/null || true
  docker run -d --name "$MINIO_CONTAINER" --network "$NETWORK" --restart unless-stopped \
    -e "MINIO_ROOT_USER=${MINIO_ACCESS_KEY}" -e "MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY}" \
    -v vexa-lite-miniodata:/data \
    "$MINIO_IMAGE" server /data --console-address ":9001" >/dev/null
  sleep 4
  docker run --rm --network "$NETWORK" --entrypoint sh quay.io/minio/mc:latest -c \
    "mc alias set vexa http://${MINIO_CONTAINER}:9000 ${MINIO_ACCESS_KEY} ${MINIO_SECRET_KEY} && mc mb --ignore-existing vexa/${MINIO_BUCKET}" >/dev/null 2>&1 || true
fi
echo "  ✓ MinIO ready"

PORT_ARGS=(-p "${HOST_GATEWAY_PORT}:8056")
if [[ -n "$HOST_TERMINAL_PORT" ]]; then
  PORT_ARGS+=(-p "${HOST_TERMINAL_PORT}:3001")
fi
if [[ -n "$HOST_AGENT_PORT" ]]; then
  PORT_ARGS+=(-p "${HOST_AGENT_PORT}:8100")
fi

echo "Starting Vexa Lite ($IMG)..."
docker rm -f "$APP_CONTAINER" 2>/dev/null || true
docker run -d --name "$APP_CONTAINER" --shm-size=2g --network "$NETWORK" --restart unless-stopped \
  --env-file "$ENV_FILE" \
  "${PORT_ARGS[@]}" \
  -e "DB_HOST=${PG_CONTAINER}" -e DB_PORT=5432 -e DB_NAME=vexa -e DB_USER=postgres -e DB_PASSWORD=postgres \
  -e "ADMIN_API_TOKEN=${ADMIN_TK}" -e "ADMIN_TOKEN=${ADMIN_TK}" \
  -e "TRANSCRIPTION_SERVICE_URL=${TX_URL}" -e "TRANSCRIPTION_SERVICE_TOKEN=${TX_TOKEN}" \
  -e "MINIO_ENDPOINT=${MINIO_CONTAINER}:9000" -e "MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}" \
  -e "MINIO_SECRET_KEY=${MINIO_SECRET_KEY}" -e "MINIO_BUCKET=${MINIO_BUCKET}" -e MINIO_SECURE=false \
  -e "VEXA_PUBLIC_API_URL=http://localhost:${HOST_GATEWAY_PORT}" \
  -e "TERMINAL_PUBLIC_URL=http://localhost:${HOST_TERMINAL_PORT}" \
  "${CLAUDE_MOUNT[@]}" \
  "$IMG" >/dev/null

echo "  Waiting for gateway (up to 3 min)..."
for _ in $(seq 1 36); do
  curl -sf -o /dev/null "http://127.0.0.1:${HOST_GATEWAY_PORT}/health" 2>/dev/null && break
  sleep 5
done
curl -sf -o /dev/null "http://127.0.0.1:${HOST_GATEWAY_PORT}/health" || {
  echo "ERROR: gateway not healthy on :${HOST_GATEWAY_PORT} — docker logs ${APP_CONTAINER} --tail 80" >&2
  exit 1
}
echo "  ✓ Vexa Lite running on http://127.0.0.1:${HOST_GATEWAY_PORT}"

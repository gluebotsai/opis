#!/usr/bin/env bash
# Vexa must call the whisper-adapter with worktual-large-v3 (see deploy/vexa.env.example).
# The adapter remaps whisper-1 → worktual-large-v3, but set TRANSCRIPTION_MODEL on Vexa anyway.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${VEXA_CONTAINER:-vexa-lite}"

echo "=== Whisper adapter preflight (host :8032) ==="
if ! curl -fsS "http://127.0.0.1:8032/healthz" >/dev/null 2>&1; then
  echo "Start meeting-service compose first: cd $ROOT && docker compose up -d whisper-adapter" >&2
  exit 1
fi
curl -fsS "http://127.0.0.1:8032/healthz"
echo

echo "=== Minio bucket for Vexa audio (vexa-lite-minio / vexa) ==="
MINIO_CTR="${VEXA_MINIO_CONTAINER:-vexa-lite-minio}"
if docker inspect "$MINIO_CTR" >/dev/null 2>&1; then
  # Audio chunks fail with NoSuchBucket when this is missing — live coach then
  # never sees customer speech even though the bot is in the Meet room.
  docker exec "$MINIO_CTR" sh -c \
    'mc alias set local http://127.0.0.1:9000 "${MINIO_ROOT_USER:-vexa-access-key}" "${MINIO_ROOT_PASSWORD:-vexa-secret-key}" >/dev/null && mc mb --ignore-existing local/vexa && mc ls local/vexa >/dev/null && echo "bucket vexa: ok"' \
    || echo "WARN: could not ensure Minio bucket 'vexa' on $MINIO_CTR" >&2
else
  echo "Container $MINIO_CTR not running — skip Minio check."
fi
echo

echo "=== Vexa transcription env (container: $CONTAINER) ==="
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^TRANSCRIPTION_' || true
  docker network inspect crm-meetings >/dev/null 2>&1 && \
    docker network connect crm-meetings "$CONTAINER" 2>/dev/null || true
else
  echo "Container $CONTAINER not running — skip inspect."
fi

cat <<'EOF'

Required on the Vexa stack (.env), then recreate vexa-lite:

  TRANSCRIPTION_SERVICE_URL=http://whisper-adapter:8000
  TRANSCRIPTION_SERVICE_TOKEN=EMPTY
  TRANSCRIPTION_MODEL=worktual-large-v3

If Vexa cannot resolve whisper-adapter, use host publish port instead:

  TRANSCRIPTION_SERVICE_URL=http://host.docker.internal:8032

GPU upstream (adapter only — do not point Vexa here):

  http://173.234.75.165:7789/v1/audio/translations
  model worktual-large-v3, Authorization Bearer EMPTY

Rebuild adapter after code changes:

  cd meeting-service && docker compose up -d --build whisper-adapter

EOF

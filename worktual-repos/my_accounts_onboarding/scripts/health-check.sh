#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-config.sh"

MAIL_API_URL="${MAIL_API_URL:-http://127.0.0.1:${MAIL_API_PORT}}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:${FRONTEND_PORT}}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT:-8000}}"
CHECK_BACKEND="${CHECK_BACKEND:-false}"

RETRIES="${HEALTH_CHECK_RETRIES:-30}"
SLEEP_SECONDS="${HEALTH_CHECK_INTERVAL:-2}"

log() {
  printf '[health-check] %s\n' "$*"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempt=1

  while (( attempt <= RETRIES )); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      log "$name is healthy ($url)"
      return 0
    fi

    log "Waiting for $name ($attempt/$RETRIES)..."
    sleep "$SLEEP_SECONDS"
    attempt=$((attempt + 1))
  done

  log "ERROR: $name failed health check ($url)"
  return 1
}

log "Starting health checks"

wait_for_http "mail-api" "${MAIL_API_URL}/api/payments/config"

if [[ "${SERVE_FRONTEND_ON_MAIL_API:-true}" == "true" ]]; then
  wait_for_http "spa-on-mail-api" "${MAIL_API_URL}/"
else
  wait_for_http "frontend" "${FRONTEND_URL}/"
fi

if [[ "$CHECK_BACKEND" == "true" ]]; then
  wait_for_http "backend" "${BACKEND_URL}/health"
fi

log "All health checks passed"

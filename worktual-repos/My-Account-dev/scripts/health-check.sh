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

extract_release_id() {
  printf '%s' "${1:-}" | sed -n 's/.*"releaseId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

verify_served_release() {
  local meta_file="${DEPLOY_ROOT}/current/dist/deploy-meta.json"
  local expected_release=""
  local attempt=1
  local meta_json=""
  local served_release=""

  # Older releases (and rollbacks to them) have no stamp — don't block health.
  if [[ ! -f "$meta_file" ]]; then
    log "No ${meta_file} — skipping release stamp check"
    return 0
  fi

  expected_release="$(extract_release_id "$(cat "$meta_file")")"
  if [[ -z "$expected_release" && -f "${DEPLOY_ROOT}/current-release.txt" ]]; then
    expected_release="$(tr -d '[:space:]' <"${DEPLOY_ROOT}/current-release.txt")"
  fi

  if [[ -z "$expected_release" ]]; then
    log "WARN: deploy-meta.json present but releaseId missing — skipping stamp check"
    return 0
  fi

  log "Verifying served release matches ${expected_release}"

  while (( attempt <= RETRIES )); do
    # Prefer the static stamp file (works even if /api/deploy-meta is absent on mixed rollbacks).
    meta_json="$(curl -fsS --max-time 5 "${MAIL_API_URL}/deploy-meta.json" 2>/dev/null || true)"
    if [[ -z "$meta_json" ]]; then
      meta_json="$(curl -fsS --max-time 5 "${MAIL_API_URL}/api/deploy-meta" 2>/dev/null || true)"
    fi

    served_release="$(extract_release_id "$meta_json")"
    if [[ -n "$served_release" ]]; then
      if [[ "$served_release" == "$expected_release" ]]; then
        log "Served release matches (${served_release})"
        return 0
      fi
      log "ERROR: Served release ${served_release} != expected ${expected_release}"
      log "Mail API is still on an old build — check systemd and whatever holds port ${MAIL_API_PORT}."
      return 1
    fi

    log "Waiting for deploy-meta from mail-api ($attempt/$RETRIES)..."
    sleep "$SLEEP_SECONDS"
    attempt=$((attempt + 1))
  done

  log "ERROR: deploy-meta.json exists on disk but mail-api is not serving it"
  log "Disk stamp: ${meta_file}"
  log "This usually means an old Node process is still bound to port ${MAIL_API_PORT}."
  return 1
}

log "Starting health checks"

wait_for_http "mail-api" "${MAIL_API_URL}/api/payments/config"

if [[ "${SERVE_FRONTEND_ON_MAIL_API:-true}" == "true" ]]; then
  wait_for_http "spa-on-mail-api" "${MAIL_API_URL}/"
else
  wait_for_http "frontend" "${FRONTEND_URL}/"
fi

verify_served_release

if [[ "$CHECK_BACKEND" == "true" ]]; then
  wait_for_http "backend" "${BACKEND_URL}/health"
fi

log "All health checks passed"

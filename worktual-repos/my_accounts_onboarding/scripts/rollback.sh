#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-config.sh"
CURRENT_LINK="$DEPLOY_ROOT/current"
PREVIOUS_LINK="$DEPLOY_ROOT/previous"

log() {
  printf '[rollback] %s\n' "$*"
}

fail() {
  printf '[rollback] ERROR: %s\n' "$*" >&2
  exit 1
}

main() {
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/ensure-prerequisites.sh"
  ensure_prerequisites

  [[ -L "$PREVIOUS_LINK" ]] || fail "No previous release found at ${PREVIOUS_LINK}"

  local current_release previous_release

  current_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  previous_release="$(readlink -f "$PREVIOUS_LINK")"

  [[ -d "$previous_release" ]] || fail "Previous release directory does not exist: ${previous_release}"

  log "Rolling back"
  log "From: ${current_release}"
  log "To:   ${previous_release}"

  if [[ -n "$current_release" && -d "$current_release" ]]; then
    ln -sfn "$current_release" "$PREVIOUS_LINK"
  fi
  ln -sfn "$previous_release" "$CURRENT_LINK"
  echo "$(basename "$previous_release")" >"$DEPLOY_ROOT/current-release.txt"

  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/service-lib.sh"
  restart_app_services "$SCRIPT_DIR/install-systemd.sh"

  CHECK_BACKEND="${DEPLOY_BACKEND:-false}" SERVE_FRONTEND_ON_MAIL_API="${SERVE_FRONTEND_ON_MAIL_API:-true}" \
    "$SCRIPT_DIR/health-check.sh"

  log "Rollback completed successfully"
}

main "$@"

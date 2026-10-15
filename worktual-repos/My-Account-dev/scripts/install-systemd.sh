#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-config.sh"

DEPLOY_USER="${DEPLOY_USER:-$(whoami)}"
SYSTEMD_SCOPE="${SYSTEMD_SCOPE:-system}"

NODE_BIN="$(command -v node)"

log() {
  printf '[install-systemd] %s\n' "$*"
}

fail() {
  printf '[install-systemd] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "$NODE_BIN" ]] || fail "node not found in PATH"

render_unit() {
  local template="$1"
  local output="$2"

  sed \
    -e "s|@@DEPLOY_ROOT@@|${DEPLOY_ROOT}|g" \
    -e "s|@@DEPLOY_USER@@|${DEPLOY_USER}|g" \
    -e "s|@@NODE_BIN@@|${NODE_BIN}|g" \
    -e "s|@@FRONTEND_PORT@@|${FRONTEND_PORT}|g" \
    "$template" >"$output"
}

install_system_units() {
  local unit_dir systemd_dir
  local tmp

  if [[ "$SYSTEMD_SCOPE" == user ]]; then
    unit_dir="$HOME/.config/systemd/user"
    mkdir -p "$unit_dir"
    systemd_dir="$unit_dir"
    log "Installing user units to ${unit_dir}"
  else
    systemd_dir="/etc/systemd/system"
    log "Installing system units to ${systemd_dir} (requires sudo)"
  fi

  mkdir -p "$DEPLOY_ROOT/logs" "$DEPLOY_ROOT/shared"

  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/write-database-env.sh"
  if [[ -f "$DEPLOY_ROOT/shared/.env" ]] || [[ -n "${DATABASE_URL:-}" ]]; then
    write_database_env "$DEPLOY_ROOT/shared/.env" "$DEPLOY_ROOT/shared/database.env"
    log "Wrote ${DEPLOY_ROOT}/shared/database.env"
  else
    log "WARN: ${DEPLOY_ROOT}/shared/.env missing and DATABASE_URL unset — create .env before starting mail-api"
  fi

  tmp="$(mktemp -d)"

  render_unit "$REPO_ROOT/deploy/systemd/worktual-mail-api.service" "$tmp/worktual-mail-api.service"
  render_unit "$REPO_ROOT/deploy/systemd/worktual-frontend.service" "$tmp/worktual-frontend.service"
  render_unit "$REPO_ROOT/deploy/systemd/worktual.target" "$tmp/worktual.target"

  if [[ "$SYSTEMD_SCOPE" == user ]]; then
    cp "$tmp"/*.service "$tmp"/*.target "$unit_dir/"
    systemctl --user daemon-reload
    systemctl --user enable worktual.target
    systemctl --user enable worktual-mail-api.service worktual-frontend.service
    log "Enable user lingering so services survive logout:"
    log "  sudo loginctl enable-linger ${DEPLOY_USER}"
  else
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/sudo-lib.sh"
    if ! resolve_passwordless_sudo_bins; then
      fail "$(passwordless_sudo_hint "$DEPLOY_USER")"
    fi
    log "Using passwordless sudo: cp=${SUDO_CP_PATH} systemctl=${SUDO_SYSTEMCTL_PATH}"
    sudo_cp "$tmp/worktual-mail-api.service" "$systemd_dir/worktual-mail-api.service"
    sudo_cp "$tmp/worktual-frontend.service" "$systemd_dir/worktual-frontend.service"
    sudo_cp "$tmp/worktual.target" "$systemd_dir/worktual.target"
    sudo_systemctl daemon-reload
    sudo_systemctl enable worktual.target
    sudo_systemctl enable worktual-mail-api.service worktual-frontend.service
  fi

  rm -rf "$tmp"

  log "Systemd units installed."
  log "Start now: ./scripts/start.sh"
}

install_system_units

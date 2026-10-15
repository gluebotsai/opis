#!/usr/bin/env bash
# Manage app processes via systemd (survives GitHub Actions job cleanup).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/deploy-config.sh"
# system = /etc/systemd/system (sudo). user = ~/.config/systemd/user (no sudo).
SYSTEMD_SCOPE="${SYSTEMD_SCOPE:-system}"

MAIL_API_UNIT="${MAIL_API_UNIT:-worktual-mail-api.service}"
FRONTEND_UNIT="${FRONTEND_UNIT:-worktual-frontend.service}"
TARGET_UNIT="${TARGET_UNIT:-worktual.target}"

systemctl_cmd() {
  if [[ "$SYSTEMD_SCOPE" == user ]]; then
    systemctl --user "$@"
  else
    if [[ "$(id -u)" -eq 0 ]]; then
      systemctl "$@"
    else
      # shellcheck disable=SC1091
      source "$SCRIPT_DIR/sudo-lib.sh"
      sudo_systemctl "$@"
    fi
  fi
}

systemd_units_installed() {
  if [[ "$SYSTEMD_SCOPE" == user ]]; then
    [[ -f "${HOME}/.config/systemd/user/${MAIL_API_UNIT}" ]]
    return
  fi

  [[ -f "/etc/systemd/system/${MAIL_API_UNIT}" ]]
}

ensure_systemd_units() {
  local install_script="${1:?install script path required}"

  if systemd_units_installed; then
    return 0
  fi

  echo "[systemd] Units not found — running ${install_script}"
  DEPLOY_ROOT="$DEPLOY_ROOT" SYSTEMD_SCOPE="$SYSTEMD_SCOPE" bash "$install_script"
}

restart_app_services() {
  local install_script="${1:-}"

  if [[ -n "$install_script" ]]; then
    # Always refresh unit files so WorkingDirectory / node path stay in sync with DEPLOY_ROOT.
    echo "[systemd] Refreshing units via ${install_script}"
    DEPLOY_ROOT="$DEPLOY_ROOT" SYSTEMD_SCOPE="$SYSTEMD_SCOPE" bash "$install_script"
  elif ! systemd_units_installed; then
    echo "[systemd] ERROR: Units not installed. Run: ./scripts/install-systemd.sh" >&2
    return 1
  fi

  mkdir -p "$DEPLOY_ROOT/logs"
  systemctl_cmd daemon-reload

  # Always bounce mail-api so it reloads @@DEPLOY_ROOT@@/current after the symlink flip.
  # When the SPA is served from mail-api, stop vite preview so browsers cannot hit a stale :5173.
  if [[ "${SERVE_FRONTEND_ON_MAIL_API:-true}" == "true" ]]; then
    systemctl_cmd stop "$FRONTEND_UNIT" 2>/dev/null || true
    systemctl_cmd stop "$MAIL_API_UNIT" 2>/dev/null || true
  else
    systemctl_cmd stop "$MAIL_API_UNIT" "$FRONTEND_UNIT" 2>/dev/null || true
  fi

  # Kill anything still holding the mail-api port (orphans outside systemd).
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${MAIL_API_PORT}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -t -iTCP:"${MAIL_API_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi

  systemctl_cmd reset-failed "$MAIL_API_UNIT" 2>/dev/null || true
  systemctl_cmd reset-failed "$FRONTEND_UNIT" 2>/dev/null || true
  sleep 1

  if [[ "${SERVE_FRONTEND_ON_MAIL_API:-true}" == "true" ]]; then
    systemctl_cmd start "$MAIL_API_UNIT"
  else
    systemctl_cmd start "$MAIL_API_UNIT" "$FRONTEND_UNIT"
  fi
  sleep 2

  if ! systemctl_cmd is-active --quiet "$MAIL_API_UNIT"; then
    echo "[systemd] ERROR: ${MAIL_API_UNIT} is not active after start" >&2
    systemctl_cmd status "$MAIL_API_UNIT" --no-pager -l || true
    return 1
  fi
}

stop_app_services() {
  if ! systemd_units_installed; then
    return 0
  fi

  systemctl_cmd stop "$FRONTEND_UNIT" "$MAIL_API_UNIT" 2>/dev/null || true
}

status_app_services() {
  if ! systemd_units_installed; then
    echo "[systemd] Units not installed"
    return 1
  fi

  systemctl_cmd status "$MAIL_API_UNIT" --no-pager -l || true
  echo ""
  systemctl_cmd status "$FRONTEND_UNIT" --no-pager -l || true
}

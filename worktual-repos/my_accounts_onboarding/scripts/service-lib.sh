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
    ensure_systemd_units "$install_script"
  elif ! systemd_units_installed; then
    echo "[systemd] ERROR: Units not installed. Run: ./scripts/install-systemd.sh" >&2
    return 1
  fi

  mkdir -p "$DEPLOY_ROOT/logs"
  systemctl_cmd daemon-reload
  systemctl_cmd restart "$MAIL_API_UNIT" "$FRONTEND_UNIT"
  sleep 2
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

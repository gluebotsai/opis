#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/worktual-accounts}"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/service-lib.sh"

stop_app_services
echo "Stopped worktual systemd services"

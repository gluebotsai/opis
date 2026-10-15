#!/usr/bin/env bash
# Back-compat wrapper — logic lives in sudo-lib.sh.

_PASSWORDLESS_SUDO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$_PASSWORDLESS_SUDO_DIR/sudo-lib.sh"

passwordless_sudo_for_systemd_install() {
  resolve_passwordless_sudo_bins
}

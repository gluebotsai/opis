#!/usr/bin/env bash
# Redis + real Sofia UAC smoke: inbound INVITE → InviteRoute → outbound toward Pub/Sub PBX.
# SKIP if Redis or sofia-sip-ua missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${1:-${ROOT}/configs/ur-signaling.sip-smoke.conf.json}"
BUILD_DIR="${BUILD_DIR:-${ROOT}/build}"
SMOKE_BIN="${BUILD_DIR}/tests/ur-signaling-sip-invite-smoke"

if ! pkg-config --exists sofia-sip-ua 2>/dev/null; then
  echo "SKIP: sofia-sip-ua not found (install libsofia-sip-ua-dev)"
  exit 0
fi

# shellcheck source=redis-ping-helper.sh
source "${ROOT}/scripts/redis-ping-helper.sh"
redis_ping_dual_defaults || exit 0

if [[ ! -x "${SMOKE_BIN}" ]]; then
  "${ROOT}/scripts/build.sh"
fi

# Port 5060 needs CAP_NET_BIND_SERVICE / root.
RUNNER=()
if grep -qE ':"[^"]*:5060"' "${CONFIG}" 2>/dev/null; then
  if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null && sudo -n true 2>/dev/null; then
      RUNNER=(sudo -n)
    else
      echo "NOTE: sip.udp_listen is :5060 — may need sudo if bind fails"
    fi
  fi
fi

set +e
"${RUNNER[@]}" "${SMOKE_BIN}" "${CONFIG}"
EC=$?
set -e

if [[ "${EC}" -eq 2 ]]; then
  echo "SKIP: Redis connect failed from smoke binary"
  exit 0
fi

exit "${EC}"

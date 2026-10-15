#!/usr/bin/env bash
# Two RedisClient subscribers both receive one PBX Pub/Sub publish.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${1:-${ROOT}/configs/ur-signaling.local-smoke.json}"
BUILD_DIR="${BUILD_DIR:-${ROOT}/build}"
SMOKE_BIN="${BUILD_DIR}/tests/ur-signaling-dual-subscriber-smoke"

# shellcheck source=redis-ping-helper.sh
source "${ROOT}/scripts/redis-ping-helper.sh"
redis_ping_dual_defaults || exit 0

if [[ ! -x "${SMOKE_BIN}" ]]; then
  "${ROOT}/scripts/build.sh"
fi

set +e
"${SMOKE_BIN}" "${CONFIG}"
EC=$?
set -e

if [[ "${EC}" -eq 2 ]]; then
  echo "SKIP: Redis connect failed from smoke binary"
  exit 0
fi

exit "${EC}"

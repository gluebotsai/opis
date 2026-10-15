#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${ROOT}/build/ur-signaling"
CONFIG="${1:-${ROOT}/configs/ur-signaling.conf.json}"

if [[ ! -x "${BIN}" ]]; then
  "${ROOT}/scripts/build.sh"
fi

exec "${BIN}" "${CONFIG}"
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-${ROOT}/build}"

CXX_COMPILER="${CXX:-}"
if [[ -z "${CXX_COMPILER}" ]]; then
  if command -v g++-12 >/dev/null 2>&1; then
    CXX_COMPILER="g++-12"
  elif command -v g++ >/dev/null 2>&1; then
    CXX_COMPILER="g++"
  else
    echo "error: no g++ / g++-12 found" >&2
    exit 1
  fi
fi

# Prefer WSS-capable Sofia (same default as legacy SGW). Override with UR_SOFIA_PREFIX.
SOFIA_PREFIX_ARGS=()
if [[ -n "${UR_SOFIA_PREFIX:-}" ]]; then
  SOFIA_PREFIX_ARGS+=(-DUR_SOFIA_PREFIX="${UR_SOFIA_PREFIX}")
elif [[ -d "${HOME}/.local/sofia-sip-1.13.17" ]]; then
  SOFIA_PREFIX_ARGS+=(-DUR_SOFIA_PREFIX="${HOME}/.local/sofia-sip-1.13.17")
fi

cmake -S "${ROOT}" -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE:-Release}" \
  -DCMAKE_CXX_COMPILER="${CXX_COMPILER}" \
  "${SOFIA_PREFIX_ARGS[@]}"

cmake --build "${BUILD_DIR}" -j"$(nproc 2>/dev/null || echo 2)"

echo "Built: ${BUILD_DIR}/ur-signaling"
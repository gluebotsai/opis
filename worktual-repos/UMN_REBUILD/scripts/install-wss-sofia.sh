#!/usr/bin/env bash
# Build/install Sofia-SIP with NUTAG_WSS_URL (required for WSS listen on :57344).
#
# Ubuntu distro libsofia-sip-ua lacks NUTAG_WSS_URL. Use either:
#   - SGW tree / vendored third_party/sofia-sip-1.13.17.tar.gz, or
#   - FreeSWITCH sofia-sip v1.13.17 (has NUTAG_WSS_URL / WS+WSS transports).
#
# Source resolution order:
#   1) SOFIA_SRC (explicit directory)
#   2) Common local / staging / cache directories
#   3) Unpack ur-signaling/third_party/sofia-sip-1.13.17.tar.gz (vendored SGW)
#   4) Download FreeSWITCH release tarball (or SOFIA_SRC_URL) into cache
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOFIA_VERSION="${SOFIA_VERSION:-1.13.17}"
# FreeSWITCH fork — Ubuntu/distro Sofia lacks NUTAG_WSS_URL; FS 1.13.17 has it.
SOFIA_SRC_URL_DEFAULT="https://github.com/freeswitch/sofia-sip/archive/refs/tags/v${SOFIA_VERSION}.tar.gz"
SOFIA_SRC_URL="${SOFIA_SRC_URL:-${SOFIA_SRC_URL_DEFAULT}}"
CACHE_ROOT="${SOFIA_CACHE_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/ur-signaling}"
CACHE_SRC="${CACHE_ROOT}/sofia-sip-${SOFIA_VERSION}"
VENDORED_TARBALL="${ROOT}/third_party/sofia-sip-${SOFIA_VERSION}.tar.gz"
HOME_PREFIX="${HOME}/.local/sofia-sip-${SOFIA_VERSION}"
RESOLVED_PREFIX_FILE="${CACHE_ROOT}/resolved-sofia-prefix"
# 1 = mkdir/make install via passwordless sudo (prefix not writable by current user)
USE_SUDO_INSTALL=0

# Logs must go to stderr — stdout is captured by SRC="$(resolve_sofia_src)".
log() { echo "==> $*" >&2; }

# Persist the prefix actually used so deploy/cmake can follow fallbacks.
# deploy-self-hosted.sh reads RESOLVED_PREFIX_FILE after this script exits.
# Also print PREFIX on stdout (logs stay on stderr) for manual/CI visibility.
write_resolved_prefix() {
  local prefix="$1"
  mkdir -p "${CACHE_ROOT}"
  printf '%s\n' "${prefix}" >"${RESOLVED_PREFIX_FILE}"
  export UR_SOFIA_PREFIX="${prefix}"
}

emit_resolved_prefix() {
  write_resolved_prefix "$1"
  printf '%s\n' "$1"
}

# True if we can create PREFIX and write into it without sudo.
prefix_writable() {
  local prefix="$1"
  local dir="${prefix}"
  while [[ -n "${dir}" && "${dir}" != "/" ]]; do
    if [[ -d "${dir}" ]]; then
      [[ -w "${dir}" ]]
      return $?
    fi
    dir="$(dirname "${dir}")"
  done
  # Need write on / to create a new top-level path (e.g. /opt/...).
  [[ -w "/" ]]
}

# Resolve install prefix for the current user into PREFIX / USE_SUDO_INSTALL.
# Prefer UR_SOFIA_PREFIX when set; default is $HOME/.local/sofia-sip-<ver>.
# If the chosen prefix is not writable:
#   1) under /root while not root → fall back to $HOME (sudo install under /root is
#      useless: /root is mode 700 so cmake as nlp_umn cannot read headers later)
#   2) passwordless sudo → keep prefix, install with sudo
#   3) otherwise → fall back to $HOME/.local/...
# Must not run in a subshell (sets globals).
resolve_install_prefix() {
  local requested="${UR_SOFIA_PREFIX:-${HOME_PREFIX}}"
  # Empty override from CI → treat as unset.
  if [[ -z "${requested}" ]]; then
    requested="${HOME_PREFIX}"
  fi

  USE_SUDO_INSTALL=0
  PREFIX="${requested}"

  if prefix_writable "${requested}"; then
    return 0
  fi

  # Non-root + /root/... → never sudo-install there (headers would be unreadable).
  if [[ "$(id -u)" -ne 0 && ( "${requested}" == /root/* || "${requested}" == /root ) ]]; then
    log "WARN: UR_SOFIA_PREFIX=${requested} is under /root and not writable by $(id -un); falling back to ${HOME_PREFIX}"
    log "WARN: unset repo Variable UR_SOFIA_PREFIX (or set it to ${HOME_PREFIX}) so staging matches the runner user"
    PREFIX="${HOME_PREFIX}"
    if prefix_writable "${PREFIX}"; then
      return 0
    fi
    echo "error: fallback prefix ${PREFIX} is also not writable" >&2
    exit 1
  fi

  if sudo -n true >/dev/null 2>&1; then
    log "PREFIX=${requested} not writable by $(id -un); will sudo make install"
    USE_SUDO_INSTALL=1
    return 0
  fi

  log "WARN: UR_SOFIA_PREFIX=${requested} not writable and passwordless sudo unavailable; falling back to ${HOME_PREFIX}"
  PREFIX="${HOME_PREFIX}"
  if ! prefix_writable "${PREFIX}"; then
    echo "error: cannot install Sofia to ${requested} or ${HOME_PREFIX} (not writable, no passwordless sudo)." >&2
    echo "  Fix: unset UR_SOFIA_PREFIX (uses \${HOME}/.local/sofia-sip-${SOFIA_VERSION})," >&2
    echo "       or set UR_SOFIA_PREFIX to a path owned by $(id -un)." >&2
    exit 1
  fi
}

resolve_install_prefix
# Record early (before build) so a crashed install still leaves a hint; final
# emit_resolved_prefix overwrites and prints to stdout for deploy.
write_resolved_prefix "${PREFIX}"

sofia_src_ok() {
  local src="$1"
  [[ -d "${src}" ]] || return 1
  { [[ -f "${src}/configure" ]] || [[ -f "${src}/configure.ac" ]]; } || return 1
  local hdr="${src}/libsofia-sip-ua/nua/sofia-sip/nua_tag.h"
  [[ -f "${hdr}" ]] && grep -q 'NUTAG_WSS_URL' "${hdr}"
}

# configure alone is not enough: a stale/partial tree may ship configure without
# generated Automake inputs (notably packages/Makefile.in).
sofia_autotools_ready() {
  local src="$1"
  [[ -x "${src}/configure" ]] \
    && [[ -f "${src}/Makefile.in" ]] \
    && [[ -f "${src}/packages/Makefile.in" ]]
}

sofia_can_autogen() {
  local src="$1"
  [[ -f "${src}/configure.ac" ]] || return 1
  [[ -x "${src}/autogen.sh" ]] || command -v autoreconf >/dev/null 2>&1
}

sofia_has_wss() {
  local prefix="$1"
  local hdr=""
  for cand in \
    "${prefix}/include/sofia-sip-1.13/sofia-sip/nua_tag.h" \
    "${prefix}/include/sofia-sip-1.12/sofia-sip/nua_tag.h" \
    "${prefix}/include/sofia-sip/nua_tag.h"; do
    if [[ -f "${cand}" ]]; then
      hdr="${cand}"
      break
    fi
  done
  [[ -n "${hdr}" ]] && grep -q 'NUTAG_WSS_URL' "${hdr}"
}

ensure_sofia_autotools() {
  local src="$1"

  if sofia_autotools_ready "${src}"; then
    return 0
  fi
  if ! sofia_can_autogen "${src}"; then
    echo "error: Sofia tree lacks packages/Makefile.in and cannot autogen: ${src}" >&2
    return 1
  fi

  log "Regenerating Sofia build system (need executable configure + packages/Makefile.in)"
  # Tolerate non-zero exit so set -e does not skip FreeSWITCH fallback; verify below.
  (
    cd "${src}"
    if command -v autoreconf >/dev/null 2>&1; then
      autoreconf -fi
    elif [[ -x ./autogen.sh ]]; then
      ./autogen.sh
    else
      exit 1
    fi
    # Some trees leave configure non-executable after autoreconf.
    [[ -f ./configure ]] && chmod +x ./configure
  ) || log "autogen/autoreconf exited non-zero; verifying generated files"

  if ! sofia_autotools_ready "${src}"; then
    echo "error: autogen/autoreconf did not produce packages/Makefile.in in ${src}" >&2
    return 1
  fi
}

extract_sofia_tarball() {
  local tarball="$1"
  local dest="$2"
  local tmp extract_dir

  [[ -f "${tarball}" ]] || return 1
  if sofia_src_ok "${dest}" && { sofia_autotools_ready "${dest}" || sofia_can_autogen "${dest}"; }; then
    echo "${dest}"
    return 0
  fi

  log "Unpacking Sofia source from ${tarball}"
  mkdir -p "${CACHE_ROOT}"
  tmp="$(mktemp -d "${CACHE_ROOT}/sofia-extract.XXXXXX")"
  tar -xzf "${tarball}" -C "${tmp}"
  extract_dir="$(find "${tmp}" -mindepth 1 -maxdepth 1 -type d | head -1)"
  if [[ -z "${extract_dir}" ]] || ! sofia_src_ok "${extract_dir}"; then
    echo "error: tarball lacks NUTAG_WSS_URL: ${tarball}" >&2
    rm -rf "${tmp}"
    return 1
  fi
  if ! sofia_autotools_ready "${extract_dir}" && ! sofia_can_autogen "${extract_dir}"; then
    echo "error: tarball missing packages/Makefile.in and autogen inputs: ${tarball}" >&2
    rm -rf "${tmp}"
    return 1
  fi
  rm -rf "${dest}"
  mkdir -p "$(dirname "${dest}")"
  mv "${extract_dir}" "${dest}"
  rm -rf "${tmp}"
  echo "${dest}"
}

find_local_sofia_src() {
  local cand
  for cand in \
    "${ROOT}/third_party/sofia-sip-${SOFIA_VERSION}" \
    "${ROOT}/.cache/sofia-sip-${SOFIA_VERSION}" \
    "${CACHE_SRC}" \
    "${ROOT}/../signalinggateway/xg_third_party_libs/sofia-sip-${SOFIA_VERSION}" \
    "${ROOT}/../signalinggateway/sofia-sip/sofia-sip-${SOFIA_VERSION}" \
    "${ROOT}/../../signalinggateway/xg_third_party_libs/sofia-sip-${SOFIA_VERSION}" \
    "${ROOT}/../../signalinggateway/sofia-sip/sofia-sip-${SOFIA_VERSION}" \
    "/home/worktual/UMN_REBUILD/SGW_IGR/signalinggateway/xg_third_party_libs/sofia-sip-${SOFIA_VERSION}" \
    "/home/worktual/UMN_REBUILD/SGW_IGR/signalinggateway/sofia-sip/sofia-sip-${SOFIA_VERSION}" \
    "/home/worktual/UMN_REBUILD/SGW_IGR/ur-signaling/third_party/sofia-sip-${SOFIA_VERSION}" \
    "/home/worktual/UMN_REBUILD/signalinggateway/xg_third_party_libs/sofia-sip-${SOFIA_VERSION}" \
    "${HOME}/src/sofia-sip-${SOFIA_VERSION}" \
    "${HOME}/sofia-sip-${SOFIA_VERSION}"; do
    if sofia_src_ok "${cand}" && { sofia_autotools_ready "${cand}" || sofia_can_autogen "${cand}"; }; then
      echo "${cand}"
      return 0
    fi
  done
  return 1
}

download_sofia_src() {
  local dest="${1:-${CACHE_SRC}}"
  local url="${SOFIA_SRC_URL}"
  local tmp tarball

  if sofia_src_ok "${dest}" && { sofia_autotools_ready "${dest}" || sofia_can_autogen "${dest}"; }; then
    echo "${dest}"
    return 0
  fi

  log "Downloading Sofia ${SOFIA_VERSION} source (WSS-capable FreeSWITCH fork)"
  log "URL=${url}"
  mkdir -p "${CACHE_ROOT}"
  tmp="$(mktemp -d "${CACHE_ROOT}/sofia-fetch.XXXXXX")"
  tarball="${tmp}/sofia-sip-${SOFIA_VERSION}.tar.gz"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "${tarball}" "${url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "${tarball}" "${url}"
  else
    echo "error: need curl or wget to download Sofia source" >&2
    rm -rf "${tmp}"
    return 1
  fi

  extract_sofia_tarball "${tarball}" "${dest}"
  local rc=$?
  rm -rf "${tmp}"
  return "${rc}"
}

resolve_sofia_src() {
  # Explicit path: do not silently fall through on a bad override.
  if [[ -n "${SOFIA_SRC:-}" ]]; then
    if sofia_src_ok "${SOFIA_SRC}" && { sofia_autotools_ready "${SOFIA_SRC}" || sofia_can_autogen "${SOFIA_SRC}"; }; then
      echo "${SOFIA_SRC}"
      return 0
    fi
    echo "error: SOFIA_SRC=${SOFIA_SRC} missing NUTAG_WSS_URL or configure prerequisites" >&2
    return 1
  fi

  local src=""
  if src="$(find_local_sofia_src)"; then
    echo "${src}"
    return 0
  fi

  # Prefer repo-vendored SGW tarball (offline-friendly on staging).
  if [[ -f "${VENDORED_TARBALL}" ]]; then
    if src="$(extract_sofia_tarball "${VENDORED_TARBALL}" "${CACHE_SRC}")"; then
      echo "${src}"
      return 0
    fi
    log "Vendored Sofia unpack failed prerequisites; falling back to FreeSWITCH download"
  fi

  # Clean host with network: FreeSWITCH sofia-sip v1.13.17 has NUTAG_WSS_URL.
  download_sofia_src "${CACHE_SRC}"
}

if sofia_has_wss "${PREFIX}"; then
  log "WSS Sofia already installed at ${PREFIX}"
  emit_resolved_prefix "${PREFIX}"
  exit 0
fi

# If a stale /root (or other) override pointed us at an empty prefix but HOME
# already has WSS Sofia, use that without rebuilding.
if [[ "${PREFIX}" != "${HOME_PREFIX}" ]] && sofia_has_wss "${HOME_PREFIX}"; then
  log "WSS Sofia already installed at ${HOME_PREFIX} (requested ${PREFIX} missing/unusable)"
  PREFIX="${HOME_PREFIX}"
  USE_SUDO_INSTALL=0
  emit_resolved_prefix "${PREFIX}"
  exit 0
fi

log "Installing WSS Sofia → ${PREFIX} (user=$(id -un) sudo_install=${USE_SUDO_INSTALL})"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  build-essential autoconf automake libtool pkg-config \
  libssl-dev zlib1g-dev curl ca-certificates

SRC="$(resolve_sofia_src)" || {
  echo "error: could not obtain Sofia ${SOFIA_VERSION} source with NUTAG_WSS_URL." >&2
  echo "  Fallback: SOFIA_SRC=/path/to/sofia-sip-${SOFIA_VERSION} ./scripts/install-wss-sofia.sh" >&2
  echo "  Example:  SOFIA_SRC=/home/worktual/UMN_REBUILD/SGW_IGR/signalinggateway/xg_third_party_libs/sofia-sip-${SOFIA_VERSION}" >&2
  exit 1
}
log "SOFIA_SRC=${SRC}"

# Never skip autogen when a stale/partial ./configure exists without *.in inputs.
ensure_sofia_autotools "${SRC}" || {
  if [[ -n "${SOFIA_SRC:-}" ]]; then
    exit 1
  fi
  # Last resort for cached/vendored/local trees that cannot autogen cleanly.
  log "Autogen failed on ${SRC}; retrying with FreeSWITCH download"
  rm -rf "${CACHE_SRC}"
  SRC="$(download_sofia_src "${CACHE_SRC}")" || exit 1
  log "SOFIA_SRC=${SRC}"
  ensure_sofia_autotools "${SRC}" || exit 1
}

cd "${SRC}"
./configure --prefix="${PREFIX}" --with-openssl
make -j"$(nproc 2>/dev/null || echo 2)"

if [[ "${USE_SUDO_INSTALL}" == "1" ]]; then
  sudo mkdir -p "${PREFIX}"
  sudo make install
else
  mkdir -p "${PREFIX}"
  make install
fi

if ! sofia_has_wss "${PREFIX}"; then
  echo "error: install finished but NUTAG_WSS_URL not found under ${PREFIX}" >&2
  exit 1
fi

log "OK: WSS Sofia at ${PREFIX}"
grep -n 'NUTAG_WSS_URL' \
  "${PREFIX}/include/sofia-sip-1.13/sofia-sip/nua_tag.h" \
  "${PREFIX}/include/sofia-sip/nua_tag.h" 2>/dev/null | head -3 >&2 || true
emit_resolved_prefix "${PREFIX}"

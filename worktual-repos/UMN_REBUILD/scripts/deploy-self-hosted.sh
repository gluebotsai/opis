#!/usr/bin/env bash
# Build and (re)start ur-signaling on a self-hosted deploy host / GH Actions runner.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

INSTALL_DIR="${INSTALL_DIR:-${ROOT}}"
CONFIG="${CONFIG:-configs/ur-signaling.staging.conf.json}"
SERVICE_NAME="${SERVICE_NAME:-ur-signaling}"
UR_SOFIA_PREFIX="${UR_SOFIA_PREFIX:-${HOME}/.local/sofia-sip-1.13.17}"
CERT_DIR="${CERT_DIR:-/etc/ur-signaling/certs}"
# 1 = skip WSS/TLS bind; 0 = enable WSS (:57344) — needs WSS Sofia
UR_SIP_UDP_ONLY="${UR_SIP_UDP_ONLY:-0}"
SKIP_APT="${SKIP_APT:-0}"
USE_SYSTEMD="${USE_SYSTEMD:-1}"
# SIP bind/contact host. Empty → auto-detect primary IPv4 on this host.
UR_SIP_HOST="${UR_SIP_HOST:-}"
# 1 = run scripts/install-wss-sofia.sh when WSS Sofia missing (udp_only=0)
INSTALL_WSS_SOFIA="${INSTALL_WSS_SOFIA:-1}"
# Sofia stack debug → file (deploy/systemd only; does not change app C++).
# SOFIA_DEBUG=0 disables verbose Sofia env; stderr still goes to SOFIA_LOG_FILE when set.
SOFIA_DEBUG="${SOFIA_DEBUG:-9}"
SOFIA_LOG_FILE="${SOFIA_LOG_FILE:-${INSTALL_DIR}/logs/sofia.err}"

log() { echo "==> $*"; }

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

# install-wss-sofia.sh writes the prefix it actually used here (may fall back from /root).
sofia_resolved_prefix_file() {
  echo "${SOFIA_CACHE_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/ur-signaling}/resolved-sofia-prefix"
}

load_resolved_sofia_prefix() {
  local f
  f="$(sofia_resolved_prefix_file)"
  if [[ -r "${f}" ]]; then
    local resolved
    resolved="$(tr -d '\r\n' <"${f}")"
    if [[ -n "${resolved}" ]]; then
      UR_SOFIA_PREFIX="${resolved}"
    fi
  fi
}

ensure_wss_sofia() {
  if [[ "${UR_SIP_UDP_ONLY}" == "1" ]]; then
    log "UR_SIP_UDP_ONLY=1 — WSS listen disabled"
    return 0
  fi
  # Empty CI override → $HOME default (never force /root).
  if [[ -z "${UR_SOFIA_PREFIX}" ]]; then
    UR_SOFIA_PREFIX="${HOME}/.local/sofia-sip-1.13.17"
  fi
  # Stale CI default /root/... is unreadable for non-root runners — prefer $HOME if present.
  if ! sofia_has_wss "${UR_SOFIA_PREFIX}"; then
    local home_prefix="${HOME}/.local/sofia-sip-1.13.17"
    if [[ "${UR_SOFIA_PREFIX}" != "${home_prefix}" ]] && sofia_has_wss "${home_prefix}"; then
      log "WARN: no WSS Sofia at ${UR_SOFIA_PREFIX}; using ${home_prefix}"
      UR_SOFIA_PREFIX="${home_prefix}"
    fi
  fi
  if sofia_has_wss "${UR_SOFIA_PREFIX}"; then
    export UR_SOFIA_PREFIX
    log "WSS Sofia OK: ${UR_SOFIA_PREFIX}"
    return 0
  fi
  if [[ "${INSTALL_WSS_SOFIA}" == "1" && -x ./scripts/install-wss-sofia.sh ]]; then
    log "WSS Sofia missing — running install-wss-sofia.sh"
    # Logs → stderr; resolved prefix file for cmake (may fall back from /root → $HOME).
    UR_SOFIA_PREFIX="${UR_SOFIA_PREFIX}" ./scripts/install-wss-sofia.sh
    load_resolved_sofia_prefix
  fi
  if ! sofia_has_wss "${UR_SOFIA_PREFIX}"; then
    echo "error: WSS listen requested but Sofia at ${UR_SOFIA_PREFIX} has no NUTAG_WSS_URL" >&2
    echo "  Fix: ./scripts/install-wss-sofia.sh   (uses third_party/sofia-sip-1.13.17.tar.gz)" >&2
    echo "  Or:  SOFIA_SRC=/path/to/sofia-sip-1.13.17 ./scripts/install-wss-sofia.sh" >&2
    echo "  Or:  unset UR_SOFIA_PREFIX (installs to \$HOME/.local/sofia-sip-1.13.17)" >&2
    echo "  Or:  UR_SIP_UDP_ONLY=1 for UDP-only" >&2
    exit 1
  fi
  export UR_SOFIA_PREFIX
  log "UR_SOFIA_PREFIX=${UR_SOFIA_PREFIX} (for cmake/build)"
}

# Prefer a non-loopback IPv4 (hostname -I / ip route).
detect_primary_ipv4() {
  local ip=""
  if command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [[ -z "${ip}" || "${ip}" == "127.0.0.1" ]] && command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
  fi
  if [[ -z "${ip}" || "${ip}" == "127.0.0.1" ]]; then
    ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
  fi
  echo "${ip}"
}

resolve_sip_host() {
  if [[ -n "${UR_SIP_HOST}" ]]; then
    log "UR_SIP_HOST=${UR_SIP_HOST} (from env)"
    return 0
  fi
  UR_SIP_HOST="$(detect_primary_ipv4)"
  if [[ -z "${UR_SIP_HOST}" ]]; then
    echo "error: could not detect host IPv4; set UR_SIP_HOST explicitly" >&2
    exit 1
  fi
  export UR_SIP_HOST
  log "UR_SIP_HOST=${UR_SIP_HOST} (auto-detected)"
}

detect_ubuntu_codename() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    echo "${VERSION_CODENAME:-}"
  fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  local codename
  codename="$(detect_ubuntu_codename)"
  log "apt install (codename=${codename:-unknown})"
  sudo apt-get update -qq

  local pkgs=(
    build-essential cmake pkg-config g++-12 git
    libhiredis-dev libssl-dev
    libsofia-sip-ua-dev
  )

  # Runtime hiredis / ssl package names differ by Ubuntu release.
  case "${codename}" in
    noble|oracular|plucky|questing)
      pkgs+=(libhiredis1.1.0 libssl3t64 libsofia-sip-ua0t64)
      ;;
    *)
      pkgs+=(libhiredis0.14 libssl3 libsofia-sip-ua0)
      ;;
  esac

  if ! sudo apt-get install -y --no-install-recommends "${pkgs[@]}"; then
    # Fallback if t64 / exact runtime names differ on the mirror.
    log "retry apt with core build packages only"
    sudo apt-get install -y --no-install-recommends \
      build-essential cmake pkg-config g++-12 git \
      libhiredis-dev libssl-dev libsofia-sip-ua-dev
  fi
}

ensure_certs() {
  # Runtime PEMs only — build never embeds certs. Required: agent.pem + wss.pem;
  # recommended: cafile.pem (see docs/wss.md).
  if [[ -f "${CERT_DIR}/agent.pem" && -f "${CERT_DIR}/wss.pem" ]]; then
    log "certs ok: ${CERT_DIR}/{agent,wss}.pem"
    return 0
  fi
  log "missing agent.pem/wss.pem under ${CERT_DIR} — generating smoke certs (replace with prod later)"
  sudo mkdir -p "${CERT_DIR}"
  if [[ -x ./scripts/gen-sofia-certs.sh ]]; then
    ./scripts/gen-sofia-certs.sh /tmp/ur-sofia-certs
    sudo cp /tmp/ur-sofia-certs/agent.pem "${CERT_DIR}/agent.pem"
    sudo cp /tmp/ur-sofia-certs/wss.pem "${CERT_DIR}/wss.pem"
    sudo cp /tmp/ur-sofia-certs/cafile.pem "${CERT_DIR}/cafile.pem"
    sudo chmod 600 "${CERT_DIR}/agent.pem" "${CERT_DIR}/wss.pem"
    sudo chmod 644 "${CERT_DIR}/cafile.pem"
  else
    log "WARN: gen-sofia-certs.sh missing; create ${CERT_DIR}/{agent,wss,cafile}.pem manually"
  fi
}

stop_old() {
  if [[ "${USE_SYSTEMD}" == "1" ]] && systemctl list-unit-files "${SERVICE_NAME}.service" &>/dev/null; then
    log "systemctl stop ${SERVICE_NAME}"
    sudo systemctl stop "${SERVICE_NAME}" || true
  else
    log "pkill existing ur-signaling"
    sudo pkill -f "${INSTALL_DIR}/build/ur-signaling" || true
    sleep 1
  fi
}

install_or_refresh_systemd_unit() {
  local unit_src="${INSTALL_DIR}/deploy/${SERVICE_NAME}.service"
  if [[ ! -f "${unit_src}" ]]; then
    log "WARN: missing ${unit_src}; skipping systemd unit install"
    return 1
  fi
  # Rewrite WorkingDirectory / ExecStart for this install + CONFIG.
  local tmp
  tmp="$(mktemp)"
  sed \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=${INSTALL_DIR}|" \
    -e "s|^ExecStart=.*|ExecStart=${INSTALL_DIR}/build/ur-signaling ${CONFIG}|" \
    "${unit_src}" >"${tmp}"
  sudo cp "${tmp}" "/etc/systemd/system/${SERVICE_NAME}.service"
  rm -f "${tmp}"
  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1 || true
  return 0
}

write_systemd_env_dropins() {
  sudo mkdir -p "/etc/systemd/system/${SERVICE_NAME}.service.d"
  sudo tee "/etc/systemd/system/${SERVICE_NAME}.service.d/sip-host.conf" >/dev/null <<EOF
[Service]
Environment=UR_SIP_HOST=${UR_SIP_HOST}
Environment=UR_SIP_CERTIFICATE_DIR=${CERT_DIR}
EOF
  if [[ "${UR_SIP_UDP_ONLY}" == "1" ]]; then
    sudo tee "/etc/systemd/system/${SERVICE_NAME}.service.d/udp-only.conf" >/dev/null <<EOF
[Service]
Environment=UR_SIP_UDP_ONLY=1
EOF
  else
    sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service.d/udp-only.conf"
  fi

  # Sofia stack: full debug env + stderr → logs/sofia.err (app file logger unchanged).
  mkdir -p "$(dirname "${SOFIA_LOG_FILE}")"
  local sofia_env_lines=()
  if [[ "${SOFIA_DEBUG}" != "0" && -n "${SOFIA_DEBUG}" ]]; then
    # Full Sofia SIP message / transport debug (stderr → SOFIA_LOG_FILE).
    sofia_env_lines+=(
      "Environment=SOFIA_DEBUG=${SOFIA_DEBUG}"
      "Environment=NUA_DEBUG=${SOFIA_DEBUG}"
      "Environment=SOA_DEBUG=${SOFIA_DEBUG}"
      "Environment=NEA_DEBUG=${SOFIA_DEBUG}"
      "Environment=IPTSEC_DEBUG=${SOFIA_DEBUG}"
      "Environment=NTA_DEBUG=${SOFIA_DEBUG}"
      "Environment=TPORT_DEBUG=${SOFIA_DEBUG}"
      "Environment=TPORT_LOG=${SOFIA_DEBUG}"
      "Environment=TPORT_DUMP=1"
      "Environment=SU_DEBUG=${SOFIA_DEBUG}"
      "Environment=NTH_DEBUG=${SOFIA_DEBUG}"
    )
  fi
  sudo tee "/etc/systemd/system/${SERVICE_NAME}.service.d/sofia-debug.conf" >/dev/null <<EOF
[Service]
# Sofia-SIP stderr (nta_/tport_/nua_ …) → file. App log stays in logs/ur-signaling-*.log
StandardError=append:${SOFIA_LOG_FILE}
$(printf '%s\n' "${sofia_env_lines[@]}")
EOF
  log "Sofia stderr → ${SOFIA_LOG_FILE} (SOFIA_DEBUG=${SOFIA_DEBUG})"
}

start_app() {
  mkdir -p logs data
  if [[ "${USE_SYSTEMD}" == "1" ]]; then
    if install_or_refresh_systemd_unit || systemctl list-unit-files "${SERVICE_NAME}.service" &>/dev/null; then
      log "systemctl restart ${SERVICE_NAME} (config=${CONFIG} sip_host=${UR_SIP_HOST})"
      write_systemd_env_dropins
      sudo systemctl daemon-reload
      sudo systemctl restart "${SERVICE_NAME}"
      sleep 2
      sudo systemctl --no-pager --full status "${SERVICE_NAME}" || true
      return 0
    fi
  fi

  log "nohup start (systemd unavailable or USE_SYSTEMD=0)"
  local -a env_vars=(
    "UR_SIP_HOST=${UR_SIP_HOST}"
    "UR_SIP_CERTIFICATE_DIR=${CERT_DIR}"
  )
  if [[ "${UR_SIP_UDP_ONLY}" == "1" ]]; then
    env_vars+=("UR_SIP_UDP_ONLY=1")
  fi
  if [[ "${SOFIA_DEBUG}" != "0" && -n "${SOFIA_DEBUG}" ]]; then
    env_vars+=(
      "SOFIA_DEBUG=${SOFIA_DEBUG}"
      "NUA_DEBUG=${SOFIA_DEBUG}"
      "SOA_DEBUG=${SOFIA_DEBUG}"
      "NEA_DEBUG=${SOFIA_DEBUG}"
      "IPTSEC_DEBUG=${SOFIA_DEBUG}"
      "NTA_DEBUG=${SOFIA_DEBUG}"
      "TPORT_DEBUG=${SOFIA_DEBUG}"
      "TPORT_LOG=${SOFIA_DEBUG}"
      "TPORT_DUMP=1"
      "SU_DEBUG=${SOFIA_DEBUG}"
      "NTH_DEBUG=${SOFIA_DEBUG}"
    )
  fi
  mkdir -p "$(dirname "${SOFIA_LOG_FILE}")"
  touch "${SOFIA_LOG_FILE}"
  log "Sofia stderr → ${SOFIA_LOG_FILE} (SOFIA_DEBUG=${SOFIA_DEBUG})"
  # stdout → deploy.out; Sofia/app stderr → sofia.err
  nohup env "${env_vars[@]}" ./build/ur-signaling "${CONFIG}" \
    >>logs/deploy.out 2>>"${SOFIA_LOG_FILE}" &
  echo $! | tee /tmp/ur-signaling.pid
  sleep 2
  if [[ -f logs/ur-signaling-staging.log ]]; then
    tail -n 40 logs/ur-signaling-staging.log || true
  elif [[ -f logs/ur-signaling-sip-smoke.log ]]; then
    tail -n 40 logs/ur-signaling-sip-smoke.log || true
  else
    tail -n 40 logs/deploy.out || true
  fi
  tail -n 20 "${SOFIA_LOG_FILE}" 2>/dev/null || true
}

log "deploy root=${INSTALL_DIR} config=${CONFIG}"

if [[ ! -f "${CONFIG}" ]]; then
  # Prefer staging conf; fall back to sip-smoke for older checkouts.
  if [[ "${CONFIG}" == "configs/ur-signaling.staging.conf.json" &&
        -f configs/ur-signaling.sip-smoke.conf.json ]]; then
    CONFIG=configs/ur-signaling.sip-smoke.conf.json
    log "CONFIG fallback → ${CONFIG}"
  else
    echo "error: config not found: ${CONFIG}" >&2
    exit 1
  fi
fi

resolve_sip_host
export UR_SIP_HOST
export UR_SIP_CERTIFICATE_DIR="${CERT_DIR}"

if [[ "${SKIP_APT}" != "1" ]]; then
  install_packages
else
  log "SKIP_APT=1"
fi

ensure_wss_sofia
if [[ -d "${UR_SOFIA_PREFIX}" ]]; then
  export UR_SOFIA_PREFIX
  log "UR_SOFIA_PREFIX=${UR_SOFIA_PREFIX}"
else
  log "WARN: ${UR_SOFIA_PREFIX} missing — build will use pkg-config Sofia (often no WSS)"
fi

ensure_certs

log "build"
rm -rf build
./scripts/build.sh

if [[ "${UR_SIP_UDP_ONLY}" != "1" ]]; then
  if ! grep -R 'UR_SIGNALING_HAVE_SOFIA_WSS' build/CMakeFiles 2>/dev/null | head -1 | grep -q .; then
    echo "error: build did not enable UR_SIGNALING_HAVE_SOFIA_WSS — check UR_SOFIA_PREFIX=${UR_SOFIA_PREFIX}" >&2
    exit 1
  fi
  log "binary built with UR_SIGNALING_HAVE_SOFIA_WSS"
fi

stop_old
start_app

log "deploy done"
if pgrep -af 'build/ur-signaling' >/dev/null; then
  pgrep -af 'build/ur-signaling' || true
else
  log "WARN: process not found in pgrep — check journalctl -u ${SERVICE_NAME} or logs/"
  exit 1
fi

if [[ "${UR_SIP_UDP_ONLY}" != "1" ]]; then
  sleep 1
  if ss -ltnp 2>/dev/null | grep -qE ':57344\b'; then
    log "WSS listening on :57344"
  else
    log "WARN: :57344 not listening — check logs for nua_create / certs / WSS Sofia"
    tail -n 50 logs/ur-signaling-staging.log 2>/dev/null \
      || tail -n 50 logs/ur-signaling-sip-smoke.log 2>/dev/null \
      || true
    exit 1
  fi
fi

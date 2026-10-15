#!/usr/bin/env bash
# Ensure deploy/runtime tools exist; install when missing (Linux).
set -euo pipefail

PNPM_VERSION="${PNPM_VERSION:-9}"
NODE_MAJOR_MIN="${NODE_MAJOR_MIN:-22}"

prereq_log() {
  printf '[ensure-prerequisites] %s\n' "$*"
}

warn() {
  printf '[ensure-prerequisites] WARN: %s\n' "$*" >&2
}

fail() {
  printf '[ensure-prerequisites] ERROR: %s\n' "$*" >&2
  exit 1
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

can_use_sudo() {
  [[ "$(id -u)" -eq 0 ]] && return 0
  if ! has_command sudo; then
    return 1
  fi
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sudo-lib.sh"
  resolve_passwordless_sudo_bins
}

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif can_use_sudo; then
    sudo "$@"
  else
    return 1
  fi
}

postgres_is_reachable() {
  if has_command pg_isready; then
    pg_isready -h localhost -p 5432 >/dev/null 2>&1
    return $?
  fi

  # Fallback when postgresql-client is not installed (no pg_isready).
  (echo > /dev/tcp/localhost/5432) >/dev/null 2>&1
}

detect_package_manager() {
  if has_command apt-get; then
    echo apt
  elif has_command dnf; then
    echo dnf
  elif has_command yum; then
    echo yum
  else
    echo unknown
  fi
}

apt_packages_missing() {
  local packages=("$@")
  local missing=()

  for package in "${packages[@]}"; do
    if ! dpkg -s "$package" >/dev/null 2>&1; then
      missing+=("$package")
    fi
  done

  printf '%s\n' "${missing[@]}"
}

install_apt_packages() {
  local packages=("$@")
  local missing=()
  mapfile -t missing < <(apt_packages_missing "${packages[@]}")

  if ((${#missing[@]} == 0)); then
    return 0
  fi

  if ! can_use_sudo; then
    warn "Cannot install apt packages (no passwordless sudo): ${missing[*]}"
    warn "Run once on the server: sudo apt-get update && sudo apt-get install -y ${missing[*]}"
    return 0
  fi

prereq_log "Installing apt packages: ${missing[*]}"
  run_sudo apt-get update -qq
  run_sudo apt-get install -y "${missing[@]}"
}

install_dnf_packages() {
  local packages=("$@")

  if ! can_use_sudo; then
    warn "Cannot install packages (no passwordless sudo): ${packages[*]}"
    return 0
  fi

prereq_log "Installing packages: ${packages[*]}"
  run_sudo dnf install -y "${packages[@]}"
}

install_yum_packages() {
  local packages=("$@")

  if ! can_use_sudo; then
    warn "Cannot install packages (no passwordless sudo): ${packages[*]}"
    return 0
  fi

prereq_log "Installing packages: ${packages[*]}"
  run_sudo yum install -y "${packages[@]}"
}

install_system_packages() {
  local pm
  pm="$(detect_package_manager)"

  # Only install CLI tools the deploy scripts actually need.
  # Postgres *server* is separate — we check port 5432, not postgresql-client.
  local missing_packages=()
  has_command rsync || missing_packages+=(rsync)
  has_command curl || missing_packages+=(curl)
  has_command lsof || missing_packages+=(lsof)

  if ((${#missing_packages[@]} == 0)); then
  prereq_log "System tools OK (rsync curl lsof)"
    return 0
  fi

  case "$pm" in
    apt)
      install_apt_packages "${missing_packages[@]}" ca-certificates
      if [[ "${DEPLOY_BACKEND:-false}" == "true" ]]; then
        install_apt_packages python3 python3-venv python3-pip
      fi
      ;;
    dnf)
      install_dnf_packages "${missing_packages[@]}" ca-certificates
      if [[ "${DEPLOY_BACKEND:-false}" == "true" ]]; then
        install_dnf_packages python3 python3-pip
      fi
      ;;
    yum)
      install_yum_packages "${missing_packages[@]}" ca-certificates
      if [[ "${DEPLOY_BACKEND:-false}" == "true" ]]; then
        install_yum_packages python3 python3-pip
      fi
      ;;
    *)
      warn "Unknown package manager — install manually: ${missing_packages[*]}"
      ;;
  esac
}

node_major_version() {
  if ! has_command node; then
    echo 0
    return 0
  fi

  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

install_node() {
  local major
  major="$(node_major_version)"

  if [[ "$major" -ge "$NODE_MAJOR_MIN" ]]; then
  prereq_log "Node.js $(node -v) OK"
    return 0
  fi

  if ! can_use_sudo; then
    fail "Node.js ${NODE_MAJOR_MIN}+ required (found: $(node -v 2>/dev/null || echo none)). Install Node or use GitHub Actions setup-node."
  fi

prereq_log "Installing Node.js ${NODE_MAJOR_MIN}.x"

  local pm
  pm="$(detect_package_manager)"

  case "$pm" in
    apt)
      if [[ "$(id -u)" -eq 0 ]]; then
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_MIN}.x" | bash -
        apt-get install -y nodejs
      else
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_MIN}.x" | sudo -E bash -
        sudo apt-get install -y nodejs
      fi
      ;;
    dnf | yum)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR_MIN}.x" | run_sudo bash -
      if [[ "$pm" == dnf ]]; then
        run_sudo dnf install -y nodejs
      else
        run_sudo yum install -y nodejs
      fi
      ;;
    *)
      fail "Install Node.js ${NODE_MAJOR_MIN}+ manually, then re-run deploy."
      ;;
  esac

  major="$(node_major_version)"
  [[ "$major" -ge "$NODE_MAJOR_MIN" ]] || fail "Node.js install failed"
prereq_log "Node.js $(node -v) installed"
}

install_pnpm() {
  if has_command pnpm; then
  prereq_log "pnpm $(pnpm -v) OK"
    return 0
  fi

prereq_log "Installing pnpm ${PNPM_VERSION}"

  if has_command corepack; then
    corepack enable
    corepack prepare "pnpm@${PNPM_VERSION}" --activate
  elif has_command npm; then
    npm install -g "pnpm@${PNPM_VERSION}" 2>/dev/null || run_sudo npm install -g "pnpm@${PNPM_VERSION}"
  else
    fail "npm not found — install Node.js first"
  fi

  has_command pnpm || fail "pnpm install failed"
prereq_log "pnpm $(pnpm -v) installed"
}

verify_tools() {
  local tool
  for tool in node pnpm rsync curl lsof; do
    has_command "$tool" || fail "Missing required tool: ${tool}"
  done

  if has_command pg_isready; then
  prereq_log "pg_isready OK"
  else
    warn "pg_isready not installed — Postgres checks will use TCP port 5432"
  fi

  if [[ "${DEPLOY_BACKEND:-false}" == "true" ]]; then
    has_command python3 || fail "Missing python3 (set DEPLOY_BACKEND=false to skip)"
  fi
}


ensure_prerequisites() {
prereq_log "Checking deployment prerequisites"
  install_system_packages
  install_node
  install_pnpm
  verify_tools
prereq_log "All prerequisites ready"
}


if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ensure_prerequisites
fi

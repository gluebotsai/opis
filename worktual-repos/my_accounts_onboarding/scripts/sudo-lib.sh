#!/usr/bin/env bash
# Passwordless sudo with command-specific visudo rules requires the EXACT binary path.
# e.g. NOPASSWD: /usr/bin/cp does NOT apply to `sudo cp` or `sudo /bin/cp`.

SUDO_CP_PATH="${SUDO_CP_PATH:-}"
SUDO_SYSTEMCTL_PATH="${SUDO_SYSTEMCTL_PATH:-}"

_sudo_bin_candidates() {
  local name="$1"
  local seen="|"
  local candidate

  for candidate in "/usr/bin/${name}" "/bin/${name}" "$(command -v "${name}" 2>/dev/null || true)"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    [[ "$seen" == *"|${candidate}|"* ]] && continue
    seen="${seen}${candidate}|"
    printf '%s\n' "$candidate"
  done
}

_sudo_cp_works() {
  local cp_bin="$1"

  if sudo -n "$cp_bin" --version >/dev/null 2>&1; then
    return 0
  fi

  local probe="${TMPDIR:-/tmp}/worktual-sudo-cp-probe.$$"
  printf 'probe\n' >"$probe"
  if sudo -n "$cp_bin" "$probe" "${probe}.bak" >/dev/null 2>&1; then
    rm -f "$probe" "${probe}.bak"
    return 0
  fi
  rm -f "$probe" "${probe}.bak"
  return 1
}

resolve_passwordless_sudo_bins() {
  local candidate

  if [[ -n "$SUDO_CP_PATH" && -n "$SUDO_SYSTEMCTL_PATH" ]]; then
    return 0
  fi

  SUDO_CP_PATH=""
  SUDO_SYSTEMCTL_PATH=""

  while IFS= read -r candidate; do
    if _sudo_cp_works "$candidate"; then
      SUDO_CP_PATH="$candidate"
      break
    fi
  done < <(_sudo_bin_candidates cp)

  while IFS= read -r candidate; do
    if sudo -n "$candidate" --version >/dev/null 2>&1; then
      SUDO_SYSTEMCTL_PATH="$candidate"
      break
    fi
  done < <(_sudo_bin_candidates systemctl)

  [[ -n "$SUDO_CP_PATH" && -n "$SUDO_SYSTEMCTL_PATH" ]]
}

passwordless_sudo_hint() {
  local user="${1:-$(whoami)}"
  local cp_paths systemctl_paths

  cp_paths="$(_sudo_bin_candidates cp | tr '\n' ' ')"
  systemctl_paths="$(_sudo_bin_candidates systemctl | tr '\n' ' ')"

  cat <<EOF
Passwordless sudo required for cp and systemctl using EXACT paths (visudo is path-sensitive).
Run: sudo visudo
Add one line per path that exists on this machine, for example:
  ${user} ALL=(ALL) NOPASSWD: ${cp_paths}, ${systemctl_paths}
Verify (use full paths — bare 'sudo systemctl' may still ask for a password):
  sudo -n /usr/bin/systemctl --version
  sudo -n /usr/bin/cp --version
Detected cp: ${cp_paths:-unknown}
Detected systemctl: ${systemctl_paths:-unknown}
Resolved cp: ${SUDO_CP_PATH:-none}
Resolved systemctl: ${SUDO_SYSTEMCTL_PATH:-none}
EOF
}

sudo_cp() {
  [[ -n "$SUDO_CP_PATH" ]] || resolve_passwordless_sudo_bins || return 1
  if sudo -n "$SUDO_CP_PATH" "$@" 2>/dev/null; then
    return 0
  fi
  sudo "$SUDO_CP_PATH" "$@"
}

sudo_systemctl() {
  [[ -n "$SUDO_SYSTEMCTL_PATH" ]] || resolve_passwordless_sudo_bins || return 1
  if sudo -n "$SUDO_SYSTEMCTL_PATH" "$@" 2>/dev/null; then
    return 0
  fi
  sudo "$SUDO_SYSTEMCTL_PATH" "$@"
}

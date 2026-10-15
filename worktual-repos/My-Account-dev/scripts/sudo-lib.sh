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

_sudo_join_comma() {
  local first=1
  local path
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    if ((first)); then
      printf '%s' "$path"
      first=0
    else
      printf ', %s' "$path"
    fi
  done
}

_sudo_diag_line() {
  local label="$1"
  shift
  local out
  if out="$("$@" 2>&1)"; then
    printf '  OK  %s\n' "$label"
  else
    printf '  FAIL %s → %s\n' "$label" "$(printf '%s' "$out" | tr '\n' ' ' | head -c 200)"
  fi
}

passwordless_sudo_hint() {
  local user="${1:-$(whoami)}"
  local cp_paths systemctl_paths sudoers_cmds

  # sudoers requires comma-separated commands — spaces are arguments, not alternatives.
  cp_paths="$(_sudo_bin_candidates cp | tr '\n' ' ')"
  systemctl_paths="$(_sudo_bin_candidates systemctl | tr '\n' ' ')"
  sudoers_cmds="$({
    _sudo_bin_candidates cp
    _sudo_bin_candidates systemctl
  } | _sudo_join_comma)"

  cat <<EOF
Passwordless sudo required for cp and systemctl using EXACT paths (visudo is path-sensitive).

IMPORTANT:
  - Verify with sudo -n (non-interactive). A successful interactive sudo can be a cached password
    and still fails in GitHub Actions (clean session, no TTY).
  - The CI user must match the sudoers user (whoami in the job).
  - If Defaults requiretty is on, add: Defaults:${user} !requiretty

Run: sudo visudo
Add exactly one line (comma-separated — do NOT use spaces between binaries):
  ${user} ALL=(ALL) NOPASSWD: ${sudoers_cmds}

Live diagnostics for this process:
  whoami=$(whoami) uid=$(id -u) tty=${SSH_TTY:-none}
$(_sudo_diag_line "sudo -n /usr/bin/cp --version" sudo -n /usr/bin/cp --version)
$(_sudo_diag_line "sudo -n /usr/bin/systemctl --version" sudo -n /usr/bin/systemctl --version)
$(_sudo_diag_line "sudo -n -l" sudo -n -l)

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

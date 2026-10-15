#!/usr/bin/env bash
# Load DATABASE_URL from shared/.env without bash `source` (Gmail .env values break the shell).

_LOAD_SHARED_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$_LOAD_SHARED_ENV_DIR/read-env-var.sh"

load_shared_env() {
  local shared_env="${1:?shared .env path required}"

  if [[ -n "${DATABASE_URL:-}" ]]; then
    return 0
  fi

  if [[ ! -f "$shared_env" ]]; then
    printf '[env] ERROR: missing %s\n' "$shared_env" >&2
    return 1
  fi

  local loaded_url
  loaded_url="$(read_env_var DATABASE_URL "$shared_env")" || {
    printf '[env] ERROR: DATABASE_URL is not set in %s\n' "$shared_env" >&2
    return 1
  }

  export DATABASE_URL="$loaded_url"
}

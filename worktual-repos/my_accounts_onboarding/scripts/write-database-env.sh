#!/usr/bin/env bash
# Write shared/database.env (DATABASE_URL only) for systemd — safe to EnvironmentFile.

_WRITE_DATABASE_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$_WRITE_DATABASE_ENV_DIR/read-env-var.sh"

write_database_env() {
  local shared_env="${1:?shared .env path required}"
  local output="${2:?output path required}"
  local database_url=""

  if [[ -n "${DATABASE_URL:-}" ]]; then
    database_url="$DATABASE_URL"
  elif [[ -f "$shared_env" ]]; then
    database_url="$(read_env_var DATABASE_URL "$shared_env")" || {
      printf '[database-env] ERROR: DATABASE_URL is not set in %s\n' "$shared_env" >&2
      return 1
    }
  else
    printf '[database-env] ERROR: missing %s and DATABASE_URL not in environment\n' "$shared_env" >&2
    return 1
  fi

  mkdir -p "$(dirname "$output")"
  printf 'DATABASE_URL=%s\n' "$database_url" >"$output"
  chmod 600 "$output"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/deploy-config.sh"
  write_database_env "$DEPLOY_ROOT/shared/.env" "$DEPLOY_ROOT/shared/database.env"
  printf '[database-env] Wrote %s/shared/database.env\n' "$DEPLOY_ROOT"
fi

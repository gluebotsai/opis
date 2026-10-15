#!/usr/bin/env bash
# Write shared/database.env (DATABASE_URL only) for systemd — safe to EnvironmentFile.
# Prefers DATABASE_URL / POSTGRES_* from shared/.env (same rules as load-shared-env.sh).

_WRITE_DATABASE_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$_WRITE_DATABASE_ENV_DIR/load-shared-env.sh"

write_database_env() {
  local shared_env="${1:?shared .env path required}"
  local output="${2:?output path required}"

  load_shared_env "$shared_env" || return 1

  mkdir -p "$(dirname "$output")"
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL" >"$output"
  chmod 600 "$output"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/deploy-config.sh"
  write_database_env "$DEPLOY_ROOT/shared/.env" "$DEPLOY_ROOT/shared/database.env"
  printf '[database-env] Wrote %s/shared/database.env\n' "$DEPLOY_ROOT"
fi

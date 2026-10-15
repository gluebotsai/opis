#!/usr/bin/env bash
# Load DATABASE_URL from shared/.env without bash `source` (Gmail .env values break the shell).
# shared/.env always wins over any pre-set DATABASE_URL (e.g. GitHub Actions env).

_LOAD_SHARED_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$_LOAD_SHARED_ENV_DIR/read-env-var.sh"

urlencode_component() {
  local value="${1-}"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$value"
    return
  fi
  # Minimal fallback when python3 is unavailable (safe for simple passwords).
  printf '%s' "$value" | sed -e 's/%/%25/g' -e 's/@/%40/g' -e 's/:/%3A/g' -e 's|/|%2F|g' -e 's/?/%3F/g' -e 's/#/%23/g' -e 's/ /%20/g'
}

build_database_url_from_postgres_vars() {
  local shared_env="${1:?shared .env path required}"
  local user password db host port

  user="$(read_env_var POSTGRES_USER "$shared_env" 2>/dev/null || true)"
  password="$(read_env_var POSTGRES_PASSWORD "$shared_env" 2>/dev/null || true)"
  db="$(read_env_var POSTGRES_DB "$shared_env" 2>/dev/null || true)"
  host="$(read_env_var POSTGRES_HOST "$shared_env" 2>/dev/null || true)"
  port="$(read_env_var POSTGRES_PORT "$shared_env" 2>/dev/null || true)"

  user="${user:-postgres}"
  host="${host:-localhost}"
  port="${port:-5432}"

  if [[ -z "$db" ]]; then
    return 1
  fi

  local enc_user enc_password
  enc_user="$(urlencode_component "$user")"
  enc_password="$(urlencode_component "$password")"

  printf 'postgresql://%s:%s@%s:%s/%s' "$enc_user" "$enc_password" "$host" "$port" "$db"
}

# Parse host and port from a postgres/postgresql URL into PGHOST / PGPORT.
# Usage: parse_database_url_endpoint "$DATABASE_URL" → sets REPLY_HOST REPLY_PORT
parse_database_url_endpoint() {
  local url="${1:?DATABASE_URL required}"
  local rest host port

  rest="${url#*://}"
  if [[ "$rest" == *@* ]]; then
    rest="${rest#*@}"
  fi
  rest="${rest%%/*}"
  rest="${rest%%\?*}"
  rest="${rest%%\#*}"

  if [[ -z "$rest" ]]; then
    return 1
  fi

  if [[ "$rest" == *:* ]]; then
    host="${rest%:*}"
    port="${rest##*:}"
  else
    host="$rest"
    port="5432"
  fi

  # Drop IPv6 brackets if present.
  host="${host#[}"
  host="${host%]}"

  if [[ -z "$host" || -z "$port" ]]; then
    return 1
  fi

  REPLY_HOST="$host"
  REPLY_PORT="$port"
}

load_shared_env() {
  local shared_env="${1:?shared .env path required}"

  if [[ ! -f "$shared_env" ]]; then
    printf '[env] ERROR: missing %s\n' "$shared_env" >&2
    return 1
  fi

  local loaded_url=""
  loaded_url="$(read_env_var DATABASE_URL "$shared_env" 2>/dev/null || true)"

  if [[ -z "$loaded_url" ]]; then
    loaded_url="$(build_database_url_from_postgres_vars "$shared_env")" || {
      printf '[env] ERROR: %s must set DATABASE_URL or POSTGRES_DB (+ POSTGRES_USER/POSTGRES_PASSWORD)\n' "$shared_env" >&2
      return 1
    }
    printf '[env] Built DATABASE_URL from POSTGRES_* in %s\n' "$shared_env"
  else
    printf '[env] Loaded DATABASE_URL from %s\n' "$shared_env"
  fi

  export DATABASE_URL="$loaded_url"
}

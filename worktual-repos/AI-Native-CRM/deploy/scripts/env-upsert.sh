# shellcheck shell=bash
# Source from deploy/scripts/*.sh — dedupe keys in deploy/.env (one assignment per key).
upsert_env() {
  local key="$1"
  local val="$2"
  local file="${3:-${ENV_FILE:?ENV_FILE required}}"
  if [[ ! -f "$file" ]]; then
    echo "${key}=${val}" >>"$file"
    return
  fi
  grep -v "^${key}=" "$file" >"${file}.tmp" || true
  echo "${key}=${val}" >>"${file}.tmp"
  mv "${file}.tmp" "$file"
}

env_last_value() {
  local key="$1"
  local file="${2:-${ENV_FILE:?}}"
  grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//;s/["'\''"]$//' || true
}

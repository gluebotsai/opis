#!/usr/bin/env bash
# Read one KEY=value from a dotenv file without sourcing (Gmail .env values break bash source).

read_env_var() {
  local key="${1:?key required}"
  local file="${2:?file required}"
  local line

  [[ -f "$file" ]] || return 1

  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -1)" || return 1
  line="${line#"${key}"=}"

  if [[ "$line" == \"*\" ]]; then
    line="${line:1:${#line}-2}"
  elif [[ "$line" == \'*\' ]]; then
    line="${line:1:${#line}-2}"
  fi

  printf '%s' "$line"
}

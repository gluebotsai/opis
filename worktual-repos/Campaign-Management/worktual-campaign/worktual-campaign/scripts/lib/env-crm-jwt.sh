#!/usr/bin/env bash
# Read CRM JWT-related keys from a dotenv file (no export of secrets to callers).
set -euo pipefail

CRM_JWT_KEYS=(
  CRM_JWT_ACCESS_SECRET
  CRM_JWT_ISSUER
  CRM_JWT_USER_ID_CLAIM
  CRM_JWT_ALGORITHM
)

env_file_get() {
  local key="$1"
  local file="$2"
  if [ ! -f "$file" ]; then
    return 1
  fi
  local line
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -1 || true)"
  if [ -z "$line" ]; then
    return 1
  fi
  local val="${line#*=}"
  val="${val#\"}"
  val="${val%\"}"
  val="${val#\'}"
  val="${val%\'}"
  printf '%s' "$val"
}

backend_crm_jwt_secret() {
  local file="$1"
  local v
  v="$(env_file_get CRM_JWT_ACCESS_SECRET "$file" 2>/dev/null || true)"
  if [ -n "$v" ]; then
    printf '%s' "$v"
    return 0
  fi
  env_file_get JWT_ACCESS_SECRET "$file" 2>/dev/null || true
}

agents_crm_jwt_secret() {
  backend_crm_jwt_secret "$1"
}

crm_jwt_secrets_match() {
  local backend_env="$1"
  local agents_env="$2"
  local b a
  b="$(backend_crm_jwt_secret "$backend_env")"
  a="$(agents_crm_jwt_secret "$agents_env")"
  if [ -z "$b" ] && [ -z "$a" ]; then
    return 2
  fi
  [ "$b" = "$a" ] && [ -n "$b" ]
}

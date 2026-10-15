#!/usr/bin/env bash
# Ping dual Redis endpoints (pubsub + store). Sourced by smoke scripts.
# Override via UR_REDIS_PUBSUB_* / UR_REDIS_STORE_* (same as process env).

redis_ping_one() {
  local host="$1" port="$2" pass="$3" label="$4"
  if [[ -n "${pass}" ]]; then
    if ! redis-cli -h "${host}" -p "${port}" -a "${pass}" --no-auth-warning ping 2>/dev/null | grep -qi pong; then
      echo "SKIP: Redis ${label} not available at ${host}:${port}"
      return 1
    fi
  else
    if ! redis-cli -h "${host}" -p "${port}" ping 2>/dev/null | grep -qi pong; then
      echo "SKIP: Redis ${label} not available at ${host}:${port}"
      return 1
    fi
  fi
  return 0
}

redis_ping_dual_defaults() {
  local pub_host="${UR_REDIS_PUBSUB_HOST:-10.180.2.106}"
  local pub_port="${UR_REDIS_PUBSUB_PORT:-6379}"
  local pub_pass="${UR_REDIS_PUBSUB_PASSWORD:-ppR3d15@2106}"
  local store_host="${UR_REDIS_STORE_HOST:-10.180.2.109}"
  local store_port="${UR_REDIS_STORE_PORT:-6379}"
  local store_pass="${UR_REDIS_STORE_PASSWORD:-ppR3d15@2109}"

  if ! command -v redis-cli >/dev/null 2>&1; then
    echo "SKIP: Redis not available (redis-cli missing)"
    return 1
  fi
  redis_ping_one "${pub_host}" "${pub_port}" "${pub_pass}" "pubsub" || return 1
  redis_ping_one "${store_host}" "${store_port}" "${store_pass}" "store" || return 1
  return 0
}

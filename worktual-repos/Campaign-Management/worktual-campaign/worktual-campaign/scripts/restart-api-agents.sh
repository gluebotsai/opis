#!/usr/bin/env bash
# Restart Campaign API (:3001/:3002) + agents (:8005).
# Processes are double-fork daemonized so they survive Cursor shell cleanup
# (plain nohup/disown was getting SIGKILL when the agent shell exited → login 500).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "${ROOT}/agents/tmp"

if [ -f "${ROOT}/backend/.env" ]; then
  bash "${ROOT}/scripts/sync-crm-jwt-to-agents.sh" || true
fi

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids}" ]]; then
    echo "Stopping :$port ($pids)"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

kill_orphan_backend_watchers() {
  local pid cmd
  echo "Scanning for orphan backend watchers under ${ROOT}…"
  while read -r pid; do
    [[ -z "${pid}" ]] && continue
    cmd=$(ps -p "${pid}" -o command= 2>/dev/null || true)
    [[ -z "${cmd}" ]] && continue
    case "${cmd}" in
      *tsx\ watch\ src/index.ts*)
        echo "Killing orphan tsx watch pid=${pid}"
        kill -9 "${pid}" 2>/dev/null || true
        ;;
      *"npm run dev:backend"*)
        if lsof -a -p "${pid}" -d cwd 2>/dev/null | grep -q "${ROOT}"; then
          echo "Killing orphan npm run dev:backend pid=${pid} (cwd match)"
          kill -9 "${pid}" 2>/dev/null || true
        fi
        ;;
    esac
  done < <(ps -axo pid= -o command= | grep -E 'tsx watch src/index\.ts|npm run dev:backend' | grep -v grep | awk '{print $1}' || true)
}

listen_pid() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

# Double-fork + setsid so the process is not in Cursor's shell process group.
daemonize() {
  local cwd="$1"
  local logfile="$2"
  shift 2
  /usr/bin/python3 - "$cwd" "$logfile" "$@" <<'PY'
import os, sys
cwd, logfile, *cmd = sys.argv[1:]
if os.fork() > 0:
    sys.exit(0)
os.setsid()
if os.fork() > 0:
    sys.exit(0)
os.chdir(cwd)
os.umask(0)
devnull = open(os.devnull, "r")
os.dup2(devnull.fileno(), 0)
out = open(logfile, "a", buffering=1)
os.dup2(out.fileno(), 1)
os.dup2(out.fileno(), 2)
os.execvp(cmd[0], cmd)
PY
}

for port in 3001 3002 8005; do
  kill_port "$port"
done

kill_orphan_backend_watchers
pkill -f "${ROOT}/agents/.venv/bin/python3.14 -m app.main" 2>/dev/null || true
pkill -f "${ROOT}/node_modules/.bin/tsx watch" 2>/dev/null || true
# Also stop a prior stable (non-watch) server for this tree.
pkill -f "${ROOT}/node_modules/tsx/dist/preflight.cjs" 2>/dev/null || true
sleep 1

TSX_BIN="${ROOT}/node_modules/.bin/tsx"
if [[ ! -x "${TSX_BIN}" ]]; then
  echo "tsx binary missing at ${TSX_BIN}" >&2
  exit 1
fi

echo "Starting stable backend (daemonized, no watch)…"
: > "${ROOT}/agents/tmp/_backend_restart.log"
daemonize "${ROOT}/backend" "${ROOT}/agents/tmp/_backend_restart.log" \
  "${TSX_BIN}" src/index.ts

echo "Starting agents (daemonized)…"
: > "${ROOT}/agents/tmp/_agents_restart.log"
daemonize "${ROOT}/agents" "${ROOT}/agents/tmp/_agents_restart.log" \
  env \
  MEDIA_ALLOW_LOCAL_PUBLISH=true \
  MEDIA_PUBLIC_DIRECT_ORIGIN=http://82.113.92.49:3001 \
  MEDIA_PUBLIC_HOST_HEADER=rebuild-campaign-api.worktual.com \
  "${ROOT}/agents/.venv/bin/python3.14" -m app.main

echo "Waiting for health…"
for i in $(seq 1 45); do
  b=$(curl -s -m 1 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health || echo 000)
  a=$(curl -s -m 1 -o /dev/null -w '%{http_code}' http://127.0.0.1:8005/health || echo 000)
  if [[ "$b" == "200" && "$a" == "200" ]]; then
    echo "$(listen_pid 3001)" > "${ROOT}/agents/tmp/_backend_pid.txt"
    echo "$(listen_pid 8005)" > "${ROOT}/agents/tmp/_agents_pid.txt"
    echo "OK backend=$b agents=$a (pids be=$(cat "${ROOT}/agents/tmp/_backend_pid.txt") ag=$(cat "${ROOT}/agents/tmp/_agents_pid.txt"))"
    leftover=$(ps -axo pid= -o command= | grep -E 'tsx watch src/index\.ts|npm run dev:backend' | grep -v grep || true)
    if [[ -n "${leftover}" ]]; then
      echo "WARNING: orphan watchers still present — killing again"
      kill_orphan_backend_watchers
      sleep 1
    fi
    npm run check:stack
    sleep 5
    if [[ "$(curl -s -m 1 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health || echo 000)" != "200" ]]; then
      echo "Backend died shortly after boot — see agents/tmp/_backend_restart.log"
      tail -40 agents/tmp/_backend_restart.log || true
      exit 1
    fi
    echo "Stable after settle check."
    exit 0
  fi
  sleep 1
done
echo "Timed out — see agents/tmp/_backend_restart.log and _agents_restart.log"
tail -30 agents/tmp/_backend_restart.log || true
tail -30 agents/tmp/_agents_restart.log || true
exit 1

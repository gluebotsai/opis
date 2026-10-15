#!/usr/bin/env bash
# Start single ngrok gateway → dev-gateway-proxy (:8080).
# Auth: NGROK_AUTHTOKEN env, or personal ngrok.yml under Application Support / .config
# Tunnel: repo ngrok.yml domain (override with NGROK_DOMAIN)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO_CONFIG="${ROOT}/ngrok.yml"
DEFAULT_DOMAIN="uninvited-skinless-eel.ngrok-free.dev"
if [[ -f "$REPO_CONFIG" ]]; then
  DEFAULT_DOMAIN="$(
    python3 - "$REPO_CONFIG" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"(?m)^\s*domain:\s*(\S+)\s*$", text)
print(m.group(1) if m else "uninvited-skinless-eel.ngrok-free.dev")
PY
  )"
fi
# NGROK_DOMAIN: reserved hostname on *your* ngrok account, or "ephemeral" / "random" for a new URL each start.
DOMAIN="${NGROK_DOMAIN:-$DEFAULT_DOMAIN}"
PROXY_PORT="${GATEWAY_PROXY_PORT:-8080}"

if ! curl -sf "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
  echo "Gateway proxy is not listening on :${PROXY_PORT}. Run: npm run dev:gateway-proxy"
  exit 1
fi

# Stop any previous ngrok http / named start (avoid ERR_NGROK_334 / stale agent)
pkill -f "ngrok http" 2>/dev/null || true
pkill -f "ngrok start" 2>/dev/null || true
sleep 1

AUTH_CONFIG=""
for candidate in \
  "${NGROK_AUTH_CONFIG:-}" \
  "$HOME/Library/Application Support/ngrok/ngrok.yml" \
  "$HOME/.config/ngrok/ngrok.yml" \
  "$HOME/.ngrok2/ngrok.yml"; do
  if [[ -n "$candidate" && -f "$candidate" ]]; then
    AUTH_CONFIG="$candidate"
    break
  fi
done

start_ngrok() {
  local -a args=("http")
  local label
  if [[ "$DOMAIN" == "ephemeral" || "$DOMAIN" == "random" ]]; then
    label="ephemeral URL"
    args+=("${PROXY_PORT}")
  else
    label="${DOMAIN}"
    # ngrok v3: --domain is deprecated; --url is the stable flag for reserved domains.
    args+=("--url=https://${DOMAIN}" "--pooling-enabled" "${PROXY_PORT}")
  fi
  if [[ -n "${NGROK_AUTHTOKEN:-}" ]]; then
    echo "Starting ngrok → :${PROXY_PORT} (${label})"
  elif [[ -n "$AUTH_CONFIG" ]]; then
    echo "Starting ngrok → :${PROXY_PORT} (${label}) using auth from ${AUTH_CONFIG}"
    args=("--config=${AUTH_CONFIG}" "${args[@]}")
  else
    echo "Set NGROK_AUTHTOKEN or install ngrok auth config, then retry."
    exit 1
  fi

  if command -v setsid >/dev/null 2>&1; then
    setsid ngrok "${args[@]}" >> /tmp/ngrok.log 2>&1 < /dev/null &
  else
    nohup ngrok "${args[@]}" >> /tmp/ngrok.log 2>&1 < /dev/null &
  fi
}

: > /tmp/ngrok.log
start_ngrok

sleep 5
if curl -sf http://127.0.0.1:4040/api/tunnels >/dev/null; then
  curl -s http://127.0.0.1:4040/api/tunnels | python3 -c "
import json, sys
tunnels = json.load(sys.stdin).get('tunnels', [])
if not tunnels:
    raise SystemExit('ngrok API up but no tunnels')
for t in tunnels:
    print(f\"{t.get('name', 'tunnel')}: {t['public_url']} -> {t['config']['addr']}\")
"
  PUBLIC_URL="$(
    curl -s http://127.0.0.1:4040/api/tunnels | python3 -c "
import json, sys
print(json.load(sys.stdin)['tunnels'][0]['public_url'])
"
  )"
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H 'ngrok-skip-browser-warning: 1' "${PUBLIC_URL}/health" || true)"
  echo "Public health: ${code} (${PUBLIC_URL}/health)"
  if [[ "$code" != "200" ]]; then
    echo "Warning: public health check did not return 200 — tunnel may still be warming up."
  fi
else
  echo "ngrok failed to start. Last log lines:"
  tail -20 /tmp/ngrok.log
  exit 1
fi

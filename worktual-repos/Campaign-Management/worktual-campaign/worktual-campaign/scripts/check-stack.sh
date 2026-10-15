#!/usr/bin/env bash
# Verify Campaign dev stack — HTTP + Socket.IO proxy paths.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

LAN_IP=""
for iface in en0 en1 en2; do
  LAN_IP="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  [ -n "$LAN_IP" ] && break
done
LAN_IP="${LAN_IP:-127.0.0.1}"
FE="http://${LAN_IP}:5173"

check() {
  local label="$1"
  local url="$2"
  shift 2
  code=$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "$@" "$url" 2>/dev/null || echo 000)
  if [ "$code" = "200" ] || [ "$code" = "204" ]; then
    echo "  OK  $label ($code)"
  else
    echo "  FAIL $label ($code) $url"
  fi
}

echo "LAN IP: $LAN_IP"
echo "Frontend env:"
grep -E '^VITE_(AGENTS|PUBLIC|API)' "$ROOT/frontend/.env.local" 2>/dev/null || grep -E '^VITE_' "$ROOT/frontend/.env" 2>/dev/null || echo "  (no .env)"
echo
echo "Ports:"
lsof -i :5173 -i :3001 -i :3002 -i :8005 -i :8040 2>/dev/null | grep LISTEN || echo "  none listening"
echo
echo "Health:"
check "frontend" "$FE/"
check "backend"  "http://${LAN_IP}:3001/health"
check "agents"   "http://${LAN_IP}:8005/health"
check "A2A spoke" "http://${LAN_IP}:8040/health"
check "A2A hub ready" "http://${LAN_IP}:8040/ready"
check "agents socket proxy (polling)" "$FE/agents-socket/?EIO=4&transport=polling" -H "Origin: $FE"
check "campaign socket proxy (polling)" "$FE/socket-io/?EIO=4&transport=polling" -H "Origin: $FE"
echo
echo "Expected browser WebSocket (agents chat): ws://${LAN_IP}:5173/agents-socket/"

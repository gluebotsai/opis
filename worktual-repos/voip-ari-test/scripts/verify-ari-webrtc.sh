#!/usr/bin/env bash
# Sanity verification for ARI 1:1 WebRTC PSTN implementation (no live PSTN required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Checking Asterisk WebRTC config"
grep -q 'transport-ws' docker/asterisk/config/pjsip.conf
grep -q '\[w1001\]' docker/asterisk/config/pjsip.conf
grep -q 'webrtc=yes' docker/asterisk/config/pjsip.conf
grep -q 'Stasis(telephony,inbound' docker/asterisk/config/extensions.conf
echo "    pjsip/extensions OK"

echo "==> Checking adapter CallSession + command handlers"
grep -q 'CallSessionService' adapters/asterisk-adapter/src/app.module.ts
grep -q 'join_bridge' adapters/asterisk-adapter/src/services/ari.service.ts
grep -q 'handleOriginate' adapters/asterisk-adapter/src/services/command.listener.ts
grep -q 'cleanupSession' adapters/asterisk-adapter/src/services/ari.service.ts
echo "    adapter OK"

echo "==> Checking API routes"
grep -q "Controller('api/v1/calls')" apps/api/src/calls/calls.controller.ts
grep -q 'agentExtension' apps/api/src/calls/calls.controller.ts
grep -q "case 'call.bridged'" apps/api/src/events/events.gateway.ts
echo "    API OK"

echo "==> Checking admin-ui WebRTC softphone"
test -f apps/admin-ui/src/services/webrtc-softphone.service.ts
grep -q 'sip.js' apps/admin-ui/package.json
grep -q 'webrtcSoftphone' apps/admin-ui/src/App.tsx
grep -q 'api/v1/calls' apps/admin-ui/src/App.tsx
echo "    admin-ui OK"

echo "==> TypeScript compile (adapter + admin-ui)"
npx tsc --noEmit -p adapters/asterisk-adapter/tsconfig.json
npx tsc --noEmit -p apps/admin-ui/tsconfig.json
echo "    tsc OK"

echo ""
echo "Static verification PASSED."
echo "Live E2E (requires Docker + trunk):"
echo "  1. docker compose up -d --build asterisk"
echo "  2. npm start"
echo "  3. Open agent-ui http://HOST:5174 , confirm SIP w1001 Registered (ws://HOST:8089/ws)"
echo "  4. Inbound PSTN -> Accept -> two-way audio"
echo "  5. Outbound dial PSTN -> call.bridged -> two-way audio"

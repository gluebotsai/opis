#!/usr/bin/env node
/**
 * E2E ARI bridge test against remote Asterisk (no browser).
 * Uses Local/600@from-internal so ;2 side has a working dialplan (Echo).
 *
 * Usage: node scripts/e2e-ari-bridge-test.mjs
 */
import { randomUUID } from 'crypto';

const ARI = process.env.ARI_URL || 'http://82.113.92.45:8088';
const USER = process.env.ARI_USER || 'telephony';
const PASS = process.env.ARI_PASSWORD || 'telephony_password';
const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');

async function ari(method, path, body) {
  const res = await fetch(`${ARI}/ari${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`ARI ${method} ${path} -> ${res.status}: ${text}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function originateLocal(callId, bridgeId, role) {
  // Local/600@from-internal: ;1 enters Stasis(appArgs), ;2 runs Echo dialplan
  const qs = new URLSearchParams({
    endpoint: 'Local/600@from-internal',
    app: 'telephony',
    appArgs: `join_bridge,${callId},${bridgeId},${role}`,
    callerId: role === 'agent' ? 'E2E Agent' : 'E2E Caller',
    timeout: '15',
  });
  return ari('POST', `/channels?${qs.toString()}`);
}

async function main() {
  console.log('==> ARI E2E bridge test against', ARI);
  const callId = randomUUID();

  const apps = await ari('GET', '/applications');
  if (!apps.find((a) => a.name === 'telephony')) {
    throw new Error('Stasis app "telephony" not running — start asterisk-adapter on the server');
  }
  console.log('OK Stasis app telephony');

  const ep = await ari('GET', '/endpoints/PJSIP/w1001');
  console.log('w1001 state:', ep.state);

  const bridge = await ari('POST', '/bridges', { type: 'mixing', name: `e2e_${callId}` });
  console.log('bridge', bridge.id);

  const caller = await originateLocal(callId, bridge.id, 'pstn');
  console.log('caller', caller.id);
  await sleep(1000);

  const agent = await originateLocal(callId, bridge.id, 'agent');
  console.log('agent', agent.id);
  await sleep(2000);

  const bridgeState = await ari('GET', `/bridges/${bridge.id}`);
  const channels = bridgeState.channels || [];
  console.log('bridge channels:', channels);

  // Cleanup
  for (const id of [caller.id, agent.id]) {
    try {
      await ari('DELETE', `/channels/${id}`);
    } catch {
      /* ignore */
    }
  }
  try {
    await ari('DELETE', `/bridges/${bridge.id}`);
  } catch {
    /* ignore */
  }

  // Also hangup any leftover Local ;2 channels
  const live = await ari('GET', '/channels');
  for (const ch of live) {
    if (String(ch.name || '').includes('Local/600')) {
      try {
        await ari('DELETE', `/channels/${ch.id}`);
      } catch {
        /* ignore */
      }
    }
  }

  if (channels.length < 2) {
    console.error('FAIL: expected >=2 channels in mixing bridge, got', channels.length);
    console.error('If 0: adapter may still be killing join_bridge without session — redeploy adapter fix.');
    process.exit(1);
  }

  console.log('PASS: ARI mixing bridge has', channels.length, 'channels');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

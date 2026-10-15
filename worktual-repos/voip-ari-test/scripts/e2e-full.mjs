#!/usr/bin/env node
/**
 * Full E2E checks against production host (default 82.113.92.45)
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.E2E_HOST || '82.113.92.45';
const ARI = process.env.ARI_URL || `http://${HOST}:8088`;
const API = process.env.API_URL || `http://${HOST}:3000`;
const WS_SIP = process.env.ASTERISK_WSS_URL || `ws://${HOST}:8088/ws`;
const USER = process.env.ARI_USER || 'telephony';
const PASS = process.env.ARI_PASSWORD || 'telephony_password';
const API_KEY = process.env.API_KEY || 'demo-tenant-api-key-12345';
const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');

const results = [];
const pass = (name, detail = '') => {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`);
};
const fail = (name, detail = '') => {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
};

async function ari(method, path) {
  const res = await fetch(`${ARI}/ari${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}` },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
  return json;
}

async function main() {
  console.log('E2E host', HOST);
  console.log('ARI', ARI, '| API', API, '| WS', WS_SIP);
  console.log('');

  try {
    const info = await ari('GET', '/asterisk/info');
    pass('ARI reachable', info.system?.version || '');
  } catch (e) {
    fail('ARI reachable', e.message);
  }

  try {
    const apps = await ari('GET', '/applications');
    if (apps.find((a) => a.name === 'telephony')) pass('Stasis app telephony');
    else fail('Stasis app telephony', 'not found');
  } catch (e) {
    fail('Stasis app telephony', e.message);
  }

  try {
    const res = await fetch(`${API}/api/docs`);
    if (res.ok) pass('API gateway', String(res.status));
    else fail('API gateway', String(res.status));
  } catch (e) {
    fail('API gateway', e.message);
  }

  try {
    const res = await fetch(`${API}/api/v1/calls/fake/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ agentExtension: 'w1001' }),
    });
    if (res.ok) pass('API answer route', `HTTP ${res.status}`);
    else fail('API answer route', `HTTP ${res.status}`);
  } catch (e) {
    fail('API answer route', e.message);
  }

  // Live register + originate + INVITE (authoritative media-signaling check)
  console.log('\n-- register + ring --');
  const ring = spawnSync(process.execPath, [join(__dirname, 'e2e-register-and-ring.mjs')], {
    env: { ...process.env, E2E_HOST: HOST, ARI_URL: ARI, ASTERISK_WSS_URL: WS_SIP },
    encoding: 'utf8',
  });
  process.stdout.write(ring.stdout || '');
  process.stderr.write(ring.stderr || '');
  if (ring.status === 0) pass('WebRTC register + agent INVITE');
  else fail('WebRTC register + agent INVITE', `exit ${ring.status}`);

  console.log('');
  const failed = results.filter((r) => !r.ok);
  console.log(`Summary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);

  console.log('\nManual inbound test:');
  console.log(`  1. Open agent UI with VITE_ASTERISK_WSS_URL=${WS_SIP}`);
  console.log('  2. Wait for green SIP w1001');
  console.log('  3. Place PSTN inbound call to +914440004407');
  console.log('  4. Click Accept — should bridge (not Allocation failed)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

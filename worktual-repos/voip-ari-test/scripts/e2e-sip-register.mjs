#!/usr/bin/env node
/**
 * E2E SIP REGISTER over Asterisk WebSocket (no mic/WebRTC needed for register).
 * Usage: node scripts/e2e-sip-register.mjs
 */
import { UserAgent, Registerer, RegistererState } from 'sip.js';
import WebSocket from 'ws';

const WS_URL = process.env.ASTERISK_WSS_URL || 'ws://82.113.92.45:8088/ws';
const EXT = process.env.VITE_AGENT_EXTENSION || 'w1001';
const PASS = process.env.VITE_AGENT_PASSWORD || 'webrtc_pass1001';
const HOST = new URL(WS_URL.replace(/^ws/, 'http')).hostname;

// sip.js expects browser WebSocket; polyfill for Node
globalThis.WebSocket = WebSocket;

async function main() {
  console.log('==> SIP REGISTER', EXT, 'via', WS_URL);

  const uri = UserAgent.makeURI(`sip:${EXT}@${HOST}`);
  if (!uri) throw new Error('bad uri');

  const ua = new UserAgent({
    uri,
    transportOptions: { server: WS_URL },
    authorizationUsername: EXT,
    authorizationPassword: PASS,
    logBuiltinEnabled: false,
    sessionDescriptionHandlerFactoryOptions: {
      constraints: { audio: false, video: false },
    },
  });

  const registerer = new Registerer(ua, { expires: 60 });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('REGISTER timeout 15s')), 15000);
    registerer.stateChange.addListener((state) => {
      console.log('registerer state:', state);
      if (state === RegistererState.Registered) {
        clearTimeout(timer);
        resolve();
      }
      if (state === RegistererState.Terminated) {
        clearTimeout(timer);
        reject(new Error('registerer terminated'));
      }
    });
    ua.start()
      .then(() => registerer.register())
      .catch(reject);
  });

  console.log('PASS: SIP registered', EXT);

  // Verify via ARI
  const ARI = process.env.ARI_URL || 'http://82.113.92.45:8088';
  const auth = Buffer.from(
    `${process.env.ARI_USER || 'telephony'}:${process.env.ARI_PASSWORD || 'telephony_password'}`,
  ).toString('base64');
  const res = await fetch(`${ARI}/ari/endpoints/PJSIP/${EXT}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const ep = await res.json();
  console.log('ARI endpoint after register:', ep.state, ep.channel_ids);

  await registerer.unregister().catch(() => {});
  await ua.stop().catch(() => {});

  if (ep.state === 'offline') {
    console.error('FAIL: ARI still shows offline after REGISTER (Asterisk may reject contact)');
    process.exit(1);
  }
  console.log('PASS: ARI shows endpoint online');
}

main().catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});

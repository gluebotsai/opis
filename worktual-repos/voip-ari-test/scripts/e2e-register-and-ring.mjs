#!/usr/bin/env node
/**
 * Keep w1001 REGISTERED over WebSocket, then ARI-originate to it.
 * Proves Accept path (Allocation failed is gone when contact is live).
 */
import WebSocket from 'ws';
import crypto from 'crypto';

const HOST = process.env.E2E_HOST || '82.113.92.45';
const WS_URL = process.env.ASTERISK_WSS_URL || `ws://${HOST}:8088/ws`;
const ARI = process.env.ARI_URL || `http://${HOST}:8088`;
const EXT = 'w1001';
const PASS = 'webrtc_pass1001';
const auth = Buffer.from(
  `${process.env.ARI_USER || 'telephony'}:${process.env.ARI_PASSWORD || 'telephony_password'}`,
).toString('base64');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

async function ari(method, path, body) {
  const res = await fetch(`${ARI}/ari${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
  return json;
}

function buildRegister({ cseq, branch, callId, tag, authHeader }) {
  const lines = [
    `REGISTER sip:${HOST} SIP/2.0`,
    `Via: SIP/2.0/WS e2e.local;branch=${branch};rport`,
    `Max-Forwards: 70`,
    `From: <sip:${EXT}@${HOST}>;tag=${tag}`,
    `To: <sip:${EXT}@${HOST}>`,
    `Call-ID: ${callId}`,
    `CSeq: ${cseq} REGISTER`,
    `Contact: <sip:${EXT}@e2e.local;transport=ws>;expires=120`,
    `Expires: 120`,
    `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, REGISTER`,
  ];
  if (authHeader) lines.push(authHeader);
  lines.push('Content-Length: 0', '', '');
  return lines.join('\r\n');
}

async function main() {
  console.log('WS', WS_URL);
  const ws = new WebSocket(WS_URL, 'sip');
  await new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
    setTimeout(() => rej(new Error('open timeout')), 8000);
  });

  const callId = `e2e-keep-${Date.now()}@local`;
  const tag = 'keep1';
  let inviteSeen = false;

  ws.on('message', (buf) => {
    const msg = buf.toString();
    if (msg.startsWith('INVITE ')) {
      inviteSeen = true;
      console.log('PASS: received INVITE from Asterisk (agent ring works)');
      // Minimal 480 so we don't leave a hanging channel without SDP
      const call = /Call-ID: ([^\r\n]+)/i.exec(msg)?.[1];
      const via = /Via: ([^\r\n]+)/i.exec(msg)?.[1];
      const from = /From: ([^\r\n]+)/i.exec(msg)?.[1];
      const to = /To: ([^\r\n]+)/i.exec(msg)?.[1];
      const cseq = /CSeq: ([^\r\n]+)/i.exec(msg)?.[1];
      const reject = [
        'SIP/2.0 480 Temporarily Unavailable',
        `Via: ${via}`,
        `From: ${from}`,
        `To: ${to};tag=e2erej`,
        `Call-ID: ${call}`,
        `CSeq: ${cseq}`,
        'Content-Length: 0',
        '',
        '',
      ].join('\r\n');
      ws.send(reject);
    }
  });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitMsg = (pred, ms = 8000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting SIP')), ms);
      const handler = (buf) => {
        const msg = buf.toString();
        if (pred(msg)) {
          clearTimeout(t);
          ws.off('message', handler);
          resolve(msg);
        }
      };
      ws.on('message', handler);
    });

  ws.send(buildRegister({ cseq: 1, branch: 'z9hG4bK-1', callId, tag }));
  let resp = await waitMsg((m) => m.includes('SIP/2.0'));
  if (/401|407/.test(resp)) {
    const realm = /realm="([^"]+)"/.exec(resp)[1];
    const nonce = /nonce="([^"]+)"/.exec(resp)[1];
    const uri = `sip:${HOST}`;
    const response = md5(`${md5(`${EXT}:${realm}:${PASS}`)}:${nonce}:${md5(`REGISTER:${uri}`)}`);
    const authHeader = `Authorization: Digest username="${EXT}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
    ws.send(buildRegister({ cseq: 2, branch: 'z9hG4bK-2', callId, tag, authHeader }));
    resp = await waitMsg((m) => m.includes('SIP/2.0') && !m.startsWith('INVITE'));
  }
  if (!/200 OK/.test(resp)) throw new Error('REGISTER failed:\n' + resp.slice(0, 400));
  console.log('PASS: REGISTER 200 — keeping WS open');

  await wait(500);
  const ep = await ari('GET', `/endpoints/PJSIP/${EXT}`);
  console.log('ARI endpoint state:', ep.state, 'channels', ep.channel_ids?.length || 0);
  if (ep.state === 'offline') {
    // Some Asterisk builds report unavailable until qualify; try originate anyway
    console.log('WARN: ARI still offline; trying originate anyway');
  } else {
    console.log('PASS: ARI shows', ep.state);
  }

  // Originate to agent — this is what ANSWER does
  try {
    const chan = await ari(
      'POST',
      `/channels?${new URLSearchParams({
        endpoint: `PJSIP/${EXT}`,
        app: 'telephony',
        appArgs: 'join_bridge,e2e-test,e2e-bridge,agent',
        callerId: 'E2E Ring Test',
        timeout: '15',
      })}`,
    );
    console.log('PASS: ARI originate created channel', chan.id);
    await wait(3000);
    try {
      await ari('DELETE', `/channels/${chan.id}`);
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.error('FAIL: ARI originate', e.message);
    ws.close();
    process.exit(1);
  }

  if (!inviteSeen) {
    console.error('FAIL: no INVITE received on WebSocket (originate may have failed media/signaling)');
    ws.close();
    process.exit(1);
  }

  console.log('PASS: E2E agent ring path OK (register + originate + INVITE)');
  ws.close();
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});

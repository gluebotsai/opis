#!/usr/bin/env node
import WebSocket from 'ws';
import crypto from 'crypto';

const HOST = process.env.E2E_HOST || '82.113.92.45';
const WS_URL = process.env.ASTERISK_WSS_URL || `ws://${HOST}:8088/ws`;
const EXT = process.env.VITE_AGENT_EXTENSION || 'w1001';
const PASS = process.env.VITE_AGENT_PASSWORD || 'webrtc_pass1001';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function buildRegister({ cseq, branch, callId, tag, authHeader }) {
  const lines = [
    `REGISTER sip:${HOST} SIP/2.0`,
    `Via: SIP/2.0/WS e2e.local;branch=${branch};rport`,
    `Max-Forwards: 70`,
    `From: <sip:${EXT}@${HOST}>;tag=${tag}`,
    `To: <sip:${EXT}@${HOST}>`,
    `Call-ID: ${callId}`,
    `CSeq: ${cseq} REGISTER`,
    `Contact: <sip:${EXT}@e2e.local;transport=ws>;expires=60`,
    `Expires: 60`,
    `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, REGISTER`,
    `User-Agent: voip-e2e-test`,
  ];
  if (authHeader) lines.push(authHeader);
  lines.push('Content-Length: 0', '', '');
  return lines.join('\r\n');
}

async function main() {
  console.log('Connecting', WS_URL);
  const ws = new WebSocket(WS_URL, 'sip');

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), 8000);
    ws.on('open', () => {
      clearTimeout(t);
      resolve();
    });
    ws.on('error', reject);
  });
  console.log('WS open');

  const callId = `e2e-${Date.now()}@local`;
  const tag = 'tage2e';
  let cseq = 1;

  const waitMsg = () =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('SIP response timeout')), 10000);
      ws.once('message', (data) => {
        clearTimeout(t);
        resolve(data.toString());
      });
    });

  ws.send(
    buildRegister({
      cseq,
      branch: `z9hG4bK-${cseq}`,
      callId,
      tag,
    }),
  );
  console.log('sent REGISTER #1');
  let resp = await waitMsg();
  console.log('--- response #1 ---\n' + resp.slice(0, 1500));

  if (resp.includes('401') || resp.includes('407')) {
    const realm = /realm="([^"]+)"/.exec(resp)?.[1];
    const nonce = /nonce="([^"]+)"/.exec(resp)?.[1];
    if (!realm || !nonce) throw new Error('no realm/nonce in challenge');
    const uri = `sip:${HOST}`;
    const ha1 = md5(`${EXT}:${realm}:${PASS}`);
    const ha2 = md5(`REGISTER:${uri}`);
    const response = md5(`${ha1}:${nonce}:${ha2}`);
    cseq = 2;
    const authHeader = `Authorization: Digest username="${EXT}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
    ws.send(buildRegister({ cseq, branch: `z9hG4bK-${cseq}`, callId, tag, authHeader }));
    console.log('sent REGISTER #2 (auth) realm=', realm);
    resp = await waitMsg();
    console.log('--- response #2 ---\n' + resp.slice(0, 1500));
  }

  ws.close();

  if (/SIP\/2.0 200/.test(resp)) {
    console.log('PASS: REGISTER 200 OK');
    process.exit(0);
  }
  console.error('FAIL: REGISTER did not return 200');
  process.exit(1);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});

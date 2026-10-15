/**
 * run: npx tsx src/features/voice/sip-outbound.test.ts
 */
import assert from "node:assert/strict";
import {
  applyLegacySipHeaders,
  composeDialedNumber,
  CRM_INVITE_HEADER,
  incomingInfoCallStatus,
  isIncomingSipBye,
  isIncomingSipInfo,
  LEGACY_INVITE_ALLOW,
  normalizeDialedNumber,
  sipInviteTarget,
  receivedHostFromSipResponse,
  sipOkForIncomingBye,
  sipOkForIncomingInfo,
} from "./sip-outbound.ts";

assert.equal(normalizeDialedNumber("+91 83100 39824"), "918310039824");
assert.equal(composeDialedNumber("+91", "9150911820"), "919150911820");
assert.equal(composeDialedNumber("+91", "+919150911820"), "919150911820");
assert.equal(composeDialedNumber("+91", "919384427139"), "919384427139");
assert.equal(composeDialedNumber("+91", "00919384427139"), "919384427139");
assert.equal(
  sipInviteTarget("919384427139", "20643.call.worktual.com"),
  "sip:919384427139@20643.call.worktual.com",
);

const raw = [
  "INVITE sip:919384427139@20643.call.worktual.com SIP/2.0",
  "Via: SIP/2.0/WSS 192.168.13.29;branch=z9hG4bK1",
  "Max-Forwards: 69",
  "Call-ID: abc",
  "CSeq: 1 INVITE",
  "Allow: INVITE",
  "Supported: path",
  "Content-Length: 0",
  "",
  "",
].join("\r\n");

const next = applyLegacySipHeaders(raw, "192.168.13.29:5060", "95q3dbbr", "+919003003819");
assert.match(next, new RegExp(`^${CRM_INVITE_HEADER}$`, "m"));
assert.match(next, /^X-Outbound-Number: \+919003003819$/m);
assert.match(next, new RegExp(`^Allow: ${LEGACY_INVITE_ALLOW}$`, "m"));
assert.match(next, /^Org-Call-ID: abc$/m);
assert.doesNotMatch(next, /^IS-CRM-USER:.*\nIS-CRM-USER:/m);

const register = [
  "REGISTER sip:20643.call.worktual.com SIP/2.0",
  "Call-ID: reg",
  "CSeq: 1 REGISTER",
  "Content-Length: 0",
  "",
  "",
].join("\r\n");
assert.equal(applyLegacySipHeaders(register), register);

const forbidden = [
  "SIP/2.0 403 Forbidden",
  "Via: SIP/2.0/WSS 82.113.92.113;branch=z9hG4bK7472544;received=202.160.13.159;rport=65245",
  "From: <sip:1003@1003.call.worktual.com>;tag=627897j71b",
  "To: <sip:1003@1003.call.worktual.com>;tag=4j21c1e0e35f",
  "Call-ID: 1b3j0l8n0hc061crpn25r",
  "CSeq: 1 REGISTER",
  "Content-Length: 0",
  "",
  "",
].join("\r\n");
assert.equal(receivedHostFromSipResponse(forbidden), "202.160.13.159");
assert.equal(receivedHostFromSipResponse(register), null);

const info = [
  "INFO sip:x6baic2b@192.168.13.29:55318;transport=wss SIP/2.0",
  "Via: SIP/2.0/WSS 82.113.92.86:57344;branch=z9hG4bK1",
  "From: <sip:919150911820@1000.call.worktual.com>;tag=from",
  "To: <sip:100@1000.call.worktual.com:5060>;tag=to",
  "Call-ID: va6qkemc8cnkg9169kag",
  "CSeq: 120842506 INFO",
  "Content-Type: application/xml",
  "Content-Length: 80",
  "",
  '<?xml version="1.0"?><call-info callstatus="connected" calltype="one-one"/>',
  "",
].join("\r\n");
assert.equal(isIncomingSipInfo(info), true);
assert.equal(incomingInfoCallStatus(info), "connected");
const infoOk = sipOkForIncomingInfo(info);
assert.ok(infoOk);
assert.match(infoOk, /^SIP\/2\.0 200 OK/);
assert.match(infoOk, /^CSeq: 120842506 INFO$/m);
assert.doesNotMatch(infoOk, /call-info/);

const bye = info.replace(/^INFO /m, "BYE ").replace("INFO", "BYE");
assert.equal(isIncomingSipBye(bye), true);
const byeOk = sipOkForIncomingBye(bye);
assert.ok(byeOk);
assert.match(byeOk, /^SIP\/2\.0 200 OK/);
assert.match(byeOk, /^CSeq: 120842506 BYE$/m);

console.log("sip-outbound.test.ts ok");

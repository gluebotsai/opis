import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_INVITE_ALLOW,
  LEGACY_INVITE_SUPPORTED,
  applyLegacySipHeaders,
  composeDialedNumber,
  localNumberAfterDialCode,
  contactOutboundNumber,
  extractSipUser,
  isIncomingSipBye,
  normalizeDialedNumber,
  registeredHostPortFromRegister200,
  normalizeRemoteAnswerSdp,
  rewriteSdpLocalAddresses,
  sipInviteTarget,
  sipOkForIncomingBye,
  sipOkForIncomingInfo,
  shouldAutoOpenDialPad,
  withOrgCallIdHeader,
} from "./sip-outbound.ts";

test("dial pad auto-opens only for outbound live calls", () => {
  assert.equal(shouldAutoOpenDialPad({ callState: "dialing", direction: "outbound" }), true);
  assert.equal(shouldAutoOpenDialPad({ callState: "ringing", direction: "outbound" }), true);
  assert.equal(shouldAutoOpenDialPad({ callState: "active", direction: "outbound" }), true);
  assert.equal(shouldAutoOpenDialPad({ callState: "active", direction: "inbound" }), false);
  assert.equal(shouldAutoOpenDialPad({ callState: "ringing", direction: "inbound" }), false);
  assert.equal(shouldAutoOpenDialPad({ callState: "active" }), false);
  assert.equal(shouldAutoOpenDialPad({ callState: "idle", direction: "outbound" }), false);
});

test("contact call numbers drop plus and add 91 only when the country code is missing", () => {
  assert.equal(contactOutboundNumber("+91 9150911820"), "919150911820");
  assert.equal(contactOutboundNumber("9150911820"), "919150911820");
  assert.equal(contactOutboundNumber("919150911820"), "919150911820");
  assert.equal(contactOutboundNumber("00919150911820"), "919150911820");
  assert.equal(contactOutboundNumber("09150911820"), "919150911820");
  assert.equal(contactOutboundNumber("+1 415 555 2671"), "14155552671");
  assert.equal(contactOutboundNumber("  "), null);
  assert.equal(contactOutboundNumber(null), null);
});

test("normalizeDialedNumber strips plus and spaces", () => {
  assert.equal(normalizeDialedNumber("+91 83100 39824"), "918310039824");
  assert.equal(normalizeDialedNumber("918310039824"), "918310039824");
});

test("applyLegacySipHeaders keeps consult transfer headers on INVITE", () => {
  const raw = [
    "INVITE sip:208@1000.call.worktual.com SIP/2.0",
    "Via: SIP/2.0/WSS 192.168.1.10;branch=z9hG4bK1",
    "Call-ID: abc",
    "Allow: INVITE",
    "Supported: path",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");
  const next = applyLegacySipHeaders(
    raw,
    "192.168.1.10:5060",
    null,
    null,
    [
      "CCAAS-SESSION-ID: +918056113197437435e7-2ee8-1240-548c-bc2411a168a2",
      "CCAAS-FEATURE-REQ: TRANSFER",
      "CCAAS-TRANSFER-TYPE: AGENT",
    ],
  );
  assert.match(next, /CCAAS-FEATURE-REQ: TRANSFER/);
  assert.match(next, /CCAAS-TRANSFER-TYPE: AGENT/);
});

test("sipInviteTarget has no signaling port", () => {
  assert.equal(
    sipInviteTarget("918310039824", "1000.call.worktual.com"),
    "sip:918310039824@1000.call.worktual.com",
  );
});

test("composeDialedNumber prefixes the selected country code", () => {
  assert.equal(composeDialedNumber("+91", "9150911820"), "919150911820");
  assert.equal(composeDialedNumber("+91", "+919150911820"), "919150911820");
});

test("localNumberAfterDialCode keeps a national number that starts with the country digits", () => {
  assert.equal(localNumberAfterDialCode("9150911820", "+91"), null);
  assert.equal(localNumberAfterDialCode("919150911820", "+91"), "9150911820");
  assert.equal(localNumberAfterDialCode("+919150911820", "+91"), "9150911820");
});

test("extractSipUser reads the URI user", () => {
  assert.equal(extractSipUser('From: " " <sip:101@1000.call.worktual.com:5060>;tag=abc'), "101");
});

test("registeredHostPortFromRegister200 uses Contact port", () => {
  const raw = [
    "SIP/2.0 200 OK",
    "Via: SIP/2.0/WSS 192.168.13.164;branch=z9hG4bK1",
    "CSeq: 2 REGISTER",
    "Contact: <sip:101@192.168.13.164:64385;transport=wss>;expires=600",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");

  assert.equal(registeredHostPortFromRegister200(raw), "192.168.13.164:64385");
});

test("registeredHostPortFromRegister200 uses Via rport when Contact has no port", () => {
  const raw = [
    "SIP/2.0 200 OK",
    "Via: SIP/2.0/WSS 192.168.13.164;branch=z9hG4bK1;received=203.0.113.10;rport=64385",
    "CSeq: 2 REGISTER",
    "Contact: <sip:101@192.168.13.164;transport=wss>;expires=600",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");

  assert.equal(registeredHostPortFromRegister200(raw), "192.168.13.164:64385");
});

test("registeredHostPortFromRegister200 uses Via host:rport when Contact is 0.0.0.0", () => {
  const raw = [
    "SIP/2.0 200 OK",
    "Via: SIP/2.0/WSS 192.168.11.92;branch=z9hG4bK1;rport=64385",
    "CSeq: 2 REGISTER",
    "Contact: <sip:101@0.0.0.0;transport=wss>;expires=600",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");

  assert.equal(registeredHostPortFromRegister200(raw), "192.168.11.92:64385");
});

test("withOrgCallIdHeader copies Call-ID onto INVITE", () => {
  const raw = [
    "INVITE sip:918310039824@1000.call.worktual.com SIP/2.0",
    "Via: SIP/2.0/WSS 192.168.11.92;branch=z9hG4bK133152",
    "From: \" \" <sip:101@1000.call.worktual.com:5060>;tag=4vlq5uhfgr",
    "To: <sip:918310039824@1000.call.worktual.com>",
    "Call-ID: udba1rtiedlud84ioloh",
    "CSeq: 1 INVITE",
    "Content-Type: application/sdp",
    "Content-Length: 10",
    "",
    "v=0",
    "",
  ].join("\r\n");

  const next = withOrgCallIdHeader(raw);
  assert.match(next, /^Org-Call-ID: udba1rtiedlud84ioloh$/m);
  assert.equal((next.match(/^Org-Call-ID:/gim) ?? []).length, 1);
  assert.ok(next.includes("\r\n\r\nv=0"));
});

test("applyLegacySipHeaders leaves REGISTER unchanged", () => {
  const raw = [
    "REGISTER sip:1000.call.worktual.com:5060 SIP/2.0",
    "Via: SIP/2.0/WSS 192.168.13.164;branch=z9hG4bK133152",
    "From: \" \" <sip:101@1000.call.worktual.com:5060>;tag=abc",
    "To: <sip:101@1000.call.worktual.com:5060>",
    "Call-ID: register-call-id",
    "CSeq: 1 REGISTER",
    "Contact: <sip:101@192.168.13.164;transport=wss>",
    "Expires: 600",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");

  assert.equal(applyLegacySipHeaders(raw, "192.168.13.164:64385", "95q3dbbr"), raw);
});

test("applyLegacySipHeaders stamps REGISTER 200 host:port and gold INVITE headers", () => {
  const raw = [
    "INVITE sip:919150911820@1000.call.worktual.com SIP/2.0",
    "Via: SIP/2.0/WSS 192.168.13.164;branch=z9hG4bK9916035",
    "Max-Forwards: 69",
    "From: \" \" <sip:101@1000.call.worktual.com:5060>;tag=9cj2elk3fp",
    "To: <sip:919150911820@1000.call.worktual.com>",
    "Call-ID: o1b6o917drol7nefhjph",
    "CSeq: 9825 INVITE",
    "Contact: <sip:101@192.168.13.164;transport=wss;ob>",
    "Content-Type: application/sdp",
    "Allow: INVITE,ACK,CANCEL,BYE,UPDATE,MESSAGE,OPTIONS,REFER,INFO,NOTIFY,SUBSCRIBE",
    "Supported: ice,replaces,outbound",
    "User-Agent: CCAAS:BROWSER",
    "Content-Length: 80",
    "",
    "v=0",
    "a=candidate:0 1 udp 2130706431 192.168.13.164 11111 typ host",
    "",
  ].join("\r\n");

  const next = applyLegacySipHeaders(raw, "192.168.13.164:64385", "95q3dbbr", "+914440004407");
  assert.match(next, /^Contact: <sip:95q3dbbr@192\.168\.13\.164:64385;transport=wss;ob>$/m);
  assert.match(next, new RegExp(`^Allow: ${LEGACY_INVITE_ALLOW}$`, "m"));
  assert.match(next, new RegExp(`^Supported: ${LEGACY_INVITE_SUPPORTED}$`, "m"));
  assert.match(next, /^Max-Forwards: 70$/m);
  assert.match(next, /^Org-Call-ID: o1b6o917drol7nefhjph$/m);
  assert.match(next, /^X-Outbound-Number: \+914440004407$/m);
  assert.doesNotMatch(next, /192\.168\.13\.164:11111/);
});

test("rewriteSdpLocalAddresses matches gold relay offer shape", () => {
  const sdp = [
    "v=0",
    "o=- 123 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "c=IN IP4 192.168.13.164",
    "a=rtcp:9 IN IP4 192.168.13.164",
    "a=candidate:0 1 udp 2130706431 192.168.13.164 54321 typ host",
    "a=candidate:1 1 udp 1694498815 203.0.113.50 3478 typ srflx raddr 192.168.13.164 rport 54321",
    "a=candidate:288073907 1 udp 58663679 198.51.100.20 50664 typ relay raddr 192.168.13.164 rport 54321 generation 0 network-id 1",
    "a=ice-options:trickle",
    "a=setup:actpass",
    "a=mid:0",
    "a=sendrecv",
    "a=rtcp-mux",
    "",
  ].join("\r\n");

  const next = rewriteSdpLocalAddresses(sdp);
  assert.match(next, /^o=- 123 2 IN IP4 127\.0\.0\.1$/m);
  assert.match(next, /^c=IN IP4 198\.51\.100\.20$/m);
  assert.match(next, /^m=audio 50664 UDP\/TLS\/RTP\/SAVPF 111$/m);
  assert.match(next, /^a=rtcp:9 IN IP4 0\.0\.0\.0$/m);
  assert.match(
    next,
    /^a=candidate:288073907 1 udp 58663679 198\.51\.100\.20 50664 typ relay raddr 0\.0\.0\.0 rport 0 generation 0 network-id 1$/m,
  );
  assert.doesNotMatch(next, /typ host/);
  assert.doesNotMatch(next, /typ srflx/);
  assert.match(next, /^a=setup:actpass$/m);
  assert.match(next, /^a=ice-options:trickle$/m);
  assert.equal((next.match(/^a=candidate:/gm) ?? []).length, 1);
});

test("rewriteSdpLocalAddresses keeps a single UDP relay when Chrome gathered three", () => {
  const sdp = [
    "v=0",
    "o=- 123 2 IN IP4 127.0.0.1",
    "s=-",
    "c=IN IP4 198.51.100.20",
    "m=audio 50664 UDP/TLS/RTP/SAVPF 111",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=candidate:1 1 udp 58663679 198.51.100.20 50664 typ relay raddr 0.0.0.0 rport 0 generation 0 network-id 1",
    "a=candidate:2 1 udp 58663678 198.51.100.21 50665 typ relay raddr 0.0.0.0 rport 0 generation 0 network-id 1",
    "a=candidate:3 1 tcp 58663677 198.51.100.20 443 typ relay raddr 0.0.0.0 rport 0 generation 0 network-id 1",
    "",
  ].join("\r\n");

  const next = rewriteSdpLocalAddresses(sdp);
  assert.equal((next.match(/^a=candidate:/gm) ?? []).length, 1);
  assert.match(next, /^a=candidate:1 1 udp 58663679 198\.51\.100\.20 50664 typ relay raddr 0\.0\.0\.0 rport 0 generation 0 network-id 1$/m);
  assert.match(next, /^m=audio 50664 /m);
  assert.match(next, /^c=IN IP4 198\.51\.100\.20$/m);
});

test("incoming BYE is answered with 200 OK using the same dialog headers", () => {
  const bye = [
    "BYE sip:xupbmuto@192.168.13.164:53067;transport=wss;ob SIP/2.0",
    "Via: SIP/2.0/WSS 82.113.92.86:57344;branch=z9hG4bKjgcUeQeep328K",
    "Max-Forwards: 70",
    "From: <sip:919150911820@1000.call.worktual.com>;tag=jK305cFtmU06p",
    'To: " " <sip:101@1000.call.worktual.com:5060>;tag=dn3pju3b5h',
    "Call-ID: 0uhjbqnmbrf2f3hnvb8j",
    "CSeq: 120270461 BYE",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");

  assert.equal(isIncomingSipBye(bye), true);
  const ok = sipOkForIncomingBye(bye);
  assert.ok(ok);
  assert.match(ok, /^SIP\/2\.0 200 OK/);
  assert.match(ok, /^CSeq: 120270461 BYE$/m);
  assert.match(ok, /^Call-ID: 0uhjbqnmbrf2f3hnvb8j$/m);
  assert.doesNotMatch(ok, /^SIP\/2\.0 404/m);
});

test("incoming INFO call-connected-info is answered with 200 OK", () => {
  const info = [
    "INFO sip:d00tl7kx@192.168.13.164:62133;transport=wss;ob SIP/2.0",
    "Via: SIP/2.0/WSS 82.113.92.86:57344;branch=z9hG4bKD5ZHQKgyBH5QF",
    "Max-Forwards: 70",
    "From: <sip:919150911820@1000.call.worktual.com>;tag=3Fc9Dyy8Dap7K",
    'To: " " <sip:101@1000.call.worktual.com:5060>;tag=u28pemj970',
    "Call-ID: 8h77kokt6t2j8gt4n73j",
    "CSeq: 120274554 INFO",
    "Contact: <sip:101@82.113.92.86:57344;transport=wss>",
    "Content-Type: application/xml",
    "Content-Length: 102",
    "",
    '<?xml version="1.0" encoding="utf-8"?><call-connected-info callstatus="connected" callType="one-one"/>',
    "",
  ].join("\r\n");

  const ok = sipOkForIncomingInfo(info);
  assert.ok(ok);
  assert.match(ok, /^SIP\/2\.0 200 OK/);
  assert.match(ok, /^CSeq: 120274554 INFO$/m);
  assert.match(ok, /^Call-ID: 8h77kokt6t2j8gt4n73j$/m);
  assert.doesNotMatch(ok, /^SIP\/2\.0 404/m);
  assert.doesNotMatch(ok, /call-connected-info/);
});

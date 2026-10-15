import { injectVoiceTransferHeaders } from "./sip-transfer";

export const LEGACY_INVITE_ALLOW =
  "ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER";
export const LEGACY_INVITE_SUPPORTED = "outbound";

export type SipCallDirection = "inbound" | "outbound";

/** Keep the keypad up only for the agent's outbound dial, not an accepted inbound call. */
export function shouldAutoOpenDialPad(input: {
  callState: "idle" | "dialing" | "ringing" | "active";
  direction?: SipCallDirection | null;
}): boolean {
  return (
    input.direction === "outbound" &&
    (input.callState === "dialing" || input.callState === "ringing" || input.callState === "active")
  );
}

export function normalizeDialedNumber(raw: string): string {
  return raw.trim().replace(/[^\d*#]/g, "");
}

/** Digits to dial from a saved contact phone. `+` is ignored. A 10-digit local number gets 91. */
export function contactOutboundNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const international = digits.startsWith("00") ? digits.slice(2) : digits;
  if (!international) return null;
  if (international.length === 11 && international.startsWith("0")) {
    return `91${international.slice(1)}`;
  }
  if (international.length === 10) return `91${international}`;
  return international;
}

/**
 * The part of a saved number after this country code.
 * A national number that only starts with the same digits, such as 9150911820 with +91, is left intact.
 * An explicit +/00 number, or one long enough to still be a full national number after the code, is split.
 */
export function localNumberAfterDialCode(phone: string, dialCode: string): string | null {
  const trimmed = phone.trim();
  const explicit = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = normalizeDialedNumber(trimmed);
  if (digits.startsWith("00")) digits = digits.slice(2);
  const code = normalizeDialedNumber(dialCode);
  if (!code || !digits.startsWith(code) || digits.length <= code.length) return null;
  const local = digits.slice(code.length);
  if (explicit ? local.length >= 7 : local.length >= 10) return local;
  return null;
}

export function composeDialedNumber(dialCode: string, local: string): string {
  const codeDigits = normalizeDialedNumber(dialCode);
  const trimmed = local.trim();
  const localDigits = normalizeDialedNumber(local);
  if (!localDigits) return "";
  if (trimmed.startsWith("+")) return localDigits;
  if (trimmed.startsWith("00")) return localDigits.replace(/^00/, "");
  return `${codeDigits}${localDigits}`;
}

export function sipInviteTarget(number: string, realm: string): string {
  return `sip:${number}@${realm}`;
}

export function randomInviteContactUser(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0").slice(0, 8);
}

function sipMethodLine(raw: string): string {
  return raw.split(/\r\n|\n/, 1)[0] ?? "";
}

function sipSep(raw: string): string {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

export function isIncomingSipBye(raw: string): boolean {
  return /^BYE\s/i.test(sipMethodLine(raw));
}

export function isIncomingSipInfo(raw: string): boolean {
  return /^INFO\s/i.test(sipMethodLine(raw));
}

function sipOkForIncomingDialogRequest(raw: string): string | null {
  const sep = sipSep(raw);
  const copied: string[] = [];
  let hasCallId = false;
  let hasCseq = false;
  for (const line of raw.split(/\r\n|\n/)) {
    const name = line.slice(0, line.indexOf(":")).trim().toLowerCase();
    if (name === "via" || name === "from" || name === "to" || name === "call-id" || name === "cseq") {
      copied.push(line);
      if (name === "call-id") hasCallId = true;
      if (name === "cseq") hasCseq = true;
    }
  }
  if (!hasCallId || !hasCseq) return null;
  return ["SIP/2.0 200 OK", ...copied, "Content-Length: 0", "", ""].join(sep);
}

/** 200 OK that acknowledges an in-dialog BYE (ACK is only used for INVITE). */
export function sipOkForIncomingBye(raw: string): string | null {
  if (!isIncomingSipBye(raw)) return null;
  return sipOkForIncomingDialogRequest(raw);
}

/** 200 OK for in-dialog INFO (call-connected-info). JsSIP would otherwise 404. */
export function sipOkForIncomingInfo(raw: string): string | null {
  if (!isIncomingSipInfo(raw)) return null;
  return sipOkForIncomingDialogRequest(raw);
}

/** User part of the first SIP URI on a header line. */
export function extractSipUser(line: string): string {
  const idx = line.toLowerCase().indexOf("sip:");
  if (idx === -1) return "";
  const rest = line.slice(idx + 4);
  const atIndex = rest.indexOf("@");
  if (atIndex === -1) return "";
  return rest.slice(0, atIndex);
}

/** `ip` or `ip:port` from the old sip.js SIPUtils.isValidIP. */
export function isValidRegisteredHostPort(value: string): boolean {
  if (!value || value === "0.0.0.0" || value.endsWith(":")) return false;
  const [ipPart, portPart] = value.split(":");
  const octets = ipPart?.split(".") ?? [];
  if (octets.length !== 4) return false;
  for (const octet of octets) {
    const num = Number(octet);
    if (!Number.isInteger(num) || num < 0 || num > 255 || octet !== String(num)) {
      return false;
    }
  }
  if (portPart !== undefined) {
    const port = Number(portPart);
    if (!Number.isInteger(port) || port < 0 || port > 65535 || portPart !== String(port)) {
      return false;
    }
  }
  return true;
}

function viaHostAndRport(raw: string): { host: string; rport: string | null } | null {
  const via = raw.match(/^Via:\s*SIP\/2\.0\/\S+\s+(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?/im);
  if (!via?.[1]) return null;
  const rport = raw.match(/^Via:.*(?:;rport=(\d+))/im)?.[1] ?? null;
  return { host: via[1], rport };
}

/**
 * Old sip.js stores REGISTER 200 Contact host[:port], falling back to Via host:rport.
 * That value is the WSS source address the registrar saw — not ICE.
 */
export function registeredHostPortFromRegister200(raw: string): string | null {
  if (!/^SIP\/2\.0\s+200\b/i.test(sipMethodLine(raw))) return null;
  if (!/^CSeq:\s*\d+\s+REGISTER\b/im.test(raw)) return null;

  const contactHost =
    raw.match(/^Contact:\s*<?sip:[^@>\s]+@([^;>\s]+)/im)?.[1]?.replace(/:$/, "") ?? "";
  const via = viaHostAndRport(raw);

  let hostPort = contactHost;
  if (!hostPort || hostPort === "0.0.0.0") {
    if (via?.host && via.rport) hostPort = `${via.host}:${via.rport}`;
    else if (via?.host) hostPort = via.host;
    else return null;
  } else if (!hostPort.includes(":") && via?.rport) {
    hostPort = `${hostPort}:${via.rport}`;
  }

  return isValidRegisteredHostPort(hostPort) ? hostPort : null;
}

function shouldRewriteLegacyHeaders(raw: string): boolean {
  const first = sipMethodLine(raw);
  if (/^REGISTER\s/i.test(first)) return false;
  if (/^INVITE\s/i.test(first)) return true;
  if (/^REFER\s/i.test(first)) return true;
  if (/^SIP\/2\.0\s+200\b/i.test(first) && /^CSeq:.*\bINVITE\b/im.test(raw)) return true;
  if (/application\/xml/i.test(raw)) return true;
  return false;
}

function rewriteContactLine(line: string, hostPort: string, contactUser?: string | null): string {
  const match = line.match(/^(Contact:\s*<sip:)([^@>]+)@([^;>]+)((?:;[^;>]*)*>.*)$/i);
  if (match) {
    const user = contactUser || match[2];
    return `${match[1]}${user}@${hostPort}${match[4]}`;
  }

  const atIndex = line.indexOf("@");
  if (atIndex === -1) return line;
  const afterAt = line.slice(atIndex + 1);
  const semicolonIndex = afterAt.indexOf(";");
  const bracketIndex = afterAt.indexOf(">");
  const endIndex = semicolonIndex !== -1 ? semicolonIndex : bracketIndex;
  if (endIndex === -1) return line;
  const oldHost = afterAt.slice(0, endIndex);
  return line.replace(oldHost, hostPort);
}

/**
 * Old sip.js ReplaceSDP: stamp REGISTER 200 host:port onto Contact, add Org-Call-ID,
 * and use the gold Allow / Supported lists on INVITE.
 */
export function applyLegacySipHeaders(
  raw: string,
  registeredHostPort?: string | null,
  inviteContactUser?: string | null,
  outboundNumber?: string | null,
  transferHeaders?: string[] | null,
): string {
  if (!shouldRewriteLegacyHeaders(raw)) return raw;

  const sep = sipSep(raw);
  const lines = raw.split(sep);
  const isInvite = /^INVITE\s/i.test(sipMethodLine(raw));
  const canReplaceContact =
    typeof registeredHostPort === "string" && isValidRegisteredHostPort(registeredHostPort);
  const alreadyHasOrgCallId = /^Org-Call-ID:/im.test(raw);
  const outboundHeader = outboundNumber?.trim()
    ? `X-Outbound-Number: ${outboundNumber.trim()}`
    : null;

  let callId = "";
  const result: string[] = [];

  for (const line of lines) {
    if (/^Call-ID:/i.test(line)) {
      callId = line.slice(line.indexOf(":") + 1).trim();
      result.push(line);
      continue;
    }

    if (isInvite && /^Allow:/i.test(line)) {
      result.push(`Allow: ${LEGACY_INVITE_ALLOW}`);
      continue;
    }
    if (isInvite && /^Supported:/i.test(line)) {
      result.push(`Supported: ${LEGACY_INVITE_SUPPORTED}`);
      continue;
    }
    if (isInvite && /^Max-Forwards:/i.test(line)) {
      result.push("Max-Forwards: 70");
      continue;
    }
    if (isInvite && /^X-Outbound-Number:/i.test(line)) {
      continue;
    }

    if (line.includes("Contact: <sip:") && canReplaceContact) {
      result.push(rewriteContactLine(line, registeredHostPort, isInvite ? inviteContactUser : null));
      continue;
    }

    if (/^Content-Length/i.test(line)) {
      if (isInvite && outboundHeader) {
        result.push(outboundHeader);
      }
      result.push(line);
      if (callId && !alreadyHasOrgCallId) {
        result.push(`Org-Call-ID: ${callId}`);
      }
      continue;
    }

    result.push(line);
  }

  return injectVoiceTransferHeaders(rewriteSipMessageSdp(result.join(sep)), transferHeaders);
}

function isRfc1918OrLoopback(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number];
  if (a === 0 || a === 127 || a === 255) return true;
  if (a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

type IceEndpoint = {
  ip: string;
  port: string;
  type: "relay" | "srflx";
  protocol: string;
  component: string;
  line: string;
};

function parseIceCandidate(line: string): IceEndpoint | null {
  const match = line.match(
    /^(?:a=)?candidate:\S+\s+(\d+)\s+(\S+)\s+\d+\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)\s+typ\s+(relay|srflx)\b/i,
  );
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) return null;
  if (isRfc1918OrLoopback(match[3])) return null;
  return {
    component: match[1],
    protocol: match[2].toLowerCase(),
    ip: match[3],
    port: match[4],
    type: match[5].toLowerCase() as IceEndpoint["type"],
    line,
  };
}

function iceEndpointsFromSdp(sdp: string): IceEndpoint[] {
  const found: IceEndpoint[] = [];
  for (const line of sdp.split(/\r\n|\n/)) {
    const parsed = parseIceCandidate(line);
    if (parsed) found.push(parsed);
  }
  return found;
}

function pickSingleRelay(endpoints: IceEndpoint[]): IceEndpoint | null {
  const relays = endpoints.filter((item) => item.type === "relay");
  return (
    relays.find((item) => item.component === "1" && item.protocol === "udp") ??
    relays.find((item) => item.component === "1") ??
    relays[0] ??
    null
  );
}

/** Prefer TURN relay, then STUN srflx — never a LAN host address. */
export function preferredPublicIceIp(sdp: string): string | null {
  const found = iceEndpointsFromSdp(sdp);
  return pickSingleRelay(found)?.ip ?? found[0]?.ip ?? null;
}

function normalizeRelayCandidate(line: string): string {
  const withRaddr = line.replace(/\braddr\s+\S+\s+rport\s+\d+/i, "raddr 0.0.0.0 rport 0");
  if (withRaddr !== line) return withRaddr;
  if (/\braddr\b/i.test(line)) return line;
  return `${line} raddr 0.0.0.0 rport 0`;
}

/**
 * Gold offer shape (values are not copied):
 * o= IN IP4 127.0.0.1
 * c= IN IP4 <relay>
 * m=audio <relay-port>
 * a=rtcp:9 IN IP4 0.0.0.0
 * a=candidate:… typ relay raddr 0.0.0.0 rport 0   (exactly one)
 */
export function rewriteSdpLocalAddresses(sdp: string): string {
  const endpoints = iceEndpointsFromSdp(sdp);
  const relay = pickSingleRelay(endpoints);
  const publicIp = relay?.ip ?? endpoints[0]?.ip ?? null;
  if (!publicIp || !relay) return sdp;

  const sep = sdp.includes("\r\n") ? "\r\n" : "\n";
  const candidateLine = normalizeRelayCandidate(relay.line.startsWith("a=") ? relay.line : `a=${relay.line}`);
  const out: string[] = [];
  let candidateEmitted = false;

  for (const line of sdp.split(sep)) {
    if (/^a=candidate:/i.test(line)) {
      if (!candidateEmitted) {
        out.push(candidateLine);
        candidateEmitted = true;
      }
      continue;
    }

    const media = line.match(/^(m=audio )(\d+)( .*)$/);
    if (media && media[2] !== "0") {
      out.push(`${media[1]}${relay.port}${media[3]}`);
      continue;
    }

    const conn = line.match(/^(c=IN IP4 )(\d{1,3}(?:\.\d{1,3}){3})(.*)$/);
    if (conn && conn[2] !== publicIp) {
      out.push(`${conn[1]}${publicIp}${conn[3]}`);
      continue;
    }

    if (/^a=rtcp:\d+ IN IP4 /i.test(line)) {
      out.push("a=rtcp:9 IN IP4 0.0.0.0");
      continue;
    }

    out.push(line);
  }

  return out.join(sep);
}

/** Chrome rejects an answer that copies a=setup:actpass from the offer. */
export function normalizeRemoteAnswerSdp(sdp: string): string {
  return sdp.replace(/^a=setup:actpass[ \t]*$/gim, "a=setup:passive");
}

function rewriteSipMessageSdp(raw: string): string {
  if (!/Content-Type:\s*application\/sdp/i.test(raw)) return raw;
  const sep = sipSep(raw);
  const headerEnd = raw.indexOf(sep + sep);
  if (headerEnd < 0) return raw;
  const headers = raw.slice(0, headerEnd);
  const body = raw.slice(headerEnd + sep.length * 2);
  const nextBody = rewriteSdpLocalAddresses(body);
  if (nextBody === body) return raw;
  const length = new TextEncoder().encode(nextBody).length;
  const nextHeaders = headers.replace(/^Content-Length:\s*\d+/im, `Content-Length: ${length}`);
  return `${nextHeaders}${sep}${sep}${nextBody}`;
}

export function withOrgCallIdHeader(raw: string): string {
  return applyLegacySipHeaders(raw);
}

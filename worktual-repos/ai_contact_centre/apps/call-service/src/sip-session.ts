const DEFAULT_WSS_URL = "wss://nlp-audiosgw.worktual.co.uk:57344";
const DEFAULT_TURN_V4 = "turn:audioturnv4.worktual.co.uk:443";
const DEFAULT_TURN_USERNAME = "admin";
const DEFAULT_TURN_CREDENTIAL = "system123";

export type OutboundCallerOption = {
  id: string;
  kind: "agent" | "queue";
  phoneNumber: string;
  label: string;
};

export type CoreSipSession = {
  ext: string;
  organizationId: string;
  sipLoginId: string;
  sipPassword: string;
  callerName: string;
  redisKey: string;
  redisRegistered: boolean;
  sipUri: string;
  registrarUri: string;
  realm: string;
  outboundCallerId?: string | null;
  outboundOptions?: OutboundCallerOption[];
};

/** Paths the browser hits for SIP session + restore. */
export function sipSessionHttpPaths(
  publicBase = process.env.CALL_SERVICE_API_V1_PUBLIC_BASE,
): string[] {
  const paths = new Set(["/api/v1/sip/session", "/v1/sip/session"]);
  const base = publicBase?.trim().replace(/\/$/, "");
  if (base) {
    const normalized = base.startsWith("/") ? base : `/${base}`;
    paths.add(`${normalized}/sip/session`);
  }
  return [...paths];
}

export type IceServer = {
  urls: string;
  username?: string;
  credential?: string;
};

export const SIP_REGISTER_DISPLAY_NAME = " ";
export const SIP_USER_AGENT = "CCAAS:BROWSER";
export const SIP_REGISTER_EXPIRES = 600;

export type SipUaSession = {
  wssUrl: string;
  uri: string;
  registrarServer: string;
  authorizationUser: string;
  password: string;
  displayName: string;
  userAgent: string;
  realm: string;
  expires: number;
  ext: string;
  redisKey: string;
  redisRegistered: boolean;
  iceServers: IceServer[];
  outboundCallerId: string | null;
  outboundOptions: OutboundCallerOption[];
};

export function sipWssUrl(): string {
  return process.env.SIP_WSS_URL?.trim() || DEFAULT_WSS_URL;
}

function asStunUrl(url: string): string {
  return url.replace(/\?.*$/, "").replace(/^turns:/i, "stuns:").replace(/^turn:/i, "stun:");
}

export function iceServersFromEnv(): IceServer[] {
  const v4 = process.env.CALL_SERVER_TURN_URL?.trim() || DEFAULT_TURN_V4;
  const username = process.env.CALL_SERVER_TURN_USERNAME?.trim() || DEFAULT_TURN_USERNAME;
  const credential = process.env.CALL_SERVER_TURN_CREDENTIAL?.trim() || DEFAULT_TURN_CREDENTIAL;
  const stunV4 = asStunUrl(v4).replace(/\?.*$/, "");
  const servers: IceServer[] = [{ urls: stunV4 }];
  if (username && credential) {
    servers.push({ urls: v4, username, credential });
  }
  return servers;
}

export function buildSipUaSession(core: CoreSipSession): SipUaSession {
  return {
    wssUrl: sipWssUrl(),
    uri: core.sipUri,
    registrarServer: core.registrarUri,
    authorizationUser: core.ext,
    password: core.sipPassword,
    displayName: SIP_REGISTER_DISPLAY_NAME,
    userAgent: SIP_USER_AGENT,
    realm: core.realm,
    expires: SIP_REGISTER_EXPIRES,
    ext: core.ext,
    redisKey: core.redisKey,
    redisRegistered: core.redisRegistered,
    iceServers: iceServersFromEnv(),
    outboundCallerId: core.outboundCallerId ?? null,
    outboundOptions: Array.isArray(core.outboundOptions) ? core.outboundOptions : [],
  };
}

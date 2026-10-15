export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type IceUrl = IceServerConfig;

function urlList(urls: string | string[]): string[] {
  return (Array.isArray(urls) ? urls : [urls]).map((url) => url.trim()).filter(Boolean);
}

function isTurnUrl(url: string): boolean {
  return /^turns?:/i.test(url);
}

function stripIceQuery(url: string): string {
  return url.replace(/\?.*$/, "");
}

/** STUN URLs cannot carry `?transport=`. TURN keeps the query. */
function asStunUrl(url: string): string {
  return stripIceQuery(url).replace(/^turns:/i, "stuns:").replace(/^turn:/i, "stun:");
}

function isStunUrl(url: string): boolean {
  return /^stuns?:/i.test(url) && !url.includes("?");
}

/** Chrome throws if `turn:`/`turns:` iceServers lack username and credential. */
export function peerConnectionIceServers(iceServers: IceServerConfig[] = []): RTCIceServer[] {
  const out: RTCIceServer[] = [];
  const stunUrls: string[] = [];

  for (const server of iceServers) {
    const urls = urlList(server.urls);
    const turnUrls = urls.filter(isTurnUrl);
    const otherUrls = urls.filter((url) => !isTurnUrl(url)).map(stripIceQuery).filter(isStunUrl);
    const username = server.username?.trim() ?? "";
    const credential = server.credential?.trim() ?? "";
    if (turnUrls.length > 0 && username && credential) {
      out.push({ urls: turnUrls, username, credential });
    } else if (turnUrls.length > 0 && (!username || !credential)) {
      stunUrls.push(...turnUrls.map(asStunUrl).filter(isStunUrl));
    }
    stunUrls.push(...otherUrls);
  }

  const uniqueStun = [...new Set(stunUrls)];
  if (uniqueStun.length > 0) out.push({ urls: uniqueStun });
  return out;
}

function isUsableIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number];
  if (a === 0 || a === 127 || a === 255) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function isPrivateIpv4(ip: string): boolean {
  if (!isUsableIpv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number) as [number, number];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

type GatheredIp = { ip: string; type: string; port: number | null };

function ipv4FromText(text: string): string[] {
  return (text.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g) ?? []).filter(isUsableIpv4);
}

export function hostFromIceLine(line: string): string | null {
  const ipv4 = ipv4FromText(line);
  return ipv4.find(isPrivateIpv4) ?? ipv4[0] ?? null;
}

function portFromIceLine(line: string): number | null {
  const match = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)\s+typ\b/i);
  const port = match ? Number(match[2]) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

function ipFromCandidate(candidate: RTCIceCandidate | null): GatheredIp | null {
  if (!candidate) return null;
  const rawAddress =
    ("address" in candidate && typeof candidate.address === "string" && candidate.address) ||
    ("ip" in candidate && typeof (candidate as { ip?: string }).ip === "string" &&
      (candidate as { ip: string }).ip) ||
    "";
  const fromAddress = isUsableIpv4(rawAddress) ? rawAddress : hostFromIceLine(rawAddress);
  const fromLine = hostFromIceLine(candidate.candidate ?? "");
  const ip = fromAddress || fromLine;
  if (!ip) return null;
  const port =
    (typeof candidate.port === "number" && candidate.port > 0 && candidate.port < 65536
      ? candidate.port
      : null) ?? portFromIceLine(candidate.candidate ?? "");
  return { ip, type: candidate.type || "unknown", port };
}

function pickBestIpv4(found: GatheredIp[]): GatheredIp | null {
  const hostPrivate = found.find((item) => item.type === "host" && isPrivateIpv4(item.ip));
  if (hostPrivate) return hostPrivate;
  const anyPrivate = found.find((item) => isPrivateIpv4(item.ip));
  if (anyPrivate) return anyPrivate;
  const host = found.find((item) => item.type === "host");
  if (host) return host;
  const srflx = found.find((item) => item.type === "srflx");
  if (srflx) return srflx;
  return found[0] ?? null;
}

export function stunServersFromIce(iceServers: IceUrl[] = []): RTCIceServer[] {
  const urls = iceServers
    .flatMap((server) => urlList(server.urls))
    .map(asStunUrl)
    .filter(isStunUrl);
  urls.push("stun:stun.l.google.com:19302");
  return [{ urls: [...new Set(urls)] }];
}

async function gatherIpv4(iceServers: RTCIceServer[]): Promise<GatheredIp[]> {
  if (typeof RTCPeerConnection === "undefined") return [];

  let pc: RTCPeerConnection;
  try {
    pc = new RTCPeerConnection({ iceServers });
  } catch {
    pc = new RTCPeerConnection({ iceServers: [] });
  }
  const found: GatheredIp[] = [];

  const gathering = new Promise<void>((resolve) => {
    const finish = () => {
      pc.onicecandidate = null;
      pc.onicegatheringstatechange = null;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 4000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.onicecandidate = (event) => {
      const parsed = ipFromCandidate(event.candidate);
      if (parsed) found.push(parsed);
      if (!event.candidate) finish();
    };
  });

  try {
    pc.createDataChannel("sip-via");
    await pc.setLocalDescription(await pc.createOffer());
    await gathering;
  } finally {
    try {
      pc.close();
    } catch {
      // ignore
    }
  }

  return found;
}

async function publicIpv4Fallback(): Promise<string | null> {
  try {
    const response = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const body = (await response.json()) as { ip?: string };
    return body.ip && isUsableIpv4(body.ip) ? body.ip : null;
  } catch {
    return null;
  }
}

export function sipContactUri(ext: string, host: string): string {
  return `sip:${ext}@${host};transport=wss`;
}

export function sipContactHeader(ext: string, host: string, expires: number): string {
  return `<${sipContactUri(ext, host)}>;expires=${expires}`;
}

export async function discoverViaHost(iceServers: IceUrl[] = []): Promise<string> {
  const rtcIce = peerConnectionIceServers(iceServers);
  let found = await gatherIpv4(rtcIce.length > 0 ? rtcIce : stunServersFromIce(iceServers));
  let best = pickBestIpv4(found);

  if (!best && typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((track) => track.stop());
      const retryIce = rtcIce.length > 0 ? rtcIce : stunServersFromIce(iceServers);
      found = await gatherIpv4(retryIce);
      best = pickBestIpv4(found);
    } catch {
      // mic denied — keep STUN / public fallback
    }
  }

  if (!best) {
    const ip = await publicIpv4Fallback();
    if (ip) best = { ip, type: "srflx", port: null };
  }

  if (!best) {
    throw new Error("Could not discover an IPv4 address for SIP Via/Contact");
  }

  return best.ip;
}

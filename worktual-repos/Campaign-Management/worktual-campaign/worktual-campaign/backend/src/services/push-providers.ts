/**
 * Permanent push providers: FCM HTTP v1 (service account), legacy FCM fallback,
 * APNs (HTTP/2 + JWT), web (VAPID).
 * Stub destinations (stub://…) are handled by the worker, not here.
 */
import { createPrivateKey, createSign, randomBytes } from "node:crypto";
import { connect as http2Connect, type ClientHttp2Session } from "node:http2";
import {
  getPushSettingsRawDao,
  type PushConfigChannel,
} from "../dao/push-config.js";
import { toConfigChannel } from "../helpers/channel-ids.js";
import { looksLikeFcmToken } from "../helpers/push-token.js";
import {
  AccountsChannelError,
  loadPushSendSettings,
  webPushSendReady,
} from "./accounts-campaign-channels.js";
import {
  fcmDataPayload,
  trackingData,
  type PushCampaignTrack,
} from "../helpers/push-fcm-payload.js";

export type { PushCampaignTrack } from "../helpers/push-fcm-payload.js";
export { fcmDataPayload } from "../helpers/push-fcm-payload.js";

export type PushSendPayload = {
  title: string;
  body: string;
  cta?: string;
  /** Campaign send only — omit for Configuration → Run test. */
  track?: PushCampaignTrack;
};

export type PushSendResult = {
  provider: "fcm" | "apns" | "web_push";
  messageId: string;
};

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePem(raw: string): string {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN PRIVATE KEY")) return trimmed;
  // Allow pasted key body without PEM headers.
  const body = trimmed.replace(/\s+/g, "");
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join("\n") || body}\n-----END PRIVATE KEY-----`;
}

/** Cache short-lived Google OAuth tokens per client_email. */
const fcmTokenCache = new Map<
  string,
  { accessToken: string; expiresAtMs: number }
>();

async function getFcmAccessToken(
  clientEmail: string,
  privateKeyPem: string,
): Promise<string> {
  const cached = fcmTokenCache.get(clientEmail);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const key = createPrivateKey(normalizePem(privateKeyPem));
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = b64url(sign.sign(key));
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const text = await res.text();
  let json: { access_token?: string; expires_in?: number; error?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok || !json.access_token) {
    throw new Error(
      `FCM OAuth failed (${res.status}): ${json.error || text.slice(0, 200)}`,
    );
  }
  const expiresIn = Number(json.expires_in) || 3600;
  fcmTokenCache.set(clientEmail, {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + expiresIn * 1000,
  });
  return json.access_token;
}

async function sendFcmHttpV1(args: {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  token: string;
  title: string;
  body: string;
  cta?: string;
  track?: PushCampaignTrack;
}): Promise<string> {
  const accessToken = await getFcmAccessToken(
    args.clientEmail,
    args.privateKey,
  );
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(args.projectId)}/messages:send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: args.token,
        notification: {
          title: args.title,
          body: args.body,
        },
        data: fcmDataPayload({ cta: args.cta, track: args.track }),
        android: { priority: "HIGH" },
      },
    }),
  });
  const text = await res.text();
  let json: { name?: string; error?: { message?: string } } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(
      `FCM v1 HTTP ${res.status}: ${json.error?.message || text.slice(0, 300)}`,
    );
  }
  // name like projects/.../messages/0:1234
  const name = json.name || "";
  const mid = name.includes("/") ? name.split("/").pop() || name : name;
  return mid || `fcm-v1-${Date.now()}`;
}

async function sendFcmLegacy(args: {
  serverKey: string;
  token: string;
  title: string;
  body: string;
  cta?: string;
  track?: PushCampaignTrack;
}): Promise<string> {
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      Authorization: `key=${args.serverKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: args.token,
      priority: "high",
      notification: {
        title: args.title,
        body: args.body,
      },
      data: fcmDataPayload({ cta: args.cta, track: args.track }),
    }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(
      `FCM legacy HTTP ${res.status}: ${String(json.error || text).slice(0, 300)}`,
    );
  }
  if (json.failure === 1 || json.success === 0) {
    const results = Array.isArray(json.results) ? json.results : [];
    const err =
      results[0] && typeof results[0] === "object"
        ? String((results[0] as { error?: string }).error || "unknown")
        : "unknown";
    throw new Error(`FCM rejected token: ${err}`);
  }
  const results = Array.isArray(json.results) ? json.results : [];
  const mid =
    results[0] && typeof results[0] === "object"
      ? String((results[0] as { message_id?: string }).message_id || "")
      : "";
  return mid || `fcm-${Date.now()}`;
}

function buildApnsJwt(opts: {
  keyId: string;
  teamId: string;
  keyP8: string;
}): string {
  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: opts.keyId }),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ iss: opts.teamId, iat: now }),
  );
  const data = `${header}.${payload}`;
  const key = createPrivateKey(normalizePem(opts.keyP8));
  const sign = createSign("SHA256");
  sign.update(data);
  sign.end();
  const sig = sign.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${data}.${b64url(sig)}`;
}

async function sendApnsHttp2(args: {
  keyId: string;
  teamId: string;
  bundleId: string;
  keyP8: string;
  deviceToken: string;
  title: string;
  body: string;
  cta?: string;
  track?: PushCampaignTrack;
  production?: boolean;
}): Promise<string> {
  const host = args.production
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";
  const token = args.deviceToken.replace(/\s+/g, "");
  const jwt = buildApnsJwt({
    keyId: args.keyId,
    teamId: args.teamId,
    keyP8: args.keyP8,
  });
  const path = `/3/device/${token}`;
  const payload = JSON.stringify({
    aps: {
      alert: {
        title: args.title,
        body: args.body,
      },
      sound: "default",
    },
    ...(args.cta ? { cta_label: args.cta } : {}),
    ...trackingData(args.track),
  });

  return new Promise<string>((resolve, reject) => {
    let session: ClientHttp2Session | null = null;
    const timer = setTimeout(() => {
      session?.close();
      reject(new Error("APNs request timed out"));
    }, 20_000);

    try {
      session = http2Connect(`https://${host}`);
      session.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      const req = session.request({
        ":method": "POST",
        ":path": path,
        authorization: `bearer ${jwt}`,
        "apns-topic": args.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });

      const chunks: Buffer[] = [];
      req.setEncoding("utf8");
      let status = 0;
      req.on("response", (headers) => {
        status = Number(headers[":status"] || 0);
      });
      req.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      req.on("end", () => {
        clearTimeout(timer);
        session?.close();
        const body = Buffer.concat(chunks).toString("utf8");
        if (status >= 200 && status < 300) {
          resolve(`apns-${Date.now()}-${randomBytes(4).toString("hex")}`);
          return;
        }
        reject(
          new Error(
            `APNs HTTP ${status}: ${(body || "no body").slice(0, 300)}`,
          ),
        );
      });
      req.on("error", (err) => {
        clearTimeout(timer);
        session?.close();
        reject(err);
      });
      req.end(payload);
    } catch (err) {
      clearTimeout(timer);
      session?.close();
      reject(err);
    }
  });
}

/** Minimal Web Push (aes128gcm) via `web-push` package. */
async function sendWebPushVapid(args: {
  endpoint: string;
  authKeys: Record<string, unknown> | null;
  vapidPublic: string;
  vapidPrivate: string;
  vapidSubject: string;
  title: string;
  body: string;
  cta?: string;
  icon?: string;
  track?: PushCampaignTrack;
}): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let webpush: any;
  try {
    const mod = await import("web-push");
    webpush = (mod as { default?: unknown }).default || mod;
  } catch {
    throw new Error(
      "web-push package not installed — run npm install web-push in backend",
    );
  }

  const keys = args.authKeys || {};
  const p256dh = String(keys.p256dh || keys.p256DH || "");
  const auth = String(keys.auth || "");
  if (!p256dh || !auth) {
    throw new Error("Web push subscription keys (p256dh, auth) required");
  }

  webpush.setVapidDetails(
    args.vapidSubject || "mailto:ops@worktual.local",
    args.vapidPublic,
    args.vapidPrivate,
  );

  const payload = JSON.stringify({
    title: args.title,
    body: args.body,
    cta_label: args.cta || "",
    icon: args.icon || "",
    ...trackingData(args.track),
  });

  const res = await webpush.sendNotification(
    {
      endpoint: args.endpoint,
      keys: { p256dh, auth },
    },
    payload,
  );
  return `web-${res?.statusCode || 201}-${Date.now()}`;
}

function pickAppPlatform(
  platform: string | null | undefined,
  provider: string,
  destination?: string,
): "fcm" | "apns" {
  const p = (platform || "").toLowerCase();
  if (p.includes("ios") || p.includes("apns") || p === "iphone") {
    return "apns";
  }
  if (p.includes("android") || p.includes("fcm")) {
    return "fcm";
  }
  if (destination && looksLikeFcmToken(destination)) {
    return "fcm";
  }
  // Default by configured provider.
  if (provider === "apns") return "apns";
  return "fcm";
}

/**
 * Send one push using My Accounts credentials (in memory) or legacy
 * Configuration → App/Web push settings.
 */
export async function sendPushViaProvider(args: {
  organizationId: string;
  agentChannel: "push" | "web";
  destination: string;
  platform?: string | null;
  authKeys?: Record<string, unknown> | null;
  payload: PushSendPayload;
}): Promise<PushSendResult> {
  const configChannel = toConfigChannel(
    args.agentChannel,
  ) as PushConfigChannel;

  let settings: Record<string, string>;
  let status: "not_started" | "in_progress" | "ready" | "blocked";
  try {
    const loaded = await loadPushSendSettings({
      organizationId: args.organizationId,
      channel: configChannel,
      loadLocal: () =>
        getPushSettingsRawDao(args.organizationId, configChannel),
    });
    settings = loaded.settings;
    status = loaded.status;
  } catch (err) {
    if (err instanceof AccountsChannelError) {
      throw new Error(err.message);
    }
    throw err;
  }

  if (args.agentChannel === "web") {
    if (!webPushSendReady(settings)) {
      throw new Error(
        "Web push VAPID keys are missing from My Accounts (need public + private). Open My Accounts → Setup → Channel Setup → Web Push, activate the channel, and regenerate VAPID. Campaign sends with those keys — same path as a live campaign.",
      );
    }
    const messageId = await sendWebPushVapid({
      endpoint: args.destination,
      authKeys: args.authKeys || null,
      vapidPublic: settings.vapid_public_key || "",
      vapidPrivate: settings.vapid_private_key || "",
      vapidSubject: settings.vapid_subject || "",
      title: args.payload.title,
      body: args.payload.body,
      cta: args.payload.cta,
      icon: settings.default_icon_url,
      track: args.payload.track,
    });
    return { provider: "web_push", messageId };
  }

  if (status !== "ready") {
    throw new Error(
      "App push credentials are missing from My Accounts (FCM and/or APNs). Open My Accounts → Setup → Channel Setup → App Push, activate the channel, and upload Firebase/APNs keys. Campaign sends with those credentials — same path as a live campaign.",
    );
  }

  const provider = (settings.provider || "fcm").toLowerCase();
  const route = pickAppPlatform(args.platform, provider, args.destination);

  if (route === "fcm") {
    if (provider === "apns") {
      throw new Error("FCM not enabled — provider is APNs-only");
    }
    const projectId = settings.fcm_project_id || "";
    const clientEmail = settings.fcm_client_email || "";
    const privateKey = settings.fcm_private_key || "";
    if (projectId && clientEmail && privateKey) {
      const messageId = await sendFcmHttpV1({
        projectId,
        clientEmail,
        privateKey,
        token: args.destination,
        title: args.payload.title,
        body: args.payload.body,
        cta: args.payload.cta,
        track: args.payload.track,
      });
      return { provider: "fcm", messageId };
    }
    if (!settings.fcm_server_key) {
      throw new Error(
        "FCM is not configured. Complete App Push in My Accounts → Setup → Channel Setup (Firebase service account), or use legacy Configuration while Accounts is not set up.",
      );
    }
    const messageId = await sendFcmLegacy({
      serverKey: settings.fcm_server_key,
      token: args.destination,
      title: args.payload.title,
      body: args.payload.body,
      cta: args.payload.cta,
      track: args.payload.track,
    });
    return { provider: "fcm", messageId };
  }

  if (provider === "fcm") {
    throw new Error("APNs not enabled — provider is FCM-only");
  }
  if (
    !settings.apns_key_id ||
    !settings.apns_team_id ||
    !settings.apns_bundle_id ||
    !settings.apns_key_p8
  ) {
    throw new Error("APNs credentials incomplete. Complete App Push in My Accounts → Setup → Channel Setup.");
  }

  const production =
    String(settings.apns_environment || "").toLowerCase() === "production" ||
    String(process.env.APNS_PRODUCTION || "").toLowerCase() === "true";
  const messageId = await sendApnsHttp2({
    keyId: settings.apns_key_id,
    teamId: settings.apns_team_id,
    bundleId: settings.apns_bundle_id,
    keyP8: settings.apns_key_p8,
    deviceToken: args.destination,
    title: args.payload.title,
    body: args.payload.body,
    cta: args.payload.cta,
    track: args.payload.track,
    production,
  });
  return { provider: "apns", messageId };
}

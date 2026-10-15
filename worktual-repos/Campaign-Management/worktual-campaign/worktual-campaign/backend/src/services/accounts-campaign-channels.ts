/**
 * My Accounts campaign-channels client (App Push + Web Push).
 *
 * Thin HTTP adapter: list + credentials + compliance evaluate.
 * Mapping matches agents/app/integrations/accounts_campaign_channels.py.
 * Never persist FCM/APNs/VAPID secrets — keep in memory for send only.
 */
import { env } from "../config/env.js";

export type PushConfigChannel = "web_push" | "app_push";

export const ACCOUNTS_NOT_CONFIGURED = "not_configured";
export const ACCOUNTS_CHANNEL_INACTIVE = "channel_inactive";
export const ACCOUNTS_NEEDS_REAUTH = "needs_reauth";

const LIST_TTL_MS = 30_000;
const CREDS_TTL_MS = 45_000;

export class AccountsChannelError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 400, code = "") {
    super(message);
    this.name = "AccountsChannelError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

type CacheEntry<T> = { expiresAt: number; value: T };

const listCache = new Map<string, CacheEntry<Record<string, unknown> | null>>();
const credsCache = new Map<string, CacheEntry<Record<string, string>>>();

export function isAccountsCampaignChannelsConfigured(): boolean {
  return Boolean(env.accounts.apiBaseUrl);
}

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function userMessageForAccountsError(
  code: string,
  kind: PushConfigChannel,
): string {
  const label = kind === "app_push" ? "App Push" : "Web Push";
  if (code === ACCOUNTS_NOT_CONFIGURED) {
    return `${label} is not set up yet. Complete it in My Accounts → Setup → Channel Setup.`;
  }
  if (code === ACCOUNTS_CHANNEL_INACTIVE) {
    return `${label} is inactive. Activate it in My Accounts → Setup → Channel Setup.`;
  }
  if (code === ACCOUNTS_NEEDS_REAUTH) {
    return `${label} keys could not be decrypted. Re-upload credentials in My Accounts → Setup → Channel Setup.`;
  }
  return `${label} credentials are not available from My Accounts.`;
}

export function campaignStatusFromAccountsChannel(
  channel: Record<string, unknown> | null | undefined,
  kind: PushConfigChannel,
): "not_started" | "in_progress" | "ready" | "blocked" {
  if (!channel) return "not_started";
  const st = String(channel.status || "").trim().toLowerCase();
  if (st === "inactive") return "blocked";
  if (st === "pending") return "in_progress";
  if (st !== "active") return "not_started";

  if (kind === "web_push") {
    const vapid = Boolean(channel.vapidConfigured || channel.vapidPublicKey);
    return vapid ? "ready" : "in_progress";
  }

  const platform = String(channel.platform || "both").trim().toLowerCase();
  const fcm = Boolean(channel.fcmConfigured);
  const apns = Boolean(channel.apnsConfigured);
  if (platform === "android") return fcm ? "ready" : "in_progress";
  if (platform === "ios") return apns ? "ready" : "in_progress";
  if (fcm && apns) return "ready";
  return "in_progress";
}

export function mapAppPushCredentials(
  credentials: Record<string, unknown>,
): Record<string, string> {
  const sa =
    credentials.fcmServiceAccount &&
    typeof credentials.fcmServiceAccount === "object"
      ? (credentials.fcmServiceAccount as Record<string, unknown>)
      : {};
  const platform = String(credentials.platform || "both").trim().toLowerCase();
  const provider =
    platform === "android" ? "fcm" : platform === "ios" ? "apns" : "both";
  const privateKey = String(sa.private_key || "")
    .replace(/\\n/g, "\n")
    .trim();
  return {
    app_display_name: String(credentials.name || "").trim(),
    provider,
    fcm_project_id: String(sa.project_id || credentials.fcmProjectId || "").trim(),
    fcm_client_email: String(sa.client_email || "").trim(),
    fcm_private_key: privateKey,
    fcm_server_key: "",
    apns_key_id: String(credentials.apnsKeyId || "").trim(),
    apns_team_id: String(credentials.apnsTeamId || "").trim(),
    apns_bundle_id: String(
      credentials.apnsBundleId || credentials.iosBundleId || "",
    ).trim(),
    apns_key_p8: String(credentials.apnsKey || "").trim(),
    apns_environment: String(credentials.apnsEnvironment || "production")
      .trim()
      .toLowerCase(),
    default_icon_url: String(credentials.defaultIconUrl || "").trim(),
    default_click_url: String(credentials.defaultClickUrl || "").trim(),
  };
}

export function mapWebPushCredentials(
  credentials: Record<string, unknown>,
): Record<string, string> {
  return {
    vapid_subject: String(
      credentials.vapidSubject || credentials.vapid_subject || "",
    ).trim(),
    vapid_public_key: String(
      credentials.vapidPublicKey || credentials.vapid_public_key || "",
    ).trim(),
    vapid_private_key: String(
      credentials.vapidPrivateKey || credentials.vapid_private_key || "",
    ).trim(),
    default_icon_url: String(
      credentials.defaultIconUrl || credentials.default_icon_url || "",
    ).trim(),
    default_click_url: String(
      credentials.defaultClickUrl || credentials.default_click_url || "",
    ).trim(),
    app_display_name: String(credentials.name || "").trim(),
  };
}

/** Send needs VAPID public+private. Site origin is subscribe-only. */
export function webPushSendReady(s: Record<string, string>): boolean {
  return Boolean(
    String(s.vapid_public_key || "").trim() &&
      String(s.vapid_private_key || "").trim(),
  );
}

function mergeNonEmptySettings(
  primary: Record<string, string>,
  fallback: Record<string, string>,
): Record<string, string> {
  const out = { ...fallback };
  for (const [k, v] of Object.entries(primary)) {
    if (String(v || "").trim()) out[k] = v;
  }
  return out;
}

export function appPushChecklistFromAccounts(
  channel: Record<string, unknown>,
): Record<string, boolean> {
  const platform = String(channel.platform || "both").trim().toLowerCase();
  const fcm = Boolean(channel.fcmConfigured);
  const apns = Boolean(channel.apnsConfigured);
  return {
    app_display_name: Boolean(String(channel.name || "").trim()),
    provider_set: true,
    fcm_configured: fcm,
    fcm_http_v1: fcm,
    fcm_ready: platform === "ios" ? true : fcm,
    apns_configured: apns,
    apns_ready: platform === "android" ? true : apns,
  };
}

export function webPushChecklistFromAccounts(
  channel: Record<string, unknown>,
): Record<string, boolean> {
  return {
    vapid_subject: Boolean(String(channel.vapidSubject || "").trim()),
    vapid_public_key: Boolean(String(channel.vapidPublicKey || "").trim()),
    vapid_private_key: Boolean(channel.vapidConfigured),
    site_origin: false,
  };
}

function accountsHeaders(): Record<string, string> {
  const token = env.accounts.productMcpToken;
  const internal = env.accounts.internalServiceKey;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["x-product-mcp-token"] = token;
  } else if (internal) {
    headers["x-internal-service-key"] = internal;
  } else {
    throw new AccountsChannelError(
      "My Accounts service token is not configured (PRODUCT_MCP_CONNECTORS_TOKEN or INTERNAL_SERVICE_KEY).",
      500,
      "accounts_not_configured",
    );
  }
  return headers;
}

function parseErrorBody(
  payload: unknown,
  status: number,
): { code: string; message: string } {
  if (payload && typeof payload === "object") {
    const b = payload as Record<string, unknown>;
    const code = String(b.code || "").trim();
    const message = String(b.error || b.message || "").trim();
    if (code || message) return { code, message };
  }
  return { code: "", message: `My Accounts error (${status})` };
}

async function accountsGetJson(
  path: string,
  organizationId: string,
): Promise<unknown> {
  const base = env.accounts.apiBaseUrl;
  if (!base) {
    throw new AccountsChannelError(
      "ACCOUNTS_API_BASE_URL is not set.",
      500,
      "accounts_not_configured",
    );
  }
  const url = new URL(path, `${base}/`);
  url.searchParams.set("organization_id", String(organizationId).trim());
  let res: Response;
  try {
    res = await fetch(url, { headers: accountsHeaders() });
  } catch (err) {
    throw new AccountsChannelError(
      `My Accounts unreachable: ${err instanceof Error ? err.message : "network error"}`,
      503,
      "accounts_unreachable",
    );
  }
  let payload: unknown = null;
  const text = await res.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (res.status >= 400) {
    const { code, message } = parseErrorBody(payload, res.status);
    throw new AccountsChannelError(
      message || `My Accounts error (${res.status})`,
      res.status,
      code,
    );
  }
  return payload;
}

function asChannel(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

export async function listAccountsPushChannel(
  organizationId: string,
  kind: PushConfigChannel,
): Promise<Record<string, unknown> | null> {
  if (!isAccountsCampaignChannelsConfigured()) return null;
  const key = `${organizationId}:${kind}:list`;
  const cached = cacheGet(listCache, key);
  if (cached !== undefined) return cached;

  const path =
    kind === "app_push"
      ? "/api/v1/internal/campaign-channels/app-push"
      : "/api/v1/internal/campaign-channels/web-push";
  try {
    const payload = await accountsGetJson(path, organizationId);
    const channels =
      payload && typeof payload === "object"
        ? (payload as { channels?: unknown }).channels
        : null;
    const first =
      Array.isArray(channels) && channels.length
        ? asChannel(channels[0])
        : null;
    cacheSet(listCache, key, first, LIST_TTL_MS);
    return first;
  } catch (err) {
    if (err instanceof AccountsChannelError) {
      if (err.statusCode === 404 || err.code === ACCOUNTS_NOT_CONFIGURED) {
        cacheSet(listCache, key, null, LIST_TTL_MS);
        return null;
      }
    }
    throw err;
  }
}

export async function getAccountsPushCredentials(
  organizationId: string,
  kind: PushConfigChannel,
): Promise<Record<string, string>> {
  const key = `${organizationId}:${kind}:creds`;
  const cached = cacheGet(credsCache, key);
  if (cached) return cached;

  const path =
    kind === "app_push"
      ? "/api/v1/internal/campaign-channels/app-push/credentials"
      : "/api/v1/internal/campaign-channels/web-push/credentials";
  try {
    const payload = await accountsGetJson(path, organizationId);
    const wrapped =
      payload && typeof payload === "object"
        ? (payload as { credentials?: unknown }).credentials
        : null;
    const creds =
      wrapped && typeof wrapped === "object"
        ? wrapped
        : payload &&
            typeof payload === "object" &&
            (kind === "web_push"
              ? "vapidPrivateKey" in payload ||
                "vapid_private_key" in payload ||
                "vapidPublicKey" in payload ||
                "vapid_public_key" in payload
              : "fcmServiceAccount" in payload || "fcmProjectId" in payload)
          ? payload
          : null;
    if (!creds || typeof creds !== "object") {
      throw new AccountsChannelError(
        userMessageForAccountsError(ACCOUNTS_NOT_CONFIGURED, kind),
        404,
        ACCOUNTS_NOT_CONFIGURED,
      );
    }
    const mapped =
      kind === "web_push"
        ? mapWebPushCredentials(creds as Record<string, unknown>)
        : mapAppPushCredentials(creds as Record<string, unknown>);
    cacheSet(credsCache, key, mapped, CREDS_TTL_MS);
    return mapped;
  } catch (err) {
    if (err instanceof AccountsChannelError) {
      if (
        err.code === ACCOUNTS_NOT_CONFIGURED ||
        err.code === ACCOUNTS_CHANNEL_INACTIVE ||
        err.code === ACCOUNTS_NEEDS_REAUTH ||
        err.statusCode === 404 ||
        err.statusCode === 409
      ) {
        const code =
          err.code ||
          (err.statusCode === 409
            ? ACCOUNTS_CHANNEL_INACTIVE
            : ACCOUNTS_NOT_CONFIGURED);
        throw new AccountsChannelError(
          userMessageForAccountsError(code, kind),
          err.statusCode,
          code,
        );
      }
    }
    throw err;
  }
}

export function complianceDenied(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  const act = String(body.act || body.action || "")
    .trim()
    .toLowerCase();
  if (["deny", "block", "forbid", "reject"].includes(act)) return true;
  if (body.allowed === false) return true;
  const instruction = String(body.instruction || "")
    .trim()
    .toLowerCase();
  return instruction === "deny" || instruction === "block";
}

/**
 * Evaluate campaign send compliance. 404 on the evaluate route is skipped
 * (endpoint not deployed yet). Deny/block fails closed.
 */
export async function evaluateCampaignCompliance(args: {
  organizationId: string;
  channel: "app_push" | "web_push";
  country?: string;
  note?: string;
}): Promise<{ skipped?: boolean; body?: Record<string, unknown> }> {
  if (!isAccountsCampaignChannelsConfigured()) {
    return { skipped: true };
  }
  const base = env.accounts.apiBaseUrl;
  const url = `${base}/api/v1/internal/compliance/evaluate`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        ...accountsHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organization_id: String(args.organizationId).trim(),
        product: "campaign",
        country: (args.country || "GB").trim() || "GB",
        channel: args.channel,
        action: "send_campaign",
        note:
          args.note || "Scheduled push campaign to opted-in audience.",
      }),
    });
  } catch (err) {
    throw new AccountsChannelError(
      `Compliance evaluate unreachable: ${err instanceof Error ? err.message : "network error"}`,
      503,
      "accounts_unreachable",
    );
  }
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (res.status === 404) {
    return { skipped: true };
  }
  if (res.status >= 400) {
    const parsed = parseErrorBody(body, res.status);
    throw new AccountsChannelError(
      parsed.message || `Compliance evaluate failed (${res.status})`,
      res.status,
      parsed.code || "compliance_error",
    );
  }
  if (complianceDenied(body)) {
    throw new AccountsChannelError(
      String(
        body?.instruction || body?.error || "Compliance denied this send.",
      ),
      403,
      "compliance_denied",
    );
  }
  return { body: body || { ok: true } };
}

/**
 * Load send settings.
 * App push: prefer Campaign Configuration (local JSON) when Ready — that is
 * the Configuration → Run test path. Otherwise My Accounts, then local.
 * Web push: My Accounts first, merge/fallback to local VAPID when needed.
 */
export async function loadPushSendSettings(args: {
  organizationId: string;
  channel: PushConfigChannel;
  loadLocal: () => Promise<{
    settings: Record<string, string>;
    status: "not_started" | "in_progress" | "ready" | "blocked";
  }>;
}): Promise<{
  settings: Record<string, string>;
  status: "not_started" | "in_progress" | "ready" | "blocked";
  source: "my_accounts" | "campaign_db";
}> {
  const local = await args.loadLocal();

  // Configuration → App push: use saved local JSON when Ready.
  if (args.channel === "app_push" && local.status === "ready") {
    return { ...local, source: "campaign_db" };
  }

  if (isAccountsCampaignChannelsConfigured()) {
    try {
      const settings = await getAccountsPushCredentials(
        args.organizationId,
        args.channel,
      );
      if (args.channel === "web_push" && !webPushSendReady(settings)) {
        const merged = mergeNonEmptySettings(settings, local.settings);
        if (webPushSendReady(merged)) {
          return { settings: merged, status: "ready", source: "my_accounts" };
        }
      } else if (args.channel === "app_push") {
        // Local not ready — use Accounts if available.
        return { settings, status: "ready", source: "my_accounts" };
      } else {
        return { settings, status: "ready", source: "my_accounts" };
      }
    } catch (err) {
      if (err instanceof AccountsChannelError) {
        if (
          err.code === ACCOUNTS_CHANNEL_INACTIVE ||
          err.code === ACCOUNTS_NEEDS_REAUTH
        ) {
          throw err;
        }
        if (
          err.code !== ACCOUNTS_NOT_CONFIGURED &&
          err.statusCode !== 404 &&
          err.code !== "accounts_unreachable" &&
          err.statusCode !== 401 &&
          err.statusCode !== 503
        ) {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  if (args.channel === "web_push" && webPushSendReady(local.settings)) {
    return { ...local, status: "ready", source: "campaign_db" };
  }
  return { ...local, source: "campaign_db" };
}

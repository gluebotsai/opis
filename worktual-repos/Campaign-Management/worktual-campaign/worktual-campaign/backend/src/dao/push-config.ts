// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../plugins/prisma.js";
import { ensureCampaignAccessForOrganization } from "./entitlements.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { isDevWebPushDemoOrigin } from "../helpers/dev-webpush-origins.js";
import type { Prisma } from "@prisma/client";
import {
  appPushChecklistFromAccounts,
  campaignStatusFromAccountsChannel,
  isAccountsCampaignChannelsConfigured,
  listAccountsPushChannel,
  webPushChecklistFromAccounts,
  type PushConfigChannel as AccountsPushKind,
} from "../services/accounts-campaign-channels.js";

export type PushConfigChannel = "web_push" | "app_push";

const WEB_FIELDS = [
  "site_origin",
  "vapid_subject",
  "vapid_public_key",
  "vapid_private_key",
  "default_icon_url",
  "default_badge_url",
  "subscribe_key",
] as const;

const APP_FIELDS = [
  "app_display_name",
  "provider",
  "fcm_project_id",
  "fcm_client_email",
  "fcm_private_key",
  "fcm_server_key",
  "apns_key_id",
  "apns_team_id",
  "apns_bundle_id",
  "apns_key_p8",
] as const;

const SECRET_KEYS = new Set([
  "vapid_private_key",
  "fcm_private_key",
  "fcm_server_key",
  "apns_key_p8",
]);

function asRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null) continue;
    out[k] = String(v).trim();
  }
  return out;
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${"•".repeat(8)}${value.slice(-4)}`;
}

function computeWebChecklist(s: Record<string, string>) {
  return {
    site_origin: Boolean(s.site_origin?.startsWith("http")),
    vapid_subject: Boolean(s.vapid_subject),
    vapid_public_key: Boolean(s.vapid_public_key),
    vapid_private_key: Boolean(s.vapid_private_key),
  };
}

/** FCM ready via HTTP v1 service account (preferred) or legacy server key. */
export function isFcmConfigured(s: Record<string, string>): boolean {
  if (!s.fcm_project_id) return false;
  if (s.fcm_client_email && s.fcm_private_key) return true;
  if (s.fcm_server_key) return true;
  return false;
}

function computeAppChecklist(s: Record<string, string>) {
  const provider = (s.provider || "fcm").toLowerCase();
  const fcmOk = isFcmConfigured(s);
  const apnsOk = Boolean(
    s.apns_key_id && s.apns_team_id && s.apns_bundle_id && s.apns_key_p8,
  );
  return {
    app_display_name: Boolean(s.app_display_name),
    provider_set: Boolean(provider),
    fcm_ready: provider === "apns" ? true : fcmOk,
    apns_ready: provider === "fcm" ? true : apnsOk,
    fcm_configured: fcmOk,
    fcm_http_v1: Boolean(s.fcm_project_id && s.fcm_client_email && s.fcm_private_key),
    apns_configured: apnsOk,
  };
}

function statusFromChecklist(
  channel: PushConfigChannel,
  s: Record<string, string>,
): "not_started" | "in_progress" | "ready" {
  if (channel === "web_push") {
    const c = computeWebChecklist(s);
    const vals = Object.values(c);
    if (vals.every(Boolean)) return "ready";
    if (vals.some(Boolean)) return "in_progress";
    return "not_started";
  }
  const c = computeAppChecklist(s);
  const provider = (s.provider || "fcm").toLowerCase();
  const coreReady =
    c.app_display_name &&
    (provider === "both"
      ? c.fcm_configured && c.apns_configured
      : provider === "apns"
        ? c.apns_configured
        : c.fcm_configured);
  if (coreReady) return "ready";
  if (
    c.app_display_name ||
    c.fcm_configured ||
    c.apns_configured ||
    s.fcm_project_id ||
    s.apns_key_id
  ) {
    return "in_progress";
  }
  return "not_started";
}

function publicSettings(raw: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = SECRET_KEYS.has(k) ? (v ? maskSecret(v) : "") : v;
  }
  return out;
}

export function assertPushConfigChannel(channel: string): PushConfigChannel {
  if (channel === "web_push" || channel === "app_push") return channel;
  throw new AppError("Unknown push configuration channel.", 404);
}

export async function getPushSettingsRawDao(
  organizationId: string,
  channel: PushConfigChannel,
): Promise<{
  settings: Record<string, string>;
  status: "not_started" | "in_progress" | "ready" | "blocked";
}> {
  const row = await prisma.pushChannelSettings.findUnique({
    where: { organizationId_channel: { organizationId, channel } },
  });
  const settings = asRecord(row?.settings);
  const status = row
    ? statusFromChecklist(channel, settings)
    : ("not_started" as const);
  return { settings, status };
}

async function tryListAccountsPushChannel(
  organizationId: string,
  channel: PushConfigChannel,
): Promise<Record<string, unknown> | null | undefined> {
  if (!isAccountsCampaignChannelsConfigured()) return undefined;
  try {
    return await listAccountsPushChannel(
      organizationId,
      channel as AccountsPushKind,
    );
  } catch {
    // Auth/network errors: keep local Campaign settings so send does not hard-fail.
    return undefined;
  }
}

export async function getCampaignPushStatusDao(
  organizationId: string,
  channel: PushConfigChannel,
): Promise<"not_started" | "in_progress" | "ready" | "blocked"> {
  const accountsCh = await tryListAccountsPushChannel(organizationId, channel);
  if (accountsCh) {
    return campaignStatusFromAccountsChannel(accountsCh, channel);
  }
  const row = await prisma.pushChannelSettings.findUnique({
    where: { organizationId_channel: { organizationId, channel } },
  });
  if (!row) return "not_started";
  const status = String(row.status).toLowerCase();
  if (
    status === "ready" ||
    status === "in_progress" ||
    status === "blocked" ||
    status === "not_started"
  ) {
    return status as "not_started" | "in_progress" | "ready" | "blocked";
  }
  return statusFromChecklist(channel, asRecord(row.settings));
}

export async function getPushConfigBundleDao(
  session: CampaignSessionUser,
  channel: PushConfigChannel,
) {
  const row = await prisma.pushChannelSettings.findUnique({
    where: {
      organizationId_channel: { organizationId: session.organizationId, channel },
    },
  });
  let settings = asRecord(row?.settings);
  if (channel === "web_push" && row && !settings.subscribe_key) {
    settings = {
      ...settings,
      subscribe_key: randomBytes(18).toString("base64url"),
    };
    await prisma.pushChannelSettings.update({
      where: { id: row.id },
      data: { settings: settings as Prisma.InputJsonValue },
    });
  }
  const localStatus = row
    ? statusFromChecklist(channel, settings)
    : ("not_started" as const);
  const localChecklist =
    channel === "web_push"
      ? computeWebChecklist(settings)
      : computeAppChecklist(settings);

  const accountsCh = await tryListAccountsPushChannel(
    session.organizationId,
    channel,
  );
  if (accountsCh) {
    const status = campaignStatusFromAccountsChannel(accountsCh, channel);
    const accountsChecklist =
      channel === "web_push"
        ? {
            ...webPushChecklistFromAccounts(accountsCh),
            site_origin: Boolean(settings.site_origin?.startsWith("http")),
          }
        : appPushChecklistFromAccounts(accountsCh);
    const platform = String(accountsCh.platform || "both").toLowerCase();
    const publicFromAccounts: Record<string, string> = {
      app_display_name: String(accountsCh.name || settings.app_display_name || ""),
      provider:
        channel === "app_push"
          ? platform === "ios"
            ? "apns"
            : platform === "android"
              ? "fcm"
              : "both"
          : "",
      fcm_project_id: String(accountsCh.fcmProjectId || ""),
      apns_key_id: String(accountsCh.apnsKeyId || ""),
      apns_team_id: String(accountsCh.apnsTeamId || ""),
      apns_bundle_id: String(
        accountsCh.apnsBundleId || accountsCh.iosBundleId || "",
      ),
      vapid_subject: String(accountsCh.vapidSubject || ""),
      vapid_public_key: String(accountsCh.vapidPublicKey || ""),
      default_icon_url: String(
        accountsCh.defaultIconUrl || settings.default_icon_url || "",
      ),
      site_origin: settings.site_origin || "",
      subscribe_key: settings.subscribe_key || "",
      default_badge_url: settings.default_badge_url || "",
    };
    const secretsSet: Record<string, boolean> = {
      vapid_private_key: Boolean(accountsCh.vapidConfigured),
      fcm_private_key: Boolean(
        accountsCh.fcmConfigured || Boolean(settings.fcm_private_key),
      ),
      fcm_server_key: Boolean(settings.fcm_server_key),
      apns_key_p8: Boolean(
        accountsCh.apnsConfigured || Boolean(settings.apns_key_p8),
      ),
    };
    if (channel === "app_push") {
      return {
        channel,
        label: "App push",
        read_only: false,
        source: localStatus === "ready" ? "campaign_db" : "my_accounts",
        status: localStatus === "ready" ? localStatus : status,
        checklist: {
          ...accountsChecklist,
          ...localChecklist,
          app_display_name:
            Boolean(localChecklist.app_display_name) ||
            Boolean(accountsChecklist.app_display_name),
          fcm_configured:
            Boolean(localChecklist.fcm_configured) ||
            Boolean(accountsChecklist.fcm_configured),
          fcm_http_v1:
            Boolean(localChecklist.fcm_http_v1) ||
            Boolean(accountsChecklist.fcm_http_v1),
          fcm_ready:
            Boolean(localChecklist.fcm_ready) ||
            Boolean(accountsChecklist.fcm_ready),
          apns_configured:
            Boolean(localChecklist.apns_configured) ||
            Boolean(accountsChecklist.apns_configured),
          apns_ready:
            Boolean(localChecklist.apns_ready) ||
            Boolean(accountsChecklist.apns_ready),
        },
        fields: [...APP_FIELDS],
        settings: publicSettings({
          ...publicFromAccounts,
          ...settings,
          provider: settings.provider || publicFromAccounts.provider || "fcm",
          app_display_name:
            settings.app_display_name || publicFromAccounts.app_display_name,
          fcm_project_id:
            settings.fcm_project_id || publicFromAccounts.fcm_project_id,
        }),
        secrets_set: secretsSet,
        updated_at: row?.updatedAt?.toISOString() ?? null,
        setup_hint:
          "Paste Firebase service account JSON below and Save. Run test uses these Campaign credentials (not My Accounts).",
        accounts_status: String(accountsCh.status || ""),
      };
    }
    return {
      channel,
      label: "Web push",
      read_only: false,
      source: "my_accounts",
      status,
      checklist: accountsChecklist,
      fields: [...WEB_FIELDS],
      settings: publicSettings({ ...settings, ...publicFromAccounts }),
      secrets_set: secretsSet,
      updated_at: row?.updatedAt?.toISOString() ?? null,
      setup_hint:
        "VAPID keys are generated in My Accounts → Setup → Channel Setup. Save site origin here for the public subscribe API.",
      accounts_status: String(accountsCh.status || ""),
    };
  }

  return {
    channel,
    label: channel === "web_push" ? "Web push" : "App push",
    read_only: false,
    source: "campaign_db",
    status: localStatus,
    checklist: localChecklist,
    fields: channel === "web_push" ? [...WEB_FIELDS] : [...APP_FIELDS],
    settings: publicSettings(settings),
    secrets_set: Object.fromEntries(
      [...SECRET_KEYS].map((k) => [k, Boolean(settings[k])]),
    ),
    updated_at: row?.updatedAt?.toISOString() ?? null,
    setup_hint: null,
    accounts_status: null,
  };
}

export async function savePushConfigDao(
  session: CampaignSessionUser,
  channel: PushConfigChannel,
  input: Record<string, unknown>,
) {
  const accountsCh = await tryListAccountsPushChannel(
    session.organizationId,
    channel,
  );
  // App push: always allow saving local Firebase/APNs JSON for Configuration
  // Run test. My Accounts remains optional for live campaigns.

  const allowed =
    channel === "web_push" ? new Set<string>(WEB_FIELDS) : new Set<string>(APP_FIELDS);
  if (accountsCh && channel === "web_push") {
    allowed.delete("vapid_subject");
    allowed.delete("vapid_public_key");
    allowed.delete("vapid_private_key");
  }
  const incoming = asRecord(input);
  const existing = await prisma.pushChannelSettings.findUnique({
    where: {
      organizationId_channel: { organizationId: session.organizationId, channel },
    },
  });
  const prev = asRecord(existing?.settings);
  const next: Record<string, string> = { ...prev };

  // Accept full Firebase service-account JSON (not persisted as one blob).
  const saRaw =
    typeof input.fcm_service_account_json === "string"
      ? input.fcm_service_account_json.trim()
      : "";
  if (saRaw && channel === "app_push" && !saRaw.includes("•") && saRaw.startsWith("{")) {
    try {
      const sa = JSON.parse(saRaw) as Record<string, unknown>;
      if (typeof sa.project_id === "string" && sa.project_id.trim()) {
        next.fcm_project_id = sa.project_id.trim();
      }
      if (typeof sa.client_email === "string" && sa.client_email.trim()) {
        next.fcm_client_email = sa.client_email.trim();
      }
      if (typeof sa.private_key === "string" && sa.private_key.trim()) {
        next.fcm_private_key = sa.private_key.replace(/\\n/g, "\n").trim();
      }
    } catch {
      throw new AppError("Service account JSON is invalid.", 400);
    }
  }

  for (const [k, v] of Object.entries(incoming)) {
    if (!allowed.has(k)) continue;
    if (SECRET_KEYS.has(k)) {
      if (!v || v.includes("•")) continue;
      // Paste of full JSON into private_key field → expand
      if (
        k === "fcm_private_key" &&
        v.trim().startsWith("{")
      ) {
        try {
          const sa = JSON.parse(v) as Record<string, unknown>;
          if (typeof sa.project_id === "string" && sa.project_id.trim()) {
            next.fcm_project_id = sa.project_id.trim();
          }
          if (typeof sa.client_email === "string" && sa.client_email.trim()) {
            next.fcm_client_email = sa.client_email.trim();
          }
          if (typeof sa.private_key === "string" && sa.private_key.trim()) {
            next.fcm_private_key = sa.private_key.replace(/\\n/g, "\n").trim();
          }
        } catch {
          throw new AppError("Service account JSON is invalid.", 400);
        }
        continue;
      }
      next[k] = k === "fcm_private_key" ? v.replace(/\\n/g, "\n") : v;
      continue;
    }
    next[k] = v;
  }

  if (channel === "app_push") {
    const p = (next.provider || "fcm").toLowerCase();
    if (!["fcm", "apns", "both"].includes(p)) {
      throw new AppError("provider must be fcm, apns, or both.", 400);
    }
    next.provider = p;
  }

  if (channel === "web_push" && next.site_origin) {
    try {
      // eslint-disable-next-line no-new
      new URL(next.site_origin);
    } catch {
      throw new AppError("site_origin must be a valid URL.", 400);
    }
  }

  if (channel === "web_push" && !next.subscribe_key) {
    next.subscribe_key = randomBytes(18).toString("base64url");
  }

  const status = statusFromChecklist(channel, next);
  await prisma.pushChannelSettings.upsert({
    where: {
      organizationId_channel: { organizationId: session.organizationId, channel },
    },
    create: {
      organizationId: session.organizationId,
      channel,
      settings: next as Prisma.InputJsonValue,
      status,
    },
    update: {
      settings: next as Prisma.InputJsonValue,
      status,
    },
  });

  const checklist =
    channel === "web_push"
      ? computeWebChecklist(next)
      : computeAppChecklist(next);

  await prisma.channelSendingProfile.upsert({
    where: {
      organizationId_channel: { organizationId: session.organizationId, channel },
    },
    create: {
      organizationId: session.organizationId,
      channel,
      status:
        status === "ready"
          ? "ready"
          : status === "in_progress"
            ? "in_progress"
            : "not_started",
      checklist: checklist as Prisma.InputJsonValue,
    },
    update: {
      status:
        status === "ready"
          ? "ready"
          : status === "in_progress"
            ? "in_progress"
            : "not_started",
      checklist: checklist as Prisma.InputJsonValue,
    },
  });

  return getPushConfigBundleDao(session, channel);
}

export function normalizeSiteOrigin(raw: string | null | undefined): string {
  const t = String(raw || "").trim();
  if (!t) return "";
  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    return `${u.protocol}//${u.host}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return t.replace(/\/$/, "").toLowerCase();
  }
}

function keyEquals(stored: string, incoming: string): boolean {
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(incoming, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export type PublicWebPushSite = {
  organizationId: string;
  settings: Record<string, string>;
};

function hasVapidPublicKey(settings: Record<string, string>): boolean {
  return Boolean(String(settings.vapid_public_key || "").trim());
}

/**
 * First local demo visit with no site origin saved: store origin (only if
 * empty) and generate a site key. Never overwrite a production origin.
 */
async function persistLocalDemoBinding(
  site: PublicWebPushSite,
  origin: string,
): Promise<PublicWebPushSite> {
  const next = { ...site.settings };
  let dirty = false;
  if (!normalizeSiteOrigin(next.site_origin)) {
    next.site_origin = origin;
    dirty = true;
  }
  if (!next.subscribe_key) {
    next.subscribe_key = randomBytes(18).toString("base64url");
    dirty = true;
  }
  if (!dirty) return { ...site, settings: next };
  await prisma.pushChannelSettings.update({
    where: {
      organizationId_channel: { organizationId: site.organizationId, channel: "web_push" },
    },
    data: { settings: next as Prisma.InputJsonValue },
  });
  return { organizationId: site.organizationId, settings: next };
}

function pickLocalDemoTenant(
  parsed: PublicWebPushSite[],
  origin: string,
): PublicWebPushSite | null {
  const withBinding = parsed.filter(
    (r) =>
      hasVapidPublicKey(r.settings) ||
      Boolean(r.settings.subscribe_key) ||
      Boolean(normalizeSiteOrigin(r.settings.site_origin)),
  );
  if (!withBinding.length) return null;
  const originHits = withBinding.filter(
    (r) => normalizeSiteOrigin(r.settings.site_origin) === origin,
  );
  if (originHits.length === 1) return originHits[0]!;
  const unbound = withBinding.filter(
    (r) => !normalizeSiteOrigin(r.settings.site_origin),
  );
  if (unbound.length === 1) return unbound[0]!;
  if (withBinding.length === 1) return withBinding[0]!;
  return null;
}

async function overlayAccountsWebVapidPublic(
  site: PublicWebPushSite,
): Promise<PublicWebPushSite> {
  if (hasVapidPublicKey(site.settings)) return site;
  const ch = await tryListAccountsPushChannel(site.organizationId, "web_push");
  if (!ch) return site;
  const pub = String(ch.vapidPublicKey || "").trim();
  if (!pub) return site;
  return {
    ...site,
    settings: {
      ...site.settings,
      vapid_public_key: pub,
      vapid_subject: String(
        ch.vapidSubject || site.settings.vapid_subject || "",
      ).trim(),
    },
  };
}

export async function resolvePublicWebPushSite(opts: {
  subscribeKey?: string | null;
  origin?: string | null;
}): Promise<PublicWebPushSite> {
  const key = String(opts.subscribeKey || "").trim();
  const origin = normalizeSiteOrigin(opts.origin);
  const rows = await prisma.pushChannelSettings.findMany({
    where: { channel: "web_push" },
  });
  const parsed: PublicWebPushSite[] = rows.map((r) => ({
    organizationId: String(r.organizationId),
    settings: asRecord(r.settings),
  }));

  if (key) {
    const hit = parsed.find((r) => keyEquals(r.settings.subscribe_key || "", key));
    if (!hit) {
      throw new AppError("Unknown or invalid site key.", 401);
    }
    const site = normalizeSiteOrigin(hit.settings.site_origin);
    if (origin && site && origin !== site) {
      const localBypass =
        env.nodeEnv !== "production" && isDevWebPushDemoOrigin(origin);
      if (!localBypass) {
        throw new AppError(
          "This page origin does not match Configuration → Web push site origin.",
          403,
        );
      }
    }
    return overlayAccountsWebVapidPublic(hit);
  }

  if (!origin) {
    throw new AppError(
      "Open this page from your configured site, or pass ?key= from Configuration.",
      400,
    );
  }
  const hits = parsed.filter(
    (r) => normalizeSiteOrigin(r.settings.site_origin) === origin,
  );
  if (hits.length === 1) {
    return overlayAccountsWebVapidPublic(
      await persistLocalDemoBinding(hits[0]!, origin),
    );
  }
  if (
    !hits.length &&
    env.nodeEnv !== "production" &&
    isDevWebPushDemoOrigin(origin)
  ) {
    const demo = pickLocalDemoTenant(parsed, origin);
    if (demo) {
      return overlayAccountsWebVapidPublic(
        await persistLocalDemoBinding(demo, origin),
      );
    }
  }
  if (!hits.length) {
    throw new AppError(
      "No Web push site is configured for this origin. Save site origin in Campaign Configuration → Web push, and complete Web Push in My Accounts Channel Setup.",
      404,
    );
  }
  throw new AppError(
    "Several sites share this origin. Open the demo with ?key= from Configuration.",
    400,
  );
}

export async function resolvePublicWebPushByOrganization(opts: {
  organizationId: string;
  channelConfigId?: string | null;
}): Promise<PublicWebPushSite> {
  const organizationId = String(opts.organizationId || "").trim();
  if (!organizationId) {
    throw new AppError("organization_id is required.", 400);
  }
  if (!/^\d+$/.test(organizationId)) {
    throw new AppError("organization_id must be a numeric id.", 400);
  }

  const row = await prisma.pushChannelSettings.findUnique({
    where: {
      organizationId_channel: { organizationId, channel: "web_push" },
    },
  });
  let settings = asRecord(row?.settings);
  const accountsCh = await tryListAccountsPushChannel(
    organizationId,
    "web_push",
  );

  if (accountsCh) {
    const st = String(accountsCh.status || "").trim().toLowerCase();
    if (st === "inactive") {
      throw new AppError(
        "Web Push is inactive. Activate it in My Accounts → Setup → Channel Setup.",
        409,
        "channel_inactive",
      );
    }
    const wanted = String(opts.channelConfigId || "").trim();
    const actual = String(accountsCh.id || "").trim();
    if (wanted && actual && wanted !== actual) {
      throw new AppError(
        "channel_config_id does not match this organization's Web Push channel.",
        400,
        "channel_mismatch",
      );
    }
    settings = {
      ...settings,
      vapid_public_key: String(
        accountsCh.vapidPublicKey || settings.vapid_public_key || "",
      ),
      vapid_subject: String(
        accountsCh.vapidSubject || settings.vapid_subject || "",
      ),
      default_icon_url: String(
        accountsCh.defaultIconUrl || settings.default_icon_url || "",
      ),
    };
  } else if (!hasVapidPublicKey(settings)) {
    throw new AppError(
      "Web Push is not set up yet. Complete it in My Accounts → Setup → Channel Setup.",
      404,
      "not_configured",
    );
  }

  return { organizationId, settings };
}

export async function publicWebPushSession(
  organizationId: string,
): Promise<CampaignSessionUser> {
  const branchId = await ensureCampaignAccessForOrganization(organizationId);
  return {
    id: "public-web-push",
    email: "webpush@site",
    name: "Web push site",
    role: "system",
    initials: "WP",
    organizationId,
    branchId,
    orgName: "Worktual",
    mode: "b2c",
    industry: "generic-b2c",
    businessType: "B2C",
    industryType: null,
  };
}

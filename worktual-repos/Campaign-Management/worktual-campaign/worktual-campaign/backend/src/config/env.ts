import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/** Always load `backend/.env` — npm/dev-lan often starts the API with cwd = monorepo root. */
const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const backendEnvPath = path.join(backendRoot, ".env");

/** Load backend/.env; override so monorepo-root / empty shell vars never win. */
export function reloadBackendEnv(): void {
  if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath, override: true });
    return;
  }
  dotenv.config();
}

reloadBackendEnv();

export function readAccountsOAuthFromProcess() {
  return {
    msTokenEncryptionKey: process.env.MS_TOKEN_ENCRYPTION_KEY?.trim() || "",
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || "",
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "",
    microsoftClientId: process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() || "",
    microsoftClientSecret:
      process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() || "",
  };
}

export function isGoogleOAuthConfigured(): boolean {
  const o = readAccountsOAuthFromProcess();
  return Boolean(o.googleClientId && o.googleClientSecret);
}

export function isMicrosoftOAuthConfigured(): boolean {
  const o = readAccountsOAuthFromProcess();
  return Boolean(o.microsoftClientId && o.microsoftClientSecret);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");
const campaignDatabaseUrl =
  process.env.CAMPAIGN_DATABASE_URL?.trim() || databaseUrl;

if (
  process.env.CAMPAIGN_DATABASE_URL?.trim() &&
  process.env.CAMPAIGN_DATABASE_URL.trim() !== databaseUrl
) {
  throw new Error(
    "CAMPAIGN_DATABASE_URL must match DATABASE_URL (Prisma datasource).",
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3001),
  /** Dedicated Socket.IO listen port (DevOps / host publish). Defaults to 3002. */
  socketPort: Number(process.env.SOCKET_PORT ?? 3002),
  host: process.env.HOST ?? "0.0.0.0",
  accountDatabaseUrl: required("ACCOUNT_DATABASE_URL"),
  databaseUrl,
  campaignDatabaseUrl,
  jwtSecret:
    process.env.JWT_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "change-me-in-production-campaign",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  /** Worktual CRM access JWT — separate from Campaign SPA JWT_SECRET. */
  crmJwt: {
    accessSecret:
      process.env.CRM_JWT_ACCESS_SECRET?.trim() ||
      process.env.JWT_ACCESS_SECRET?.trim() ||
      "",
    issuer: process.env.CRM_JWT_ISSUER?.trim() || "",
    userIdClaim: process.env.CRM_JWT_USER_ID_CLAIM?.trim() || "sub",
    algorithm: (process.env.CRM_JWT_ALGORITHM?.trim().toUpperCase() ||
      "HS256") as "HS256",
  },
  /**
   * CRM monitor/agent Personalised CRM (M2M). Not a JWT signing secret.
   * Header: X-Crm-Integration-Key. Do not reuse INTERNAL_SERVICE_KEY.
   */
  crmIntegrationKey: process.env.CRM_INTEGRATION_KEY?.trim() || "",
  redisUrl: process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
  corsOrigin:
    process.env.CORS_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:5173,http://localhost:5500",
  corsOrigins: (
    process.env.CORS_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:5173,http://localhost:5500"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:5173",
  /**
   * Public base URL of this API — email open pixel, click redirects, push click_url,
   * mailbox verify links. Must be reachable from the public internet (not LAN/localhost)
   * or open/click rates stay at zero.
   */
  apiPublicUrl:
    process.env.API_PUBLIC_URL?.trim() ||
    `http://localhost:${Number(process.env.PORT ?? 3001)}`,
  /** LAN/local dev only — store media on this API without forward to rebuild. Never in production. */
  media: {
    allowLocalPublish: (() => {
      if ((process.env.NODE_ENV ?? "development") === "production") {
        return false;
      }
      const raw = String(process.env.MEDIA_ALLOW_LOCAL_PUBLISH ?? "")
        .trim()
        .toLowerCase();
      if (["0", "false", "no"].includes(raw)) return false;
      if (["1", "true", "yes"].includes(raw)) return true;
      return true;
    })(),
    /** Bypass nginx to prod backend (e.g. http://82.113.92.49:3001) for LAN → rebuild publish. */
    publicDirectOrigin: String(process.env.MEDIA_PUBLIC_DIRECT_ORIGIN ?? "")
      .trim()
      .replace(/\/$/, ""),
    publicHostHeader: String(
      process.env.MEDIA_PUBLIC_HOST_HEADER ?? "",
    ).trim(),
  },
  /**
   * Optional QA lab landing base. Live email clicks stamp wt= onto the
   * template destination URL (KB/user/form), not this host.
   */
  webTracking: {
    landingUrl: process.env.WEB_TRACKING_LANDING_URL?.trim() || "",
    hmacSecret: process.env.WEB_TRACKING_HMAC_SECRET?.trim() || "",
  },
  emailWorkerIntervalMs: Number(process.env.EMAIL_WORKER_INTERVAL_MS ?? 15_000),
  push: {
    /** Dev-only: invent stub:// destinations. Campaign launch ignores this unless PUSH_FORCE_STUB. */
    stubAudience:
      String(process.env.PUSH_STUB_AUDIENCE ?? "false").toLowerCase() === "true",
    /** Allow sending to stub:// destinations (local demos). */
    allowStubSend:
      String(process.env.PUSH_ALLOW_STUB_SEND ?? "true").toLowerCase() !==
      "false",
    /** Force all push through stub (ignore FCM/APNs). */
    forceStub:
      String(process.env.PUSH_FORCE_STUB ?? "false").toLowerCase() === "true",
    /** Force stub sends to fail (tests). */
    failStub:
      String(process.env.PUSH_STUB_FAIL ?? "false").toLowerCase() === "true",
    workerIntervalMs: Number(process.env.PUSH_WORKER_INTERVAL_MS ?? 15_000),
  },
  /**
   * My Accounts Setup → Channel Setup (App Push / Web Push credentials).
   * Empty apiBaseUrl keeps Campaign on local push_channel_settings (legacy).
   */
  accounts: {
    apiBaseUrl: (
      process.env.ACCOUNTS_API_BASE_URL?.trim() ||
      process.env.MY_ACCOUNTS_API_BASE_URL?.trim() ||
      ""
    ).replace(/\/$/, ""),
    productMcpToken:
      process.env.PRODUCT_MCP_CONNECTORS_TOKEN?.trim() || "",
    internalServiceKey:
      process.env.INTERNAL_SERVICE_KEY?.trim() || "",
  },
  /**
   * WhatsApp / Meta via social-service (template submit + status + send).
   * Base paths: /internal/v1/whatsapp/templates… (see WHATSAPP_TEMPLATE_API.md).
   * channelConfigId is a numeric accounts.setup_channel_configs id (not a UUID).
   */
  social: {
    baseUrl:
      process.env.SOCIAL_SERVICE_BASE_URL?.trim() ||
      "https://rebuild-ccaas-api.worktual.com/social-api",
    internalServiceKey:
      process.env.INTERNAL_SERVICE_KEY?.trim() || "",
    /** Add ngrok-skip-browser-warning when using ngrok free tier. */
    ngrokSkipBrowserWarning:
      String(process.env.SOCIAL_SERVICE_NGROK_SKIP ?? "false").toLowerCase() ===
      "true",
    /**
     * Static Meta channel config id (numeric string, e.g. "1063"). Empty string
     * disables static and falls back to Accounts setup_channel_configs.
     */
    whatsappChannelConfigId:
      process.env.WHATSAPP_CHANNEL_CONFIG_ID?.trim() || "",
    /** Poll Meta approval-status for pending templates (default 30 min; min 60s). */
    statusPollIntervalMs: Number(
      process.env.WHATSAPP_STATUS_POLL_INTERVAL_MS ?? 1_800_000,
    ),
    workerIntervalMs: Number(process.env.WHATSAPP_WORKER_INTERVAL_MS ?? 15_000),
    /** Future approved-template sends only. Does not change the main WhatsApp worker. */
    approvedTemplatePollIntervalMs: Number(
      process.env.APPROVED_TEMPLATE_POLL_INTERVAL_MS ?? 1_800_000,
    ),
  },
  /**
   * Dynamic send personalization adapter.
   * PERSONALIZATION_ADAPTER=fixture|noop
   * When unset: fixture in non-production (demo), noop in production.
   */
  personalization: {
    adapter: (process.env.PERSONALIZATION_ADAPTER?.trim().toLowerCase() ||
      "") as "" | "fixture" | "noop",
  },
  /** My Accounts mailbox secrets + optional OAuth refresh (Phase 2 test send). */
  get accountsOAuth() {
    return readAccountsOAuthFromProcess();
  },
  /** Campaign launch + daily reports: My Accounts mailbox only. */
  accountsEmailLaunch: {
    enabled:
      String(process.env.ACCOUNTS_EMAIL_LAUNCH ?? "false").toLowerCase() ===
      "true",
    /** Max sends per minute on Accounts OAuth/SMTP (default 8 → ~7.5s gap). */
    ratePerMinute: Math.max(
      1,
      Number(process.env.ACCOUNTS_EMAIL_RATE_PER_MINUTE ?? 8),
    ),
    /** Pause remaining batches when this fail share is hit (min 5 outcomes). */
    failRatePause: Math.min(
      1,
      Math.max(0.05, Number(process.env.ACCOUNTS_EMAIL_FAIL_RATE_PAUSE ?? 0.15)),
    ),
  },
  /** Automated daily campaign report email (operational, not bulk campaign sends). */
  dailyReport: {
    enabled:
      String(process.env.DAILY_REPORT_ENABLED ?? "true").toLowerCase() !==
      "false",
    from: process.env.DAILY_REPORT_FROM?.trim() || "",
    /** Worker tick — 15 min default to hit 17:00–18:00 send window reliably. */
    workerIntervalMs: Number(
      process.env.DAILY_REPORT_WORKER_INTERVAL_MS ?? 900_000,
    ),
  },
  /** Automatic Template Gallery bootstrap (background worker). */
  gallery: {
    enabled:
      String(process.env.GALLERY_BOOTSTRAP_ENABLED ?? "true").toLowerCase() !==
      "false",
    workerIntervalMs: Number(
      process.env.GALLERY_WORKER_INTERVAL_MS ?? 30_000,
    ),
    minIdeas: Number(process.env.GALLERY_MIN_IDEAS ?? 10),
    templatesPerTick: Math.max(
      1,
      Math.min(Number(process.env.GALLERY_TEMPLATES_PER_TICK ?? 2), 5),
    ),
    /** Long sleep when no queued/running gallery jobs — no agent calls. */
    workerIdleIntervalMs: Number(
      process.env.GALLERY_WORKER_IDLE_INTERVAL_MS ?? 300_000,
    ),
  },
};

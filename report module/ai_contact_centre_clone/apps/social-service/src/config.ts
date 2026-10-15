export type AutoReplyButtonConfig = {
  id: string;
  title: string;
};

export type AutoReplyTemplateConfig = {
  name: string;
  languageCode: string;
};

export type MetaWhatsAppAppConfig = {
  verifyToken: string;
  appSecret: string | null;
  appId: string | null;
  graphApiVersion: string;
  markRead: boolean;
  autoReply: boolean;
  autoReplyMessage: string;
  autoReplyTemplate: AutoReplyTemplateConfig | null;
  autoReplyButtons: boolean;
  autoReplyButtonBody: string;
  autoReplyButtonList: [AutoReplyButtonConfig, AutoReplyButtonConfig];
};

export type DirectCredentialStoreConfig = {
  encryptionKey: string;
  renewalWindowMs: number;
  credentialCacheTtlMs: number;
};

export type AccountsApiConfig = {
  baseUrl: string;
  serviceKey: string;
  timeoutMs: number;
  renewalWindowMs: number;
  credentialCacheTtlMs: number;
};

export type MetaMessengerAppConfig = {
  facebookVerifyToken: string;
  instagramVerifyToken: string;
  /** Facebook / shared Messenger app secret (falls back to WhatsApp). */
  appSecret: string | null;
  appId: string | null;
  /** Instagram-only app credentials when IG uses a different Meta app. */
  instagramAppSecret: string | null;
  instagramAppId: string | null;
  graphApiVersion: string;
  autoReply: boolean;
  autoReplyMessage: string;
  autoReplyButtons: boolean;
  autoReplyButtonBody: string;
  autoReplyButtonList: [AutoReplyButtonConfig, AutoReplyButtonConfig];
};

export type SocialServiceConfig = {
  port: number;
  serviceName: string;
  internalServiceKey: string | null;
  accounts: AccountsApiConfig | null;
  directCredentialStore: DirectCredentialStoreConfig | null;
  metaWhatsApp: MetaWhatsAppAppConfig | null;
  metaMessenger: MetaMessengerAppConfig | null;
};

function readRequired(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadMetaWhatsAppConfig(): MetaWhatsAppAppConfig | null {
  const verifyToken = readRequired("META_WHATSAPP_VERIFY_TOKEN");
  const appSecret = readRequired("META_WHATSAPP_APP_SECRET");

  if (!verifyToken) {
    return null;
  }

  const autoReply =
    process.env.NODE_ENV === "test"
      ? process.env.META_WHATSAPP_AUTO_REPLY === "true"
      : process.env.META_WHATSAPP_AUTO_REPLY === "true";
  const templateName = process.env.META_WHATSAPP_AUTO_REPLY_TEMPLATE_NAME?.trim() || null;

  return {
    verifyToken,
    appSecret,
    appId: readRequired("META_WHATSAPP_APP_ID"),
    graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() || "v26.0",
    markRead: process.env.META_WHATSAPP_MARK_READ === "true",
    autoReply,
    autoReplyMessage:
      process.env.META_WHATSAPP_AUTO_REPLY_MESSAGE?.trim() ||
      "Hello! This is a test auto-reply from Worktual social-service.",
    autoReplyTemplate: templateName
      ? {
          name: templateName,
          languageCode:
            process.env.META_WHATSAPP_AUTO_REPLY_TEMPLATE_LANGUAGE?.trim() || "en",
        }
      : null,
    autoReplyButtons: process.env.META_WHATSAPP_AUTO_REPLY_BUTTONS !== "false",
    autoReplyButtonBody:
      process.env.META_WHATSAPP_AUTO_REPLY_BUTTON_BODY?.trim() ||
      "Please choose an option to test button replies:",
    autoReplyButtonList: [
      {
        id: process.env.META_WHATSAPP_AUTO_REPLY_BUTTON_1_ID?.trim() || "btn_option_1",
        title: process.env.META_WHATSAPP_AUTO_REPLY_BUTTON_1_TITLE?.trim() || "Option 1",
      },
      {
        id: process.env.META_WHATSAPP_AUTO_REPLY_BUTTON_2_ID?.trim() || "btn_option_2",
        title: process.env.META_WHATSAPP_AUTO_REPLY_BUTTON_2_TITLE?.trim() || "Option 2",
      },
    ],
  };
}

export function loadDirectCredentialStoreConfig(): DirectCredentialStoreConfig | null {
  const encryptionKey = readRequired("MS_TOKEN_ENCRYPTION_KEY");
  if (!encryptionKey) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error("MS_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal key");
  }
  return {
    encryptionKey,
    renewalWindowMs: readPositiveNumber(
      "META_TOKEN_RENEWAL_WINDOW_MS",
      7 * 24 * 60 * 60 * 1_000,
    ),
    credentialCacheTtlMs: readPositiveNumber(
      "META_CREDENTIAL_CACHE_TTL_MS",
      60_000,
    ),
  };
}

export function loadAccountsApiConfig(): AccountsApiConfig | null {
  const baseUrl = readRequired("ACCOUNTS_INTERNAL_API_URL");
  const serviceKey =
    readRequired("ACCOUNTS_INTERNAL_SERVICE_KEY") ?? readRequired("INTERNAL_SERVICE_KEY");
  if (!baseUrl || !serviceKey) return null;

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    serviceKey,
    timeoutMs: readPositiveNumber("ACCOUNTS_API_TIMEOUT_MS", 5_000),
    renewalWindowMs: readPositiveNumber("META_TOKEN_RENEWAL_WINDOW_MS", 7 * 24 * 60 * 60 * 1_000),
    credentialCacheTtlMs: readPositiveNumber("META_CREDENTIAL_CACHE_TTL_MS", 60_000),
  };
}

export function loadMetaMessengerConfig(): MetaMessengerAppConfig | null {
  const facebookVerifyToken =
    readRequired("META_FACEBOOK_VERIFY_TOKEN") ??
    readRequired("META_MESSENGER_VERIFY_TOKEN") ??
    readRequired("META_WHATSAPP_VERIFY_TOKEN");
  const instagramVerifyToken =
    readRequired("META_INSTAGRAM_VERIFY_TOKEN") ??
    readRequired("META_MESSENGER_VERIFY_TOKEN") ??
    facebookVerifyToken;
  const appSecret =
    readRequired("META_MESSENGER_APP_SECRET") ??
    readRequired("META_FACEBOOK_APP_SECRET") ??
    readRequired("META_WHATSAPP_APP_SECRET");
  const instagramAppSecret =
    readRequired("META_INSTAGRAM_APP_SECRET") ??
    readRequired("META_MESSENGER_APP_SECRET") ??
    appSecret;
  const appId =
    readRequired("META_MESSENGER_APP_ID") ??
    readRequired("META_FACEBOOK_APP_ID") ??
    readRequired("META_WHATSAPP_APP_ID");
  const instagramAppId =
    readRequired("META_INSTAGRAM_APP_ID") ??
    readRequired("META_MESSENGER_APP_ID") ??
    appId;

  if (!facebookVerifyToken && !instagramVerifyToken) {
    return null;
  }

  return {
    facebookVerifyToken: facebookVerifyToken ?? instagramVerifyToken!,
    instagramVerifyToken: instagramVerifyToken ?? facebookVerifyToken!,
    appSecret,
    appId,
    instagramAppSecret,
    instagramAppId,
    graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() || "v26.0",
    autoReply: process.env.META_MESSENGER_AUTO_REPLY === "true",
    autoReplyMessage:
      process.env.META_MESSENGER_AUTO_REPLY_MESSAGE?.trim() ||
      "Hello! This is a test auto-reply from Worktual social-service.",
    autoReplyButtons: process.env.META_MESSENGER_AUTO_REPLY_BUTTONS !== "false",
    autoReplyButtonBody:
      process.env.META_MESSENGER_AUTO_REPLY_BUTTON_BODY?.trim() ||
      "Please choose an option to test quick replies:",
    autoReplyButtonList: [
      {
        id: process.env.META_MESSENGER_AUTO_REPLY_BUTTON_1_ID?.trim() || "btn_option_1",
        title:
          process.env.META_MESSENGER_AUTO_REPLY_BUTTON_1_TITLE?.trim() || "Option 1",
      },
      {
        id: process.env.META_MESSENGER_AUTO_REPLY_BUTTON_2_ID?.trim() || "btn_option_2",
        title:
          process.env.META_MESSENGER_AUTO_REPLY_BUTTON_2_TITLE?.trim() || "Option 2",
      },
    ],
  };
}

export function loadConfig(): SocialServiceConfig {
  return {
    port: Number(process.env.PORT ?? 3004),
    serviceName: "social-service",
    internalServiceKey: readRequired("INTERNAL_SERVICE_KEY"),
    accounts: loadAccountsApiConfig(),
    directCredentialStore: loadDirectCredentialStoreConfig(),
    metaWhatsApp: loadMetaWhatsAppConfig(),
    metaMessenger: loadMetaMessengerConfig(),
  };
}

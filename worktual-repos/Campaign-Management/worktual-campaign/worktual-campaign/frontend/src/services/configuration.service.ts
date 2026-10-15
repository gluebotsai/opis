import { api, apiGet } from "@/services/api";

export type ConfigChannelStatus =
  | "not_started"
  | "in_progress"
  | "ready"
  | "blocked";

export type ConfigChannel = {
  channel: string;
  label: string;
  group: string;
  status: ConfigChannelStatus;
  implemented?: boolean;
  read_only?: boolean;
  source?: string;
  /** Optional status caption from API (e.g. mailbox not connected). */
  detail?: string;
  configs?: Array<{
    id: string;
    channel_type: string;
    name: string;
    status: string;
    updated_at?: string | null;
  }>;
  updated_at?: string | null;
};

export type ChannelConfigDetail = {
  channel: string;
  label?: string;
  group?: string;
  status?: ConfigChannelStatus;
  read_only?: boolean;
  message?: string;
  configs?: ConfigChannel["configs"];
};

export type EmailChecklist = {
  postal: boolean;
  sender_verified: boolean;
  domain_authenticated: boolean;
  return_path_verified: boolean;
  compliance_defaults: boolean;
  forced_unsubscribe: boolean;
  doi_default_on: boolean;
};

export type EmailConfigBundle = {
  read_only: boolean;
  source: string;
  status: ConfigChannelStatus;
  checklist: EmailChecklist;
  transport?: "accounts_mailbox";
  org: {
    id: string;
    legal_name: string;
    street: string;
    city: string;
    country: string;
    phone: string | null;
    updated_at: string;
  } | null;
  senders: Array<{
    id: string;
    display_name: string;
    from_email: string;
    reply_to: string | null;
    status: string;
    is_active?: boolean;
    verify_expires_at: string | null;
    verified_at: string | null;
    created_at: string;
  }>;
  domains: Array<{
    id: string;
    domain: string;
    spf_ok: boolean;
    dkim_ok: boolean;
    dmarc_ok: boolean;
    status: string;
    updated_at: string;
    provider_domain_id?: string | null;
    dns_records?: Array<{
      record?: string;
      name: string;
      type: string;
      value: string;
      ttl?: string;
      status?: string;
      priority?: number;
    }> | null;
    dns_hints?: {
      spf: string;
      dkim_host: string;
      dkim_value: string;
      dmarc_host: string;
      dmarc_value: string;
      mx_host?: string;
      mx_value?: string;
    };
  }>;
  return_path: {
    id: string;
    domain: string;
    status: string;
    updated_at: string;
  } | null;
  caps: {
    batch_size: number;
    hourly_cap: number;
    daily_cap: number;
    warmup_stage: number;
    health_status: string;
    health_stats: unknown;
  };
};

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

/** Soft-nav: keep last channels list in memory so /configuration doesn't skeleton every enter. */
let cachedConfigChannels: ConfigChannel[] | null = null;
let cachedConfigChannelsAt = 0;
const CONFIG_CHANNELS_TTL_MS = 5 * 60_000;

export function getCachedConfigChannels(): ConfigChannel[] | null {
  if (!cachedConfigChannels) return null;
  if (Date.now() - cachedConfigChannelsAt > CONFIG_CHANNELS_TTL_MS) return null;
  return cachedConfigChannels;
}

export function invalidateConfigChannelsCache(): void {
  cachedConfigChannels = null;
  cachedConfigChannelsAt = 0;
}

export async function fetchConfigChannels(options?: { force?: boolean }) {
  if (!options?.force) {
    const hit = getCachedConfigChannels();
    if (hit) return hit;
  }
  const { data } = await apiGet<ApiBody<{ channels: ConfigChannel[] }>>(
    "/configuration/channels",
  );
  const rows = data.channels ?? [];
  cachedConfigChannels = rows;
  cachedConfigChannelsAt = Date.now();
  return rows;
}

export async function fetchChannelConfig(channel: string) {
  const { data } = await apiGet<ApiBody<ChannelConfigDetail>>(
    `/configuration/channels/${channel}`,
  );
  return data;
}

export async function fetchEmailConfig() {
  const { data } = await apiGet<
    ApiBody<{ config: EmailConfigBundle; read_only?: boolean }>
  >("/configuration/email");
  return data.config;
}

export async function saveEmailOrg(body: {
  legal_name: string;
  street: string;
  city: string;
  country: string;
  phone?: string | null;
}) {
  const { data } = await api.put<ApiBody<{ org: EmailConfigBundle["org"] }>>(
    "/configuration/email/org",
    body,
  );
  return data.org;
}

export async function addEmailSender(body: {
  display_name: string;
  from_email: string;
  reply_to?: string | null;
}) {
  const { data } = await api.post<
    ApiBody<{
      sender: EmailConfigBundle["senders"][number];
      verification: { mode: string; message: string };
    }>
  >("/configuration/email/senders", body);
  return data;
}

export async function verifyEmailSender(id: string) {
  const { data } = await api.post<
    ApiBody<{ sender: EmailConfigBundle["senders"][number] }>
  >(`/configuration/email/senders/${id}/verify`);
  return data.sender;
}

export async function resendEmailSender(id: string) {
  const { data } = await api.post<
    ApiBody<{
      sender: EmailConfigBundle["senders"][number];
      verification: { mode: string; message: string };
    }>
  >(`/configuration/email/senders/${id}/resend`);
  return data;
}

export async function activateEmailSender(id: string) {
  const { data } = await api.post<
    ApiBody<{ sender: EmailConfigBundle["senders"][number] }>
  >(`/configuration/email/senders/${id}/activate`);
  return data.sender;
}

export async function deleteEmailSender(id: string) {
  const { data } = await api.delete<
    ApiBody<{ deleted: boolean; id: string }>
  >(`/configuration/email/senders/${id}`);
  return data;
}

export async function saveEmailDomain(domain: string) {
  const { data } = await api.put<
    ApiBody<{ domain: EmailConfigBundle["domains"][number] }>
  >("/configuration/email/domains", { domain });
  return data.domain;
}

export async function verifyEmailDomain(id: string) {
  const { data } = await api.post<
    ApiBody<{ domain: EmailConfigBundle["domains"][number] }>
  >(`/configuration/email/domains/${id}/verify`);
  return data.domain;
}

/** Save Postfix domainId after OpenDKIM handoff (Mode B). */
export async function saveEmailDomainProvider(
  id: string,
  providerDomainId: string,
) {
  const { data } = await api.put<
    ApiBody<{ domain: EmailConfigBundle["domains"][number] }>
  >(`/configuration/email/domains/${id}/provider`, {
    provider_domain_id: providerDomainId,
  });
  return data.domain;
}

export async function saveEmailReturnPath(domain: string) {
  const { data } = await api.put<
    ApiBody<{ return_path: EmailConfigBundle["return_path"] }>
  >("/configuration/email/return-path", { domain });
  return data.return_path;
}

export async function verifyEmailReturnPath() {
  const { data } = await api.post<
    ApiBody<{ return_path: EmailConfigBundle["return_path"] }>
  >("/configuration/email/return-path/verify");
  return data.return_path;
}

export async function saveEmailCaps(body: {
  batch_size?: number;
  hourly_cap?: number;
  daily_cap?: number;
  warmup_stage?: number;
}) {
  const { data } = await api.put<
    ApiBody<{ caps: EmailConfigBundle["caps"] }>
  >("/configuration/email/caps", body);
  return data.caps;
}

export type EmailTrackLinkPreview = {
  token: string;
  organization_id: string;
  campaign_id: string;
  contact_id: string;
  campaign_name?: string;
  channel: string;
  landing_base: string;
  web_tracking_url: string;
  email_click_url: string;
  destination_url: string | null;
  note: string;
};

/** Temporary QA — homepage UTM + wt={token} + email click wrapper. */
export async function previewEmailTrackLink(body: {
  organization_id: string;
  campaign_id: string;
  contact_id?: string;
  campaign_name?: string;
  destination_url?: string;
  channel?: string;
}) {
  const { data } = await api.post<ApiBody<EmailTrackLinkPreview>>(
    "/configuration/email/track-link-preview",
    body,
  );
  const { statusCode: _s, message: _m, ...preview } = data;
  return preview;
}

export type PushConfigBundle = {
  channel: "web_push" | "app_push";
  label: string;
  read_only: boolean;
  source: string;
  status: ConfigChannelStatus;
  checklist: Record<string, boolean>;
  fields: string[];
  settings: Record<string, string>;
  secrets_set: Record<string, boolean>;
  updated_at: string | null;
  setup_hint?: string | null;
  accounts_status?: string | null;
};

export async function fetchPushConfig(channel: "web_push" | "app_push") {
  const { data } = await apiGet<
    ApiBody<{ config: PushConfigBundle; read_only?: boolean }>
  >(`/configuration/push/${channel}`);
  return data.config;
}

export async function savePushConfig(
  channel: "web_push" | "app_push",
  settings: Record<string, string>,
) {
  const { data } = await api.put<ApiBody<{ config: PushConfigBundle }>>(
    `/configuration/push/${channel}`,
    { settings },
  );
  return data.config;
}

export type PushTestSendResult = {
  ok: boolean;
  provider: string;
  message_id: string;
  platform: string;
  contact_email?: string | null;
  destination_preview: string;
};

/** One-off test push using saved App or Web push credentials. */
export async function testPushConfigSend(
  channel: "web_push" | "app_push",
  body: {
    title: string;
    body: string;
    email?: string;
    endpoint?: string;
    endpoint_id?: string;
    platform?: string;
  },
) {
  const { data } = await api.post<ApiBody<PushTestSendResult>>(
    `/configuration/push/${channel}/test-send`,
    body,
  );
  return data;
}

export type SmsConfigBundle = {
  channel: "sms";
  label: string;
  read_only: boolean;
  source: string;
  status: ConfigChannelStatus;
  checklist: Record<string, boolean>;
  fields: string[];
  settings: Record<string, string>;
  secrets_set: Record<string, boolean>;
  updated_at: string | null;
};

export async function fetchSmsConfig() {
  const { data } = await apiGet<
    ApiBody<{ config: SmsConfigBundle; read_only?: boolean }>
  >("/configuration/sms");
  return data.config;
}

export async function saveSmsConfig(settings: Record<string, string>) {
  const { data } = await api.put<ApiBody<{ config: SmsConfigBundle }>>(
    "/configuration/sms",
    { settings },
  );
  return data.config;
}

export type AccountsEmailMailbox = {
  channel_id: string;
  name: string;
  channel_status: string;
  provider_type: string;
  third_party_mode: string | null;
  oauth_provider: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to: string | null;
  domain: string | null;
  display_from: string | null;
  transport: "oauth" | "smtp" | "unavailable";
  status: ConfigChannelStatus;
  send_ready: boolean;
  block_reason: string | null;
  crypto_configured: boolean;
  oauth_account_email: string | null;
  oauth_needs_reauth: boolean;
};

export type EmailPhase2Config = {
  phase2: boolean;
  worktual_api: boolean;
  selected: AccountsEmailMailbox | null;
  mailboxes: AccountsEmailMailbox[];
  setup_hint: string;
  lookup_error?: string;
};

export async function fetchEmailPhase2Config() {
  const { data } = await apiGet<
    ApiBody<EmailPhase2Config>
  >("/configuration/email/phase2");
  return data;
}

export type EmailPhase2TestSendResult = {
  ok: boolean;
  transport: "oauth" | "smtp";
  provider: string;
  from: string;
  to: string;
  message_id: string;
};

export async function testEmailPhase2Send(body: {
  to: string;
  channel_id?: string;
  subject?: string;
}) {
  const { data } = await api.post<ApiBody<EmailPhase2TestSendResult>>(
    "/configuration/email/phase2/test-send",
    body,
  );
  return data;
}

export type AppPushIntegrationKeyStatus = {
  configured: boolean;
  purpose: string;
  key_prefix: string | null;
  created_at: string | null;
  last_used_at: string | null;
  register_url?: string;
  auth_header?: string;
};

export async function fetchAppPushIntegrationKeyStatus() {
  const { data } = await apiGet<
    ApiBody<AppPushIntegrationKeyStatus>
  >("/configuration/integration/app-push-api-key");
  return {
    configured: data.configured ?? false,
    purpose: data.purpose ?? "app_push",
    key_prefix: data.key_prefix ?? null,
    created_at: data.created_at ?? null,
    last_used_at: data.last_used_at ?? null,
    register_url: data.register_url,
    auth_header: data.auth_header,
  };
}

export type AppPushIntegrationKeyMint = {
  id: string;
  purpose: string;
  api_key: string;
  key_prefix: string;
  message: string;
};

/** Mint or rotate org app-push integration key (admin; plain key returned once). */
export async function mintAppPushIntegrationKey() {
  const { data } = await api.post<ApiBody<AppPushIntegrationKeyMint>>(
    "/configuration/integration/app-push-api-key",
    {},
  );
  return {
    id: data.id,
    purpose: data.purpose,
    api_key: data.api_key,
    key_prefix: data.key_prefix,
    message: data.message,
  };
}

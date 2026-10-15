import { api } from "./api";

export type EmailIntegrationsStatus = {
  googleConfigured: boolean;
  googleRedirectUri: string | null;
  googleConnected: boolean;
  googleEmail: string | null;
  googleCanSendMail: boolean;
  googleCanReadMail: boolean;
  googleCanScheduleMeetings: boolean;
  microsoftConfigured: boolean;
  microsoftConnected: boolean;
  microsoftEmail: string | null;
  microsoftDisplayEmail: string | null;
  microsoftIsGuest: boolean;
  microsoftCanSendMail: boolean;
  microsoftCanReadMail: boolean;
  preferredSendProvider: "google" | "microsoft" | null;
  canSendMail: boolean;
  zoomConfigured: boolean;
  teamsConfigured: boolean;
  crmBotChannelName: string | null;
  crmBotEmail: string | null;
  crmBotProvider: "google" | "microsoft" | null;
  crmBotConnected: boolean;
  crmBotNeedsReauth: boolean;
  canReconnectCrmBot: boolean;
};

export async function fetchEmailIntegrations() {
  const { data } = await api.get<{ ok: true; status: EmailIntegrationsStatus }>(
    "/api/configuration/email",
  );
  return data.status;
}

export async function disconnectGoogleEmail() {
  const { data } = await api.post("/api/configuration/email/disconnect/google");
  return data as { ok: true } | { ok: false; error: string };
}

export async function disconnectMicrosoftEmail() {
  const { data } = await api.post(
    "/api/configuration/email/disconnect/microsoft",
  );
  return data as { ok: true } | { ok: false; error: string };
}

export async function setPreferredSendProvider(
  provider: "google" | "microsoft",
) {
  const { data } = await api.post("/api/configuration/email/preferred", {
    provider,
  });
  return data as { ok: true } | { ok: false; error: string };
}

/** OAuth start on Fastify (proxied via Vite /api → :4000). Callback hits API host. */
export function oauthStartUrl(
  provider: "google" | "microsoft",
  returnTo = `${window.location.origin}/configuration/email`,
  intent?: string,
) {
  const path =
    provider === "google"
      ? "/api/google/oauth/start"
      : "/api/microsoft/oauth/start";
  const params = new URLSearchParams({ returnTo });
  if (intent) params.set("intent", intent);
  return `${path}?${params.toString()}`;
}

export const API_KEY_SCOPE_OPTIONS = [
  { id: "contacts", label: "Contacts" },
  { id: "companies", label: "Companies" },
  { id: "deals", label: "Deals & proposals" },
  { id: "activities", label: "Activities" },
  { id: "products", label: "Products" },
  { id: "quotes", label: "Quotes" },
  { id: "invoices", label: "Invoices" },
  { id: "commerce", label: "Commerce orders" },
] as const;

export type TenantApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export async function fetchTenantApiKeys() {
  const { data } = await api.get<
    { ok: true; items: TenantApiKey[] } | { ok: false; error: string }
  >("/api/configuration/api-keys");
  return data;
}

export async function createTenantApiKey(input: {
  name: string;
  scopes: string[];
}) {
  const { data } = await api.post<
    | { ok: true; secret: string; key: TenantApiKey }
    | { ok: false; error: string }
  >("/api/configuration/api-keys", input);
  return data;
}

export async function revokeTenantApiKey(id: string) {
  const { data } = await api.delete<
    { ok: true; id: string } | { ok: false; error: string }
  >(`/api/configuration/api-keys/${id}`);
  return data;
}

export type FinanceBillingSettings = {
  organizationId: string;
  defaultPaymentTerms: string;
  zeroAmountAutoPaid: boolean;
  offlineReferenceMinLen: number;
  duplicateInvoiceGuard: boolean;
  onlinePaymentsEnabled: boolean;
  paymentRoutingRules: {
    defaultProvider?: "stripe" | "razorpay";
    rules?: Array<{
      currency: string;
      offlineOnlyAbove?: number | null;
      allowedProviders?: Array<"stripe" | "razorpay">;
    }>;
  } | null;
  bankDetails: Record<string, string> | null;
  stripePublishableKey: string | null;
  stripeSecretKeyMasked: string | null;
  stripeWebhookSecretMasked: string | null;
  stripeConfigured: boolean;
  razorpayKeyId: string | null;
  razorpayKeySecretMasked: string | null;
  razorpayWebhookSecretMasked: string | null;
  razorpayConfigured: boolean;
  billingCutoffDay: number;
  renewalWindowDays: number;
  autoRenewDefault: boolean;
  renewalQuoteAutoCreate: boolean;
};

export async function fetchFinanceBillingSettings() {
  const { data } = await api.get<
    | {
        ok: true;
        settings: FinanceBillingSettings;
        webhookUrls: { stripe: string; razorpay: string };
      }
    | { ok: false; error?: string }
  >("/api/configuration/billing");
  if (!data || data.ok === false || !("settings" in data) || !data.settings) {
    throw new Error(
      (data && "error" in data && data.error) ||
        "Failed to load billing settings.",
    );
  }
  return data;
}

export type LeadNurtureSettings = {
  organizationId: string;
  nurtureCallEnabled: boolean;
  nurtureCallDelayMinutes: number;
  ccCoreVoiceConfigured: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
};

export async function fetchLeadNurtureSettings() {
  const { data } = await api.get<
    | { ok: true; settings: LeadNurtureSettings }
    | { ok: false; error?: string }
  >("/api/configuration/nurture");
  if (!data || data.ok === false || !("settings" in data) || !data.settings) {
    throw new Error(
      (data && "error" in data && data.error) ||
        "Failed to load lead nurture settings.",
    );
  }
  return data.settings;
}

export async function patchLeadNurtureSettings(body: {
  nurtureCallEnabled?: boolean;
  nurtureCallDelayMinutes?: number;
}) {
  const { data } = await api.patch<
    | { ok: true; settings: LeadNurtureSettings }
    | { ok: false; error: string }
  >("/api/configuration/nurture", body);
  return data;
}

export async function patchFinanceBillingSettings(body: Record<string, unknown>) {
  const { data } = await api.patch<
    | {
        ok: true;
        settings: FinanceBillingSettings;
        webhookUrls: { stripe: string; razorpay: string };
      }
    | { ok: false; error: string }
  >("/api/configuration/billing", body);
  return data;
}

export type ResearchProviderId =
  | "apollo"
  | "zoominfo"
  | "lusha"
  | "builtwith";

export type ResearchProviderView = {
  provider: ResearchProviderId;
  enabled: boolean;
  configured: boolean;
  apiKeyHint: string | null;
  settings: Record<string, unknown> | null;
  updatedAt: string | null;
  source?: "accounts" | "crm_legacy" | "none";
  needsReauth?: boolean;
  displayName?: string | null;
  accountEmail?: string | null;
};

export type LeadIcpConfig = {
  targetIndustries?: string[];
  adjacentIndustries?: string[];
  sizeTiers?: string[];
  serviceableGeos?: string[];
};

export async function fetchResearchProviders() {
  const { data } = await api.get<
    | {
        ok: true;
        providers: ResearchProviderView[];
        leadIcp: LeadIcpConfig | null;
        competitorStacks: string[];
        canManage: boolean;
      }
    | { ok: false; error?: string }
  >("/api/configuration/research");
  if (!data || data.ok === false) {
    throw new Error(
      (data && "error" in data && data.error) ||
        "Failed to load research providers.",
    );
  }
  return data;
}

export async function patchResearchProvider(body: {
  provider: ResearchProviderId;
  enabled?: boolean;
  apiKey?: string | null;
  clearApiKey?: boolean;
  settings?: Record<string, unknown> | null;
}) {
  const { data } = await api.patch<
    | { ok: true; provider: ResearchProviderView }
    | { ok: false; error: string }
  >("/api/configuration/research/providers", body);
  return data;
}

export async function patchResearchIcp(body: {
  leadIcp?: LeadIcpConfig | null;
  competitorStacks?: string[];
}) {
  const { data } = await api.patch<
    | {
        ok: true;
        leadIcp: LeadIcpConfig | null;
        competitorStacks: string[];
      }
    | { ok: false; error: string }
  >("/api/configuration/research/icp", body);
  return data;
}

/** derived | manual | needs_manual — see backend/src/service/account/internal-domains.ts */
export type InternalDomainsMode = "derived" | "manual" | "needs_manual";

export type InternalDomainsState = {
  organizationId: string;
  domains: string[];
  mode: InternalDomainsMode;
  overrideEmails: string[];
  updatedAt: string | null;
};

export async function fetchInternalDomains() {
  const { data } = await api.get<
    | { ok: true; state: InternalDomainsState; canManage: boolean }
    | { ok: false; error?: string }
  >("/api/configuration/internal-domains");
  if (!data || data.ok === false) {
    throw new Error(
      (data && "error" in data && data.error) ||
        "Failed to load internal domains.",
    );
  }
  return data;
}

export async function patchInternalDomains(body: {
  domains?: string[];
  overrideEmails?: string[];
}) {
  const { data } = await api.patch<
    | { ok: true; state: InternalDomainsState }
    | { ok: false; error: string }
  >("/api/configuration/internal-domains", body);
  return data;
}

export type ProposalCorpusBatchFile = {
  id: string;
  kind: "requirement" | "proposal" | string;
  filename: string;
  status?: string | null;
};

export type ProposalCorpusBatchSummary = {
  id: string;
  name: string | null;
  status: string;
  lastError: string | null;
  itemCount: number;
  playbookCount: number;
  jobStatus: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  files?: ProposalCorpusBatchFile[];
};

export type ProposalPlaybookView = {
  id: string;
  name: string;
  status: string;
  tagsJson: unknown;
  sectionsJson: unknown;
  sourceBatchId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  visualMasterMode?: "none" | "reference";
  format?: {
    coverStyle?: string;
    fontFamily?: string;
    headingFontFamily?: string;
    headingColor?: string;
    accentColor?: string;
    textColor?: string;
    backgroundColor?: string;
    headerBandColor?: string;
    headingAlign?: string;
    headingRule?: string;
    pageCountTypical?: { min?: number; max?: number } | null;
    coverTitle?: string | null;
    coverBrand?: string | null;
    coverSlots?: string[];
    tableHeaderBackground?: string | null;
    tableHeaderColor?: string | null;
    cssComplete?: boolean;
  };
  content?: {
    overallTone?: string;
    pricingShape?: string;
    sectionOrder?: string[];
    sectionTitles?: string[];
    matchTags?: string[];
    tableColumns?: string[];
  slotCount?: number;
  requestedFeatures?: string[];
  };
  sectionLibrary?: unknown;
};

export type ProposalContentPlaybookSummary = {
  id: string | null;
  version: number;
  caseStudyCount: number;
  confidenceLevel: string;
};

export async function fetchProposalCorpusBatches() {
  const { data } = await api.get<
    | {
        ok: true;
        items: ProposalCorpusBatchSummary[];
        contentPlaybook?: ProposalContentPlaybookSummary;
      }
    | { ok: false; error?: string }
  >("/api/configuration/proposal-patterns/batches");
  if (!data || data.ok === false) {
    throw new Error(
      (data && "error" in data && data.error) || "Failed to load batches.",
    );
  }
  return {
    items: data.items,
    contentPlaybook: data.contentPlaybook ?? null,
  };
}

export async function scoreProposalCorpusPair(body: {
  requirement: {
    filename: string;
    contentBase64: string;
    mime?: string | null;
  };
  proposal: {
    filename: string;
    contentBase64: string;
    mime?: string | null;
  };
}) {
  const { data } = await api.post<
    | {
        ok: true;
        confidence: number;
        gaps: string[];
        source: string;
        needsUseAnyway: boolean;
      }
    | { ok: false; error: string }
  >("/api/configuration/proposal-patterns/pair-score", body, {
    timeout: 180_000,
  });
  return data;
}

export async function createProposalCorpusBatch(body: {
  name?: string | null;
  startProcessing?: boolean;
  files?: Array<{
    kind: "requirement" | "proposal";
    filename: string;
    contentBase64: string;
    mime?: string | null;
    pairSlot?: number;
    confidence?: number | null;
    useAnyway?: boolean;
  }>;
  pairs?: Array<{
    pairSlot: number;
    confidence?: number | null;
    useAnyway?: boolean;
    requirement: {
      filename: string;
      contentBase64: string;
      mime?: string | null;
    };
    proposal: {
      filename: string;
      contentBase64: string;
      mime?: string | null;
    };
  }>;
}) {
  const { data } = await api.post<
    | {
        ok: true;
        batchId: string;
        jobId: string | null;
        items: Array<{ id: string; kind: string; filename: string }>;
      }
    | { ok: false; error: string }
  >("/api/configuration/proposal-patterns/batches", body, {
    timeout: 120_000,
  });
  return data;
}

export async function deleteProposalCorpusBatch(id: string) {
  const { data } = await api.delete<
    { ok: true; id: string } | { ok: false; error: string }
  >(`/api/configuration/proposal-patterns/batches/${id}`);
  return data;
}

export async function resetProposalPatterns() {
  const { data } = await api.delete<
    | {
        ok: true;
        deletedBatches: number;
        deletedPlaybooks: number;
      }
    | { ok: false; error: string }
  >("/api/configuration/proposal-patterns");
  return data;
}

export async function processProposalCorpusBatch(id: string) {
  const { data } = await api.post<
    { ok: true; jobId: string } | { ok: false; error: string }
  >(`/api/configuration/proposal-patterns/batches/${id}/process`);
  return data;
}

export async function fetchProposalPlaybooks(status?: string) {
  const { data } = await api.get<
    | { ok: true; items: ProposalPlaybookView[] }
    | { ok: false; error?: string }
  >("/api/configuration/proposal-patterns/playbooks", {
    params: status ? { status } : undefined,
  });
  if (!data || data.ok === false) {
    throw new Error(
      (data && "error" in data && data.error) || "Failed to load playbooks.",
    );
  }
  return data.items;
}

export async function reviewProposalPlaybook(
  id: string,
  body: { action: "approve" | "reject"; name?: string },
) {
  const { data } = await api.post<
    { ok: true; id: string } | { ok: false; error: string }
  >(`/api/configuration/proposal-patterns/playbooks/${id}/review`, body);
  return data;
}

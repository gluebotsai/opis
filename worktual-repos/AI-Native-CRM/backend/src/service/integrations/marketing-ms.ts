/**
 * Marketing / Campaign is a separate microservice (`campaign-ms`) with its own
 * database `campaign_db` (campaigns, forms, attribution, assignment rules).
 *
 * CRM boundary:
 * - Campaign MS owns lead gen + routing.
 * - CRM receives qualified/new leads via webhook → contact in account DB.
 * - Do not store campaigns or marketing assignment queues in crm_qa.
 * - Login users stay in my_account_qa; Campaign MS reads them, never duplicates.
 *
 * Env:
 *   MARKETING_MS_URL      — Campaign API for Marketing nav / embed (list, create)
 *   CAMPAIGN_API_BASE_URL — Nurture personalised-crm API. Default is the live
 *     host https://rebuild-campaign-api.worktual.com (not the Campaign UI host).
 *   CRM_INTEGRATION_KEY   — Monitor/agent POST …/personalised-crm/automation (X-Crm-Integration-Key)
 *   CAMPAIGN_UI_URL       — Campaign UI iframe origin (e.g. http://192.168.11.31:5173)
 *   JWT_ACCESS_SECRET     — shared HS256 secret with Campaign CRM_JWT_ACCESS_SECRET
 *   JWT_ACCESS_TTL_SECONDS — CRM JWT TTL (default 900)
 *   CRM_JWT_ISSUER        — default worktual-crm
 *   MARKETING_MS_TOKEN    — shared secret for inbound webhook verification
 */

import { writeNurtureApiLog } from "@/service/ai/nurture-api-log";

const PROBE_TIMEOUT_MS = 2_500;
const PROBE_CACHE_MS = 30_000;
/** Personalised-crm automation can take 20–40s before 202 on LAN Campaign hosts. */
const AUTOMATION_REQUEST_TIMEOUT_MS = 45_000;

type ProbeCache = {
  apiReachable: boolean;
  uiReachable: boolean;
  checkedAt: number;
};

let probeCache: ProbeCache | null = null;

/** Sync peek of last probe (no network). Used so embed-session stays fast. */
export function peekCampaignProbe(): {
  apiReachable: boolean;
  uiReachable: boolean;
  reachable: boolean;
  stale: boolean;
} | null {
  if (!probeCache) return null;
  const stale = Date.now() - probeCache.checkedAt >= PROBE_CACHE_MS;
  return {
    apiReachable: probeCache.apiReachable,
    uiReachable: probeCache.uiReachable,
    reachable: probeCache.apiReachable && probeCache.uiReachable,
    stale,
  };
}

export function isMarketingMsConfigured(): boolean {
  return Boolean(process.env.MARKETING_MS_URL?.trim());
}

export function marketingMsBaseUrl(): string | null {
  return process.env.MARKETING_MS_URL?.trim() || null;
}

/** Live Campaign REST host for nurture. Not the Campaign UI host. */
const LIVE_CAMPAIGN_API_BASE_URL = "https://rebuild-campaign-api.worktual.com";

/** Personalised CRM + nurture outbound. Unset uses the live API, not the LAN host. */
export function campaignApiBaseUrl(): string | null {
  const dedicated =
    process.env.CAMPAIGN_API_BASE_URL?.trim()?.replace(/\/$/, "") ?? "";
  if (dedicated) return dedicated;
  return LIVE_CAMPAIGN_API_BASE_URL;
}

export function campaignUiBaseUrl(): string | null {
  const uiUrl = process.env.CAMPAIGN_UI_URL?.trim()?.replace(/\/$/, "") ?? null;
  const proxyTarget =
    process.env.CAMPAIGN_PROXY_TARGET?.trim()?.replace(/\/$/, "") ?? null;

  // LAN dev may set CAMPAIGN_UI_URL to CRM /campaign-proxy for docs, but Vite
  // subpath proxy cannot rewrite Campaign absolute asset paths — iframe must
  // load the Campaign host directly (Campaign sets frame-ancestors for CRM).
  if (uiUrl?.includes("/campaign-proxy")) {
    return proxyTarget ?? null;
  }

  return uiUrl ?? proxyTarget;
}

export function isCampaignConnectConfigured(): boolean {
  return Boolean(
    marketingMsBaseUrl() &&
      campaignUiBaseUrl() &&
      process.env.JWT_ACCESS_SECRET?.trim(),
  );
}

export function crmIntegrationKey(): string | null {
  return process.env.CRM_INTEGRATION_KEY?.trim() || null;
}

/** Nurture / agents: integration key + org in body (no user JWT). */
export function isCampaignAutomationConfigured(): boolean {
  return Boolean(campaignApiBaseUrl() && crmIntegrationKey());
}

/** Server-side Campaign personalised-crm (automation and/or user JWT fallback). */
export function isCampaignApiConfigured(): boolean {
  return Boolean(
    campaignApiBaseUrl() &&
      (crmIntegrationKey() || process.env.JWT_ACCESS_SECRET?.trim()),
  );
}

/** Verify inbound webhook from Marketing MS (shared secret). */
export function verifyMarketingWebhookHeaders(headers: {
  authorization?: string | null;
  "x-marketing-token"?: string | null;
}): boolean {
  const expected = process.env.MARKETING_MS_TOKEN?.trim();
  if (!expected) return true; // open in local/dev when unset
  const auth = headers.authorization ?? null;
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const header = headers["x-marketing-token"] ?? null;
  return bearer === expected || header === expected;
}

/** Verify inbound webhook from Marketing MS (Fetch Request). */
export function verifyMarketingWebhookSecret(request: Request): boolean {
  return verifyMarketingWebhookHeaders({
    authorization: request.headers.get("authorization"),
    "x-marketing-token": request.headers.get("x-marketing-token"),
  });
}

async function probeUrl(
  url: string,
  method: "GET" | "HEAD" = "GET",
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    });
    return res.ok || res.status === 401 || res.status === 403;
  } catch {
    return false;
  }
}

export async function probeCampaignReachability(force = false): Promise<{
  apiReachable: boolean;
  uiReachable: boolean;
  reachable: boolean;
}> {
  const now = Date.now();
  if (
    !force &&
    probeCache &&
    now - probeCache.checkedAt < PROBE_CACHE_MS
  ) {
    return {
      apiReachable: probeCache.apiReachable,
      uiReachable: probeCache.uiReachable,
      reachable: probeCache.apiReachable && probeCache.uiReachable,
    };
  }

  const apiBase = marketingMsBaseUrl()?.replace(/\/$/, "");
  const uiBase = campaignUiBaseUrl()?.replace(/\/$/, "");

  const [apiReachable, uiReachable] = await Promise.all([
    apiBase ? probeUrl(`${apiBase}/health`) : Promise.resolve(false),
    uiBase ? probeUrl(uiBase, "HEAD") : Promise.resolve(false),
  ]);

  probeCache = {
    apiReachable,
    uiReachable,
    checkedAt: now,
  };

  return {
    apiReachable,
    uiReachable,
    reachable: apiReachable && uiReachable,
  };
}

export type CampaignApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

async function fetchCampaignIntegrationApi<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    baseUrl?: string | null;
  },
): Promise<CampaignApiResult<T>> {
  const base = (options.baseUrl ?? campaignApiBaseUrl())?.replace(/\/$/, "");
  const key = crmIntegrationKey();
  const url = base
    ? `${base}${path.startsWith("/") ? path : `/${path}`}`
    : `campaign://not-configured${path.startsWith("/") ? path : `/${path}`}`;
  const organizationId =
    typeof options.body?.organization_id === "string"
      ? options.body.organization_id
      : null;
  const contactId =
    typeof options.body?.contact_id === "string"
      ? options.body.contact_id
      : typeof options.body?.cdp_id === "string"
        ? options.body.cdp_id
        : null;
  const startedAt = performance.now();

  const writeLog = (input: {
    response: unknown;
    status: number | null;
    ok: boolean;
    error?: string | null;
  }) =>
    writeNurtureApiLog({
      nurtureKind: "email",
      service: "campaign",
      operation: "personalised-crm-automation",
      method: options.method ?? "POST",
      url,
      request: options.body,
      response: input.response,
      status: input.status,
      ok: input.ok,
      durationMs: Math.round(performance.now() - startedAt),
      organizationId,
      contactId,
      error: input.error,
    });

  if (!base) {
    writeLog({
      response: null,
      status: 503,
      ok: false,
      error: "Campaign MS is not configured.",
    });
    return { ok: false, error: "Campaign MS is not configured.", status: 503 };
  }
  if (!key) {
    writeLog({
      response: null,
      status: 503,
      ok: false,
      error: "CRM_INTEGRATION_KEY is not configured.",
    });
    return {
      ok: false,
      error: "CRM_INTEGRATION_KEY is not configured.",
      status: 503,
    };
  }

  try {
    const res = await fetch(url, {
      method: options.method ?? "POST",
      headers: {
        Accept: "application/json",
        "X-Crm-Integration-Key": key,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(AUTOMATION_REQUEST_TIMEOUT_MS),
    });

    const text = await res.text().catch(() => "");
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const message =
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof (data as { message?: unknown }).message === "string"
          ? (data as { message: string }).message
          : `Campaign MS HTTP ${res.status}`;
      console.error("campaign ms automation request failed", {
        path,
        status: res.status,
        message,
      });
      writeLog({
        response: data ?? text,
        status: res.status,
        ok: false,
        error: message,
      });
      return { ok: false, error: message, status: res.status };
    }

    writeLog({
      response: data ?? text,
      status: res.status,
      ok: true,
    });
    return { ok: true, data: (data ?? ({} as T)), status: res.status };
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Campaign MS unreachable";
    console.error("campaign ms automation request error", {
      path,
      error,
    });
    writeLog({
      response: null,
      status: null,
      ok: false,
      error,
    });
    return {
      ok: false,
      error,
      status: 503,
    };
  }
}

async function fetchCampaignApi<T>(
  path: string,
  options: {
    jwt: string;
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    /** Default MARKETING_MS_URL; personalised-crm passes campaignApiBaseUrl(). */
    baseUrl?: string | null;
  },
): Promise<CampaignApiResult<T>> {
  const base = (options.baseUrl ?? marketingMsBaseUrl())?.replace(/\/$/, "");
  if (!base) {
    return { ok: false, error: "Campaign MS is not configured.", status: 503 };
  }

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.jwt}`,
    Accept: "application/json",
  };

  try {
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        ...headers,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const message =
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof (data as { message?: unknown }).message === "string"
          ? (data as { message: string }).message
          : `Campaign MS HTTP ${res.status}`;
      console.error("campaign ms request failed", {
        path,
        status: res.status,
        message,
      });
      return { ok: false, error: message, status: res.status };
    }

    return { ok: true, data: (data ?? ({} as T)), status: res.status };
  } catch (err) {
    console.error("campaign ms request error", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Campaign MS unreachable",
      status: 503,
    };
  }
}

export type CampaignListItem = Record<string, unknown>;

export async function listCampaigns(
  jwt: string,
  bucket: string,
): Promise<
  CampaignApiResult<{ getCampaignDetails?: CampaignListItem[]; campaigns?: CampaignListItem[] }>
> {
  const normalized = bucket.trim() || "all";
  return fetchCampaignApi(
    `/api/campaigns?bucket=${encodeURIComponent(normalized)}`,
    { jwt },
  );
}

export type CreateCampaignBody = {
  name: string;
  description?: string | null;
  goal?: string | null;
  objective?: string | null;
  status?: string;
  startsAt?: string | null;
  endsAt?: string | null;
};

export async function createCampaign(
  jwt: string,
  body: CreateCampaignBody,
): Promise<CampaignApiResult<{ id?: string | number }>> {
  return fetchCampaignApi("/api/campaigns", {
    jwt,
    method: "POST",
    body: {
      name: body.name,
      description: body.description ?? null,
      goal: body.goal ?? null,
      objective: body.objective ?? null,
      status: body.status ?? "draft",
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
    },
  });
}

export type PersonalisedCrmAudiencePerson = {
  email?: string | null;
  phone?: string | null;
  contact_id?: string | null;
  customer_id?: string | null;
  id?: string | null;
};

export type CreatePersonalisedCrmBody = {
  name?: string | null;
  brief: string;
  goal?: string | null;
  objective?: string | null;
  channels: string[];
  people?: PersonalisedCrmAudiencePerson[];
  contact_ids?: string[];
  emails?: string[];
  phones?: string[];
  send_at?: string | null;
  timezone?: string | null;
};

export type CreatePersonalisedCrmAutomationBody = CreatePersonalisedCrmBody & {
  organization_id: string;
  acting_user_id?: string | null;
};

function buildPersonalisedCrmPayload(
  body: CreatePersonalisedCrmBody,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: body.name?.trim() || undefined,
    brief: body.brief.trim(),
    goal: body.goal?.trim() || undefined,
    objective: body.objective?.trim() || undefined,
    channels: body.channels,
  };
  if (body.people?.length) payload.people = body.people;
  if (body.contact_ids?.length) payload.contact_ids = body.contact_ids;
  if (body.emails?.length) payload.emails = body.emails;
  if (body.phones?.length) payload.phones = body.phones;
  if (body.send_at != null && String(body.send_at).trim() !== "") {
    payload.send_at = body.send_at;
  }
  if (body.timezone?.trim()) payload.timezone = body.timezone.trim();
  return payload;
}

function normalizePersonalisedCrmAccepted(
  result: CampaignApiResult<PersonalisedCrmAccepted>,
): CampaignApiResult<PersonalisedCrmAccepted> {
  if (!result.ok || result.status !== 202) {
    return result;
  }
  const data = result.data ?? {};
  const runIdRaw = data.run_id ?? (data as { runId?: unknown }).runId;
  const runId =
    runIdRaw == null || runIdRaw === ""
      ? undefined
      : typeof runIdRaw === "string" || typeof runIdRaw === "number"
        ? runIdRaw
        : String(runIdRaw);
  return {
    ok: true,
    status: 202,
    data: { ...data, run_id: runId },
  };
}

export type PersonalisedCrmAccepted = {
  run_id?: string | number;
  status?: string;
  send_at?: string | null;
  timezone?: string | null;
  channels?: string[];
  audience_count?: number;
  warnings?: string[];
  message?: string;
  statusCode?: number;
};

export type PersonalisedCrmRun = {
  id: string;
  title: string;
  status: string | null;
  channels: string[];
  sendAt: string | null;
};

export type PersonalisedCrmRecipientChannel = {
  channel: string;
  outcome: string | null;
  opened: boolean;
  clicked: boolean;
  sentAt: string | null;
};

export type PersonalisedCrmRecipient = {
  contactId: string | null;
  email: string | null;
  channels: PersonalisedCrmRecipientChannel[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["runs", "campaigns", "items", "data", "recipients"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function textField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function boolField(row: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = row[key];
    if (value === true || value === 1 || value === "true") return true;
  }
  return false;
}

export function parsePersonalisedCrmRuns(payload: unknown): PersonalisedCrmRun[] {
  return asList(payload).flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const id = textField(row, ["id", "run_id", "runId", "campaign_id"]);
    if (!id) return [];
    const channels = Array.isArray(row.channels)
      ? row.channels.map((channel) => String(channel).trim()).filter(Boolean)
      : [];
    return [
      {
        id,
        title: textField(row, ["title", "name"]) ?? "Campaign",
        status: textField(row, ["status"]),
        channels,
        sendAt: textField(row, ["sendAt", "send_at", "sentAt", "sent_at", "createdAt"]),
      },
    ];
  });
}

export function parsePersonalisedCrmRecipients(
  payload: unknown,
): PersonalisedCrmRecipient[] {
  return asList(payload).flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const channelRows = Array.isArray(row.channels) ? row.channels : [];
    const channels = channelRows.flatMap((channel) => {
      const entry = asRecord(channel);
      if (!entry) return [];
      const name = textField(entry, ["channel"]) ?? "email";
      return [
        {
          channel: name,
          outcome: textField(entry, ["outcome", "status"]),
          opened: boolField(entry, ["opened"]) || Boolean(textField(entry, ["opened_at", "openedAt"])),
          clicked: boolField(entry, ["clicked"]) || Boolean(textField(entry, ["clicked_at", "clickedAt"])),
          sentAt: textField(entry, ["sent_at", "sentAt"]),
        },
      ];
    });
    return [
      {
        contactId: textField(row, ["contact_id", "contactId", "customer_id", "customerId"]),
        email: textField(row, ["email"]),
        channels,
      },
    ];
  });
}

export async function listPersonalisedCrmRuns(
  jwt: string,
): Promise<CampaignApiResult<PersonalisedCrmRun[]>> {
  const result = await fetchCampaignApi<unknown>("/api/campaigns/personalised-crm", {
    jwt,
    baseUrl: campaignApiBaseUrl(),
  });
  if (!result.ok) return result;
  return { ok: true, data: parsePersonalisedCrmRuns(result.data), status: result.status };
}

export async function listPersonalisedCrmRecipients(
  jwt: string,
  runId: string,
): Promise<CampaignApiResult<PersonalisedCrmRecipient[]>> {
  const id = encodeURIComponent(runId);
  const result = await fetchCampaignApi<unknown>(
    `/api/campaigns/personalised-crm/${id}/recipients?limit=500`,
    { jwt, baseUrl: campaignApiBaseUrl() },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: parsePersonalisedCrmRecipients(result.data),
    status: result.status,
  };
}

export async function createPersonalisedCrmRun(
  jwt: string,
  body: CreatePersonalisedCrmBody,
): Promise<CampaignApiResult<PersonalisedCrmAccepted>> {
  const result = await fetchCampaignApi<PersonalisedCrmAccepted>(
    "/api/campaigns/personalised-crm",
    {
      jwt,
      method: "POST",
      body: buildPersonalisedCrmPayload(body),
      baseUrl: campaignApiBaseUrl(),
    },
  );

  return normalizePersonalisedCrmAccepted(result);
}

/** CRM monitor/agent — no user JWT; org in body. */
export async function createPersonalisedCrmAutomationRun(
  body: CreatePersonalisedCrmAutomationBody,
): Promise<CampaignApiResult<PersonalisedCrmAccepted>> {
  const orgId = body.organization_id?.trim();
  if (!orgId) {
    return { ok: false, error: "organization_id is required.", status: 400 };
  }

  const payload = buildPersonalisedCrmPayload(body);
  payload.organization_id = orgId;
  const acting = body.acting_user_id?.trim();
  if (acting) payload.acting_user_id = acting;

  const result = await fetchCampaignIntegrationApi<PersonalisedCrmAccepted>(
    "/api/campaigns/personalised-crm/automation",
    {
      method: "POST",
      body: payload,
      baseUrl: campaignApiBaseUrl(),
    },
  );

  return normalizePersonalisedCrmAccepted(result);
}

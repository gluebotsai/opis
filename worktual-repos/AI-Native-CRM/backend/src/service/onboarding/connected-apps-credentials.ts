import {
  isOnboardingConnectorsConfigured,
  onboardingInternalBaseUrl,
  productMcpConnectorsToken,
} from "@/service/onboarding/connected-apps-config";

export type OnboardingConnectedAppCredentials = {
  organizationId: string;
  appKey: string;
  provider: string | null;
  name: string | null;
  accountEmail: string | null;
  externalAccountId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenType: string | null;
  expiresAt: Date | null;
  scopes: string | null;
  mcpUrl: string | null;
  oauthClientId: string | null;
  authMode: string | null;
  metadata: Record<string, unknown> | null;
  status: string | null;
  connectionKind: string | null;
};

type OnboardingCredentialsBody = {
  organizationId?: string;
  appKey?: string;
  provider?: string;
  name?: string;
  accountEmail?: string;
  externalAccountId?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  scopes?: string;
  mcpUrl?: string;
  oauthClientId?: string;
  authMode?: string;
  metadata?: Record<string, unknown>;
  status?: string;
  connectionKind?: string;
};

type OnboardingSuccessResponse = {
  statusCode?: number;
  message?: string;
  credentials?: OnboardingCredentialsBody;
};

export class OnboardingConnectorsNotConfiguredError extends Error {
  constructor() {
    super(
      "Onboarding connectors API is not configured (PRODUCT_MCP_CONNECTORS_TOKEN).",
    );
    this.name = "OnboardingConnectorsNotConfiguredError";
  }
}

function mapCredentials(
  raw: OnboardingCredentialsBody,
  organizationId: string,
  appKey: string,
): OnboardingConnectedAppCredentials {
  return {
    organizationId: raw.organizationId?.trim() || organizationId,
    appKey: raw.appKey?.trim() || appKey,
    provider: raw.provider?.trim() || null,
    name: raw.name?.trim() || null,
    accountEmail: raw.accountEmail?.trim() || null,
    externalAccountId: raw.externalAccountId?.trim() || null,
    accessToken: raw.accessToken?.trim() || null,
    refreshToken: raw.refreshToken?.trim() || null,
    tokenType: raw.tokenType?.trim() || null,
    expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null,
    scopes: raw.scopes?.trim() || null,
    mcpUrl: raw.mcpUrl?.trim() || null,
    oauthClientId: raw.oauthClientId?.trim() || null,
    authMode: raw.authMode?.trim() || null,
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? raw.metadata
        : null,
    status: raw.status?.trim() || "active",
    connectionKind: raw.connectionKind?.trim() || null,
  };
}

/**
 * GET /api/v1/internal/connected-apps/{app_key}/credentials?organization_id={id}
 */
export async function fetchConnectedAppCredentials(
  organizationId: string,
  appKey: string,
): Promise<OnboardingConnectedAppCredentials | null> {
  if (!isOnboardingConnectorsConfigured()) {
    throw new OnboardingConnectorsNotConfiguredError();
  }
  const orgId = organizationId?.trim();
  const key = appKey?.trim();
  if (!orgId || !key) return null;

  const url = new URL(
    `${onboardingInternalBaseUrl()}/api/v1/internal/connected-apps/${encodeURIComponent(key)}/credentials`,
  );
  url.searchParams.set("organization_id", orgId);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${productMcpConnectorsToken()}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(25_000),
  });

  const text = await res.text();
  let body: OnboardingSuccessResponse | { statusCode?: number; message?: string } =
    {};
  if (text) {
    try {
      body = JSON.parse(text) as OnboardingSuccessResponse;
    } catch {
      body = {};
    }
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    const detail =
      typeof body.message === "string"
        ? body.message
        : text.slice(0, 300) || res.statusText;
    throw new Error(
      `Onboarding connected-apps credentials failed (${res.status}): ${detail}`,
    );
  }

  const creds = body.credentials;
  if (!creds?.accessToken?.trim()) return null;
  return mapCredentials(creds, orgId, key);
}

/** Try app keys in order (e.g. semrush aliases) until one returns credentials. */
export async function fetchConnectedAppCredentialsFirst(
  organizationId: string,
  appKeys: readonly string[],
): Promise<OnboardingConnectedAppCredentials | null> {
  for (const key of appKeys) {
    const hit = await fetchConnectedAppCredentials(organizationId, key);
    if (hit) return hit;
  }
  return null;
}

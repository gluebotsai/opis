/** Worktual ZoomInfo gateway — CRM never holds ZoomInfo OAuth/MCP secrets. */

export const ZOOMINFO_GATEWAY_API_KEY = "__gateway__";
export const ZOOMINFO_APP_KEY = "zoominfo";

export function zoominfoGatewayBaseUrl(): string {
  return (
    process.env.ZOOMINFO_GATEWAY_URL?.trim() ||
    "http://173.234.75.165:8199"
  ).replace(/\/$/, "");
}

export function zoominfoGatewayToken(): string {
  return process.env.ZOOMINFO_GATEWAY_TOKEN?.trim() || "";
}

export function isZoominfoGatewayConfigured(): boolean {
  return Boolean(zoominfoGatewayToken());
}

export type ZoominfoGatewayError = {
  code: string;
  message: string;
  requestId?: string | null;
  status: number;
};

export class ZoominfoGatewayRequestError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly status: number;

  constructor(err: ZoominfoGatewayError) {
    super(err.message);
    this.name = "ZoominfoGatewayRequestError";
    this.code = err.code;
    this.requestId = err.requestId ?? null;
    this.status = err.status;
  }
}

type GatewaySuccess = {
  success?: boolean;
  request_id?: string;
  data?: unknown;
  tools?: unknown;
  error?: { code?: string; message?: string };
};

async function gatewayPost(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string | null,
): Promise<GatewaySuccess> {
  if (!isZoominfoGatewayConfigured()) {
    throw new ZoominfoGatewayRequestError({
      code: "GATEWAY_NOT_CONFIGURED",
      message: "ZOOMINFO_GATEWAY_TOKEN is not configured",
      status: 503,
    });
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${zoominfoGatewayToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (idempotencyKey?.trim()) {
    headers["Idempotency-Key"] = idempotencyKey.trim();
  }
  const res = await fetch(`${zoominfoGatewayBaseUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let payload: GatewaySuccess = {};
  if (text) {
    try {
      payload = JSON.parse(text) as GatewaySuccess;
    } catch {
      payload = { success: false, error: { message: text.slice(0, 400) } };
    }
  }
  if (!res.ok || payload.success === false) {
    const code = payload.error?.code || `HTTP_${res.status}`;
    const message =
      payload.error?.message || text.slice(0, 300) || res.statusText;
    throw new ZoominfoGatewayRequestError({
      code,
      message,
      requestId: payload.request_id ?? null,
      status: res.status,
    });
  }
  return payload;
}

export async function listZoominfoGatewayTools(
  organizationId: string,
): Promise<Array<{ name?: string; description?: string; units_per_call?: number }>> {
  const org = organizationId?.trim();
  if (!org || !isZoominfoGatewayConfigured()) return [];
  try {
    const payload = await gatewayPost("/v1/zoominfo/tools/list", {
      organizationId: org,
      appKey: ZOOMINFO_APP_KEY,
    });
    return Array.isArray(payload.tools)
      ? (payload.tools as Array<{
          name?: string;
          description?: string;
          units_per_call?: number;
        }>)
      : [];
  } catch (err) {
    if (
      err instanceof ZoominfoGatewayRequestError &&
      (err.code === "CONNECTED_APP_NOT_FOUND" ||
        err.code === "CONNECTED_APP_NEEDS_REAUTH")
    ) {
      return [];
    }
    throw err;
  }
}

export async function callZoominfoGatewayTool(input: {
  organizationId: string;
  toolName: "search_contacts" | "enrich_contacts" | string;
  parameters: Record<string, unknown>;
  idempotencyKey?: string | null;
}): Promise<{ requestId: string | null; data: Record<string, unknown> }> {
  const org = input.organizationId?.trim();
  if (!org) {
    throw new ZoominfoGatewayRequestError({
      code: "INVALID_ORGANIZATION",
      message: "organizationId is required",
      status: 400,
    });
  }
  const payload = await gatewayPost(
    "/v1/zoominfo/tools/call",
    {
      organizationId: org,
      appKey: ZOOMINFO_APP_KEY,
      toolName: input.toolName,
      parameters: input.parameters,
    },
    input.idempotencyKey,
  );
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : { raw: payload.data };
  return { requestId: payload.request_id ?? null, data };
}

export function isZoominfoOrgSkipError(err: unknown): boolean {
  if (!(err instanceof ZoominfoGatewayRequestError)) return false;
  return (
    err.code === "CONNECTED_APP_NOT_FOUND" ||
    err.code === "CONNECTED_APP_NEEDS_REAUTH" ||
    err.code === "INVALID_ORGANIZATION"
  );
}

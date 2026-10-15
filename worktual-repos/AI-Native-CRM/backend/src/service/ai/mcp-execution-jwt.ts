import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const MCP_POLICY_VERSION = "crm-modules-v1";

type McpExecutionScope = {
  agentName: string;
  executionMode: string;
  businessType: string;
  module: string;
  surface: string;
  organizationId: string;
  actorId: string;
  role: string;
  runId?: string;
  traceId?: string;
  idempotencyKey?: string;
  allowedTools?: string[];
};

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** Issue a short-lived server-to-server token. Never return this to the browser. */
export function issueMcpExecutionJwt(
  scope: McpExecutionScope,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const secret = process.env.MCP_EXECUTION_JWT_SECRET?.trim();
  if (!secret) return null;
  const configuredTtl = Number(process.env.MCP_EXECUTION_JWT_TTL_SECONDS || 60);
  const ttl = Number.isFinite(configuredTtl)
    ? Math.min(120, Math.max(15, configuredTtl))
    : 60;
  const payload = {
    iss: process.env.MCP_EXECUTION_JWT_ISSUER?.trim() || "worktual-crm-api",
    aud: process.env.MCP_EXECUTION_JWT_AUDIENCE?.trim() || "worktual-crm-mcp",
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    jti: randomUUID(),
    agentName: scope.agentName,
    executionMode: scope.executionMode,
    businessType: scope.businessType,
    module: scope.module,
    surface: scope.surface,
    policyVersion:
      process.env.MCP_POLICY_VERSION?.trim() || MCP_POLICY_VERSION,
    organizationId: scope.organizationId,
    actorId: scope.actorId,
    role: scope.role,
    runId: scope.runId || randomUUID(),
    traceId: scope.traceId || randomUUID(),
    idempotencyKey: scope.idempotencyKey || randomUUID(),
    ...(scope.allowedTools ? { allowedTools: scope.allowedTools } : {}),
  };
  const encodedHeader = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

export function mcpScopeFromAgentBody(
  agentName: string,
  body: Record<string, unknown>,
): McpExecutionScope | null {
  const context =
    body.context && typeof body.context === "object"
      ? (body.context as Record<string, unknown>)
      : {};
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const scope: McpExecutionScope = {
    agentName,
    executionMode: text(body.executionMode) || "legacy",
    businessType: text(body.businessType) || text(context.businessType),
    module: text(context.module),
    surface: text(context.surface) || "list",
    organizationId: text(body.organizationId) || text(context.organizationId),
    actorId: text(body.actingUserId) || text(context.actingUserId),
    role: text(body.role) || text(context.role),
    runId: text(body.runId),
    traceId: text(body.traceId),
    idempotencyKey: text(body.idempotencyKey),
  };
  return [
    scope.agentName,
    scope.executionMode,
    scope.businessType,
    scope.module,
    scope.surface,
    scope.organizationId,
    scope.actorId,
    scope.role,
  ].every(Boolean)
    ? scope
    : null;
}

export type VerifiedMcpExecutionClaims = McpExecutionScope & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  policyVersion: string;
  runId: string;
  traceId: string;
  idempotencyKey: string;
};

export function verifyMcpExecutionJwt(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedMcpExecutionClaims | null {
  const secret = process.env.MCP_EXECUTION_JWT_SECRET?.trim();
  if (!secret) return null;
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) return null;
  try {
    const parsedHeader = JSON.parse(
      Buffer.from(header, "base64url").toString("utf8"),
    ) as { alg?: string; typ?: string };
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as VerifiedMcpExecutionClaims;
    const issuer =
      process.env.MCP_EXECUTION_JWT_ISSUER?.trim() || "worktual-crm-api";
    const audience =
      process.env.MCP_EXECUTION_JWT_AUDIENCE?.trim() || "worktual-crm-mcp";
    if (
      claims.iss !== issuer ||
      claims.aud !== audience ||
      claims.exp <= nowSeconds ||
      typeof claims.iat !== "number" ||
      claims.iat > nowSeconds + 5 ||
      claims.policyVersion !==
        (process.env.MCP_POLICY_VERSION?.trim() || MCP_POLICY_VERSION)
    ) {
      return null;
    }
    const required = [
      claims.jti,
      claims.agentName,
      claims.executionMode,
      claims.businessType,
      claims.module,
      claims.surface,
      claims.organizationId,
      claims.actorId,
      claims.role,
      claims.runId,
      claims.traceId,
      claims.idempotencyKey,
    ];
    return required.every((value) => typeof value === "string" && value.length > 0)
      ? claims
      : null;
  } catch {
    return null;
  }
}

/**
 * Mint short-lived MCP execution JWTs for the AI service tool loop.
 * Claims: tenant, actor, role, module, surface, runId, allowed tools.
 */
import crypto from "crypto";

export type McpTokenClaims = {
  organizationId: string;
  actorId: string;
  role: string;
  module?: string | null;
  surface?: string | null;
  runId?: string | null;
  allowedTools?: string[];
  ttlSeconds?: number;
};

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function mcpSecret(): string {
  return (
    process.env.MCP_EXECUTION_JWT_SECRET ||
    process.env.COWORKER_TASKS_SECRET ||
    "worktual-tasks-dev-secret"
  );
}

export function issueMcpExecutionToken(claims: McpTokenClaims): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(30, Number(claims.ttlSeconds || 300));
  const payload = {
    iss: "ticketing-express",
    aud: "ticketing-mcp",
    iat: now,
    exp: now + ttl,
    organization_id: claims.organizationId,
    actor_id: claims.actorId,
    role: claims.role,
    module: claims.module || null,
    surface: claims.surface || null,
    run_id: claims.runId || null,
    allowed_tools: claims.allowedTools || [],
    route_mode: "delegation",
  };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto
    .createHmac("sha256", mcpSecret())
    .update(body)
    .digest();
  return `${body}.${b64url(sig)}`;
}

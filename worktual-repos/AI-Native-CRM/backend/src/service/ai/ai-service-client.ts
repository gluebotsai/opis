/**
 * Call the Python native-orchestrator ai-service. All CRM agents prefer this path;
 * TS heuristics remain only as offline fallback when the service is down.
 *
 * Timeouts: slow models can exceed 2 minutes for a single completion.
 * Callers may pass timeoutMs; values are clamped to AI_SERVICE_MAX_TIMEOUT_MS.
 */
import {
  issueMcpExecutionJwt,
  mcpScopeFromAgentBody,
} from "@/service/ai/mcp-execution-jwt";
import { randomUUID } from "node:crypto";
import { writeNurtureApiLog } from "@/service/ai/nurture-api-log";

/** Interactive coworker / draft turns (tool loop). */
export const AI_SERVICE_DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Proactive job agents (score / summarize / lifecycle / nurture / miss / briefs).
 * Allows one slow LLM turn (>120s) plus a short immediate retry / overhead.
 */
export const AI_SERVICE_JOB_TIMEOUT_MS = 210_000;

/** Absolute ceiling — never wait forever on a hung LLM. */
export const AI_SERVICE_MAX_TIMEOUT_MS = 240_000;

export function clampAiServiceTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return AI_SERVICE_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(5_000, Math.trunc(timeoutMs)),
    AI_SERVICE_MAX_TIMEOUT_MS,
  );
}

export async function callAiServiceAgent<T = Record<string, unknown>>(
  agent: string,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number; signal?: AbortSignal; traceparent?: string },
): Promise<T | null> {
  const base = process.env.AI_SERVICE_BASE_URL?.trim().replace(/\/$/, "");
  const isNurture = agent === "nurture-lead";
  const endpoint = base
    ? `${base}/ai/v1/agents/${agent}/run`
    : `ai-service://not-configured/ai/v1/agents/${agent}/run`;
  if (!base) {
    if (isNurture) {
      writeNurtureApiLog({
        nurtureKind: "compose",
        service: "ai-service",
        operation: "nurture-lead",
        method: "POST",
        url: endpoint,
        request: body,
        response: null,
        status: null,
        ok: false,
        organizationId:
          typeof body.organizationId === "string" ? body.organizationId : null,
        contactId:
          typeof body.contactId === "string" ? body.contactId : null,
        error: "AI_SERVICE_BASE_URL is not configured",
      });
    }
    return null;
  }

  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";

  const timeoutMs = clampAiServiceTimeoutMs(
    options?.timeoutMs ?? AI_SERVICE_DEFAULT_TIMEOUT_MS,
  );
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const candidateTraceId = text(body.traceId)?.replaceAll("-", "").toLowerCase();
  const traceId =
    candidateTraceId && /^[0-9a-f]{32}$/.test(candidateTraceId)
      ? candidateTraceId
      : randomUUID().replaceAll("-", "");
  const runId = text(body.runId) ?? `run-${randomUUID()}`;
  const conversationId =
    text(body.conversationId) ?? `conversation-${randomUUID()}`;
  const idempotencyKey = text(body.idempotencyKey) ?? runId;
  const traceparent =
    options?.traceparent ??
    `00-${traceId}-${randomUUID().replaceAll("-", "").slice(0, 16)}-01`;
  const correlatedBody: Record<string, unknown> = {
    ...body,
    conversationId,
    runId,
    traceId,
    traceparent,
    idempotencyKey,
  };

  const isProactive = !["crm-agent", "hello", "chat"].includes(agent);
  const callStart = performance.now();
  try {
    const mcpScope = mcpScopeFromAgentBody(agent, correlatedBody);
    const mcpExecutionToken = mcpScope
      ? issueMcpExecutionJwt(mcpScope)
      : null;
    const requestBody =
      mcpExecutionToken && correlatedBody.mcpExecutionToken == null
        ? { ...correlatedBody, mcpExecutionToken }
        : correlatedBody;

    if (isProactive) {
      import("@/helpers/agent-trace.js")
        .then(({ agentTrace }) =>
          agentTrace("proactive", {
            agent,
            step: "dispatch",
            contactId: body.contactId,
            organizationId: body.organizationId,
            traceId,
          }),
        )
        .catch(() => {});
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-internal-secret": secret } : {}),
        traceparent,
      },
      body: JSON.stringify(requestBody),
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`ai-service ${agent} failed`, res.status, errBody);
      if (isNurture) {
        writeNurtureApiLog({
          nurtureKind: "compose",
          service: "ai-service",
          operation: "nurture-lead",
          method: "POST",
          url: endpoint,
          request: correlatedBody,
          response: errBody,
          status: res.status,
          ok: false,
          durationMs: Math.round(performance.now() - callStart),
          organizationId:
            typeof body.organizationId === "string"
              ? body.organizationId
              : null,
          contactId:
            typeof body.contactId === "string" ? body.contactId : null,
          error: `ai_service_http_${res.status}`,
        });
      }
      if (isProactive) {
        import("@/helpers/agent-trace.js")
          .then(({ agentTrace }) =>
            agentTrace("proactive", {
              agent,
              step: "finish",
              ok: false,
              ms: Math.round(performance.now() - callStart),
              status: res.status,
              error: errBody.slice(0, 400),
              traceId,
            }),
          )
          .catch(() => {});
      }
      return null;
    }
    const data = (await res.json()) as T;
    if (isNurture) {
      writeNurtureApiLog({
        nurtureKind: "compose",
        service: "ai-service",
        operation: "nurture-lead",
        method: "POST",
        url: endpoint,
        request: correlatedBody,
        response: data,
        status: res.status,
        ok: true,
        durationMs: Math.round(performance.now() - callStart),
        organizationId:
          typeof body.organizationId === "string" ? body.organizationId : null,
        contactId:
          typeof body.contactId === "string" ? body.contactId : null,
      });
    }
    if (isProactive) {
      import("@/helpers/agent-trace.js")
        .then(({ agentTrace }) =>
          agentTrace("proactive", {
            agent,
            step: "finish",
            ok: true,
            ms: Math.round(performance.now() - callStart),
            traceId,
          }),
        )
        .catch(() => {});
    }
    return (
      data && typeof data === "object"
        ? {
            ...data,
            conversationId,
            runId,
            traceId,
            idempotencyKey,
            traceparent,
          }
        : data
    ) as T;
  } catch (err) {
    console.error(`ai-service ${agent} error`, err);
    if (isNurture) {
      writeNurtureApiLog({
        nurtureKind: "compose",
        service: "ai-service",
        operation: "nurture-lead",
        method: "POST",
        url: endpoint,
        request: correlatedBody,
        response: null,
        status: null,
        ok: false,
        durationMs: Math.round(performance.now() - callStart),
        organizationId:
          typeof body.organizationId === "string" ? body.organizationId : null,
        contactId:
          typeof body.contactId === "string" ? body.contactId : null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (isProactive) {
      import("@/helpers/agent-trace.js")
        .then(({ agentTrace }) =>
          agentTrace("proactive", {
            agent,
            step: "finish",
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            traceId,
          }),
        )
        .catch(() => {});
    }
    return null;
  }
}

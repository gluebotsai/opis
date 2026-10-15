import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";

export type ExecutionIds = {
  conversationId: string;
  runId: string;
  traceId: string;
  idempotencyKey: string;
  traceparent: string;
};

const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-([0-9a-f]{2})$/i;

function safe(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return SAFE_ID.test(text) ? text : null;
}

export function executionIds(
  request: FastifyRequest,
  body: Record<string, unknown> = {},
): ExecutionIds {
  const incomingTraceparent =
    typeof request.headers.traceparent === "string"
      ? request.headers.traceparent.trim().toLowerCase()
      : "";
  const traceMatch = TRACEPARENT.exec(incomingTraceparent);
  const traceId = traceMatch?.[1] ?? randomUUID().replaceAll("-", "");
  const spanId = randomUUID().replaceAll("-", "").slice(0, 16);
  const flags = traceMatch?.[2] ?? "01";
  const runId = safe(body.runId) ?? `run-${randomUUID()}`;
  return {
    conversationId:
      safe(body.conversationId) ??
      safe((body.sessionMemory as Record<string, unknown> | undefined)?.conversationId) ??
      `conversation-${randomUUID()}`,
    runId,
    traceId,
    idempotencyKey:
      safe(request.headers["idempotency-key"]) ??
      safe(body.idempotencyKey) ??
      runId,
    traceparent: `00-${traceId}-${spanId}-${flags}`,
  };
}

import { randomUUID } from "node:crypto";

export type CorrelationContext = {
  traceId: string;
  organizationId?: string;
  userId?: string;
  conversationId?: string;
  acdSessionId?: string;
  transferId?: string;
  callId?: string;
  localTag?: string;
  remoteTag?: string;
  leg?: string;
  fsmPhase?: string;
  action?: string | number;
  operationId?: string;
  presenceVersion?: number;
  messageId?: string;
  channel?: string;
};

export type CorrelationEnvelope = CorrelationContext;

export function createTraceId(): string {
  return randomUUID();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function traceIdFromTraceparent(traceparent: string | undefined): string | undefined {
  const traceId = traceparent?.split("-")[1];
  return traceId && /^[a-f\d]{32}$/i.test(traceId) ? traceId : undefined;
}

export function correlationFromRequest(request: {
  headers?: Record<string, string | string[] | undefined>;
  tenantId?: string;
  userId?: string;
}): CorrelationContext {
  const explicitTraceId = firstHeader(request.headers?.["x-trace-id"]);
  const traceId =
    explicitTraceId?.slice(0, 128) ??
    traceIdFromTraceparent(firstHeader(request.headers?.["traceparent"])) ??
    createTraceId();

  return {
    traceId,
    organizationId: request.tenantId,
    userId: request.userId,
  };
}

export function extendCorrelation(
  context: CorrelationContext,
  fields: Partial<Omit<CorrelationContext, "traceId">>,
): CorrelationContext {
  return { ...context, ...fields, traceId: context.traceId };
}

export function correlationLogFields(
  context: CorrelationContext,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...fields,
    correlation: Object.fromEntries(
      Object.entries(context).filter(([, value]) => value !== undefined && value !== null),
    ),
  };
}

export type CorrelationLogger = {
  debug?(fields: Record<string, unknown>, message: string): void;
  info?(fields: Record<string, unknown>, message: string): void;
  warn?(fields: Record<string, unknown>, message: string): void;
  error?(fields: Record<string, unknown>, message: string): void;
};

export function logWithCorrelation(
  logger: CorrelationLogger,
  level: "debug" | "info" | "warn" | "error",
  context: CorrelationContext,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  logger[level]?.(correlationLogFields(context, fields), message);
}

export type TypedServiceError = {
  code: string;
  message: string;
  statusCode: number;
  traceId: string;
  organizationId?: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
  retryable: boolean;
};

export function toTypedError(
  error: unknown,
  context: CorrelationContext,
  defaults: { code: string; statusCode?: number; retryable?: boolean },
): TypedServiceError {
  const err = error as { message?: string; statusCode?: number };
  return {
    code: defaults.code,
    message: err.message ?? "Internal service error",
    statusCode: err.statusCode ?? defaults.statusCode ?? 500,
    traceId: context.traceId,
    organizationId: context.organizationId,
    userId: context.userId,
    conversationId: context.conversationId,
    messageId: context.messageId,
    retryable: defaults.retryable ?? false,
  };
}

import type { FastifyReply } from "fastify";
import { RESPONSE } from "./constants.js";

/**
 * Canonical API envelope:
 *   { statusCode: 200, message: RESPONSE.…, ...payload }
 * Errors:
 *   { statusCode: 400, message: "…" }
 *
 * No `metaResponse` wrapper — payload fields sit beside statusCode/message.
 */
export type ApiSuccessBody = {
  statusCode: number;
  message: string;
  [key: string]: unknown;
};

export type ApiErrorBody = {
  statusCode: number;
  message: string;
};

export type ApiEnvelope = ApiSuccessBody | ApiErrorBody;

type OkResult = { ok: true; message?: string; [key: string]: unknown };
type ErrResult = {
  ok: false;
  error?: string;
  message?: string;
  status?: number;
};

export function isApiEnvelope(value: unknown): value is ApiEnvelope {
  return (
    !!value &&
    typeof value === "object" &&
    "statusCode" in value &&
    "message" in value &&
    typeof (value as ApiEnvelope).statusCode === "number" &&
    typeof (value as ApiEnvelope).message === "string" &&
    !("metaResponse" in value)
  );
}

/** Build success body: { statusCode, message, ...data }. */
export function successBody(
  data: unknown = null,
  message: string = RESPONSE.success_message,
  statusCode = 200,
): ApiSuccessBody {
  const base: ApiSuccessBody = { statusCode, message };
  if (data == null) return base;
  if (typeof data === "object" && !Array.isArray(data)) {
    const {
      statusCode: _s,
      message: _m,
      metaResponse: _meta,
      ok: _ok,
      error: _error,
      ...rest
    } = data as Record<string, unknown>;
    return { ...base, ...rest };
  }
  return { ...base, data };
}

export function errorBody(message: string, statusCode = 400): ApiErrorBody {
  return { statusCode, message };
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(jsonSafe);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = jsonSafe(v);
  }
  return out;
}

/** Explicit success — preferred in handlers. */
export function sendSuccess(
  reply: FastifyReply,
  data: unknown = null,
  message: string = RESPONSE.success_message,
  statusCode = 200,
) {
  return reply
    .code(statusCode)
    .send(jsonSafe(successBody(data, message, statusCode)));
}

/** Explicit error — preferred in handlers. */
export function sendError(
  reply: FastifyReply,
  message: string,
  statusCode = 400,
) {
  return reply.code(statusCode).send(errorBody(message, statusCode));
}

/**
 * Map domain `{ ok: true/false, … }` command results to the API envelope.
 */
export function sendResult(
  reply: FastifyReply,
  result: OkResult | ErrResult,
  errorStatus = 400,
  successMessage: string = RESPONSE.success_message,
) {
  if (!result || typeof result !== "object") {
    return sendError(reply, RESPONSE.faild, errorStatus);
  }

  if (!result.ok) {
    const status =
      typeof result.status === "number" && result.status >= 400
        ? result.status
        : errorStatus;
    const msg =
      (typeof result.error === "string" && result.error) ||
      (typeof result.message === "string" && result.message) ||
      RESPONSE.faild;
    const {
      ok: _ok,
      error: _error,
      status: _status,
      message: _message,
      ...extra
    } = result as ErrResult & Record<string, unknown>;
    if (Object.keys(extra).length > 0) {
      return reply.code(status).send({
        statusCode: status,
        message: msg,
        ...jsonSafe(extra),
      });
    }
    return sendError(reply, msg, status);
  }

  const {
    ok: _ok,
    error: _error,
    status: _status,
    message,
    ...meta
  } = result;
  const msg =
    typeof message === "string" && message.trim()
      ? message
      : successMessage;
  return sendSuccess(reply, meta, msg);
}

/**
 * Wrap leftover non-envelope JSON into { statusCode, message, ...data }.
 * Strips any legacy `metaResponse` key.
 */
export function toApiEnvelope(
  payload: unknown,
  httpStatus: number,
): unknown {
  if (payload == null) {
    if (httpStatus >= 400) {
      return errorBody(RESPONSE.faild, httpStatus);
    }
    return successBody(null, RESPONSE.success_message, httpStatus || 200);
  }

  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;

    // Already envelope-shaped — flatten legacy metaResponse if present
    if (
      typeof record.statusCode === "number" &&
      typeof record.message === "string"
    ) {
      if ("metaResponse" in record) {
        const {
          statusCode,
          message,
          metaResponse,
          ...rest
        } = record;
        return successBody(
          metaResponse != null &&
            typeof metaResponse === "object" &&
            !Array.isArray(metaResponse)
            ? { ...(metaResponse as object), ...rest }
            : metaResponse ?? rest,
          message,
          statusCode,
        );
      }
      return payload;
    }

    if (typeof record.ok === "boolean") {
      if (record.ok) {
        const { ok: _ok, message, error: _error, status: _status, ...rest } =
          record;
        const msg =
          typeof message === "string" && message.trim()
            ? message
            : RESPONSE.success_message;
        return successBody(
          rest,
          msg,
          httpStatus >= 400 ? 200 : httpStatus || 200,
        );
      }
      const msg =
        (typeof record.error === "string" && record.error) ||
        (typeof record.message === "string" && record.message) ||
        RESPONSE.faild;
      return errorBody(msg, httpStatus || 400);
    }

    return successBody(
      payload,
      RESPONSE.success_message,
      httpStatus || 200,
    );
  }

  return successBody(payload, RESPONSE.success_message, httpStatus || 200);
}

/**
 * Standard flat API response envelope used by every JSON route:
 *   { statusCode, message, ...payload }
 */

export type ApiEnvelope = {
  statusCode: number;
  message: string;
  [key: string]: unknown;
};

/** Shared success/error message catalog. Extend per domain as needed. */
export const RESPONSE = {
  success: "Success",
  created: "Created successfully.",
  updated: "Updated successfully.",
  deleted: "Deleted successfully.",
  failed: "Request failed.",
  unauthorized: "Authentication required.",
  forbidden: "Access denied.",
  notFound: "Not found.",
  conflict: "Conflict.",
  validationFailed: "Validation failed.",
  databaseUnavailable: "Database unavailable. Try again in a moment.",
} as const;

export type ResponseMessage = (typeof RESPONSE)[keyof typeof RESPONSE] | string;

export function isApiEnvelope(value: unknown): value is ApiEnvelope {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "statusCode" in value &&
    "message" in value &&
    !("metaResponse" in value)
  );
}

function defaultMessage(statusCode: number): string {
  if (statusCode >= 500) return RESPONSE.failed;
  if (statusCode === 409) return RESPONSE.conflict;
  if (statusCode === 404) return RESPONSE.notFound;
  if (statusCode === 403) return RESPONSE.forbidden;
  if (statusCode === 401) return RESPONSE.unauthorized;
  if (statusCode === 400) return RESPONSE.validationFailed;
  if (statusCode === 201) return RESPONSE.created;
  if (statusCode >= 200 && statusCode < 300) return RESPONSE.success;
  return RESPONSE.failed;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Envelope `message` is always a status string. Route payloads that put a
 * domain object under `message` collide with that key — remap the object to
 * `mailMessage` so it is not discarded when building the flat envelope.
 */
function remappedObjectMessage(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { mailMessage: value };
  }
  return {};
}

/**
 * Build the flat envelope from a route payload.
 * Object payloads are merged at the root (no metaResponse).
 */
export function toApiEnvelope(
  statusCode: number,
  payload: unknown,
  message?: ResponseMessage,
): ApiEnvelope {
  const resolvedMessage = String(message || defaultMessage(statusCode));

  // Already flat (or legacy nested) envelope — normalize to flat.
  const existing = asPlainObject(payload);
  if (existing && "statusCode" in existing && "message" in existing) {
    if ("metaResponse" in existing) {
      const nested = existing.metaResponse;
      const nestedObject = asPlainObject(nested);
      if (nestedObject) {
        const { statusCode: _s, message: nestedMessage, metaResponse: _meta, ...rest } = {
          ...nestedObject,
        };
        return {
          statusCode: Number(existing.statusCode) || statusCode,
          message: String(existing.message || resolvedMessage),
          ...remappedObjectMessage(nestedMessage),
          ...rest,
        };
      }
      return {
        statusCode: Number(existing.statusCode) || statusCode,
        message: String(existing.message || resolvedMessage),
        ...(nested === undefined || nested === null ? {} : { data: nested }),
      };
    }

    const { statusCode: existingStatus, message: existingMessage, ...rest } = existing;
    const statusText =
      typeof existingMessage === "string" && existingMessage
        ? existingMessage
        : resolvedMessage;
    return {
      statusCode: Number(existingStatus) || statusCode,
      message: String(statusText),
      ...remappedObjectMessage(
        typeof existingMessage === "object" ? existingMessage : undefined,
      ),
      ...rest,
    };
  }

  if (
    statusCode >= 400 &&
    existing &&
    "error" in existing
  ) {
    const { error, ...rest } = existing;
    return {
      statusCode,
      message: String(error || resolvedMessage),
      ...rest,
    };
  }

  if (existing) {
    const { statusCode: _ignoredStatus, message: ignoredMessage, metaResponse: _ignoredMeta, ...rest } =
      existing;
    return {
      statusCode,
      message: resolvedMessage,
      ...remappedObjectMessage(ignoredMessage),
      ...rest,
    };
  }

  if (payload === undefined || payload === null) {
    return {
      statusCode,
      message: resolvedMessage,
    };
  }

  return {
    statusCode,
    message: resolvedMessage,
    data: payload,
  };
}

export function successResponse(
  payload: Record<string, unknown> | null | undefined = null,
  message: ResponseMessage = RESPONSE.success,
  statusCode = 200,
): ApiEnvelope {
  return toApiEnvelope(statusCode, payload ?? {}, message);
}

export function errorResponse(
  message: ResponseMessage,
  statusCode = 400,
  details: Record<string, unknown> | null = null,
): ApiEnvelope {
  return toApiEnvelope(statusCode, details ?? {}, message);
}

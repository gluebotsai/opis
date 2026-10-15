import type { FastifyPluginAsync } from "fastify";
import { toApiEnvelope } from "../helpers/response.js";

/**
 * Ensures JSON API responses use:
 *   { statusCode, message, ...payload }
 *
 * Skips SSE and non-JSON bodies. Flattens legacy metaResponse if present.
 */
export const responseEnvelopePlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (request, reply, payload) => {
    const contentType = String(reply.getHeader("content-type") ?? "");
    if (contentType.includes("text/event-stream")) {
      return payload;
    }
    if (
      contentType &&
      !contentType.includes("application/json") &&
      !contentType.includes("json")
    ) {
      // Allow unset content-type (Fastify JSON serializer) through below.
      if (
        contentType.includes("text/") ||
        contentType.includes("octet-stream") ||
        contentType.includes("csv")
      ) {
        return payload;
      }
    }

    if (payload == null || typeof payload !== "string") {
      return payload;
    }

    const path = request.url.split("?")[0] || "";
    // Swagger UI / static assets under /docs
    if (request.url.startsWith("/docs")) {
      return payload;
    }
    // Meet add-on HTML/assets proxied from meeting-service
    if (path.startsWith("/addons/meet")) {
      return payload;
    }
    // Meeting-service bot contract — do not wrap { organization_id, reply, ... }.
    if (path === "/v1" || path.startsWith("/v1/")) {
      return payload;
    }

    try {
      const parsed: unknown = JSON.parse(payload);
      const enveloped = toApiEnvelope(parsed, reply.statusCode);
      if (enveloped === parsed) return payload;
      return JSON.stringify(enveloped);
    } catch {
      return payload;
    }
  });
};

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { toApiEnvelope } from "../helpers/api-response.js";

const SKIP_ENVELOPE_PATHS = new Set([
  "/api/payments/webhook/stripe",
  "/api/payments/webhook/razorpay",
  "/api/mail/graph/webhook",
  "/api/mail/oauth/callback",
  "/api/mail/oauth/admin-consent",
  "/auth/microsoft/callback",
  "/api/events/stream",
]);

function shouldSkipEnvelope(request: FastifyRequest, reply: FastifyReply): boolean {
  if ((reply as FastifyReply & { hijacked?: boolean }).hijacked) {
    return true;
  }

  const path = String(request.url || "").split("?")[0] || "";
  if (SKIP_ENVELOPE_PATHS.has(path)) {
    return true;
  }

  const contentTypeHeader = reply.getHeader("content-type");
  const contentType = Array.isArray(contentTypeHeader)
    ? String(contentTypeHeader[0] || "")
    : String(contentTypeHeader || "");
  if (
    contentType &&
    !contentType.includes("application/json") &&
    !contentType.includes("application/problem+json")
  ) {
    return true;
  }

  return false;
}

function parsePayload(payload: unknown): unknown {
  if (payload == null || payload === "") {
    return null;
  }
  if (Buffer.isBuffer(payload)) {
    const text = payload.toString("utf8");
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (typeof payload === "string") {
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}

const apiResponseEnvelopePlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    fastify.addHook("onSend", async (request, reply, payload) => {
      if (shouldSkipEnvelope(request, reply)) {
        return payload;
      }

      const parsed = parsePayload(payload);
      // Non-JSON payloads (redirects, plain text already filtered) leave as-is.
      if (typeof payload === "string" || Buffer.isBuffer(payload)) {
        const contentType = String(reply.getHeader("content-type") || "");
        if (contentType && !contentType.includes("application/json") && parsed === null) {
          return payload;
        }
      }

      if (parsed === null && (typeof payload === "string" || Buffer.isBuffer(payload))) {
        // Could not parse as JSON — leave untouched (e.g. plain validation tokens).
        const contentType = String(reply.getHeader("content-type") || "");
        if (contentType.includes("text/plain")) {
          return payload;
        }
      }

      const statusCode = reply.statusCode || 200;
      const envelope = toApiEnvelope(statusCode, parsed);
      reply.header("content-type", "application/json; charset=utf-8");
      return JSON.stringify(envelope);
    });
  },
  { name: "api-response-envelope" },
);

export default apiResponseEnvelopePlugin;

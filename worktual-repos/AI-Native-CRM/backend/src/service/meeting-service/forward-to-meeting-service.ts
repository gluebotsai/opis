import type { FastifyReply, FastifyRequest } from "fastify";

import { meetingServiceBaseUrl } from "@/service/meeting-service/config";

/** Reverse-proxy a request to meeting-service (Meet add-on + assist APIs). */
export async function forwardToMeetingService(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const base = meetingServiceBaseUrl();
  if (!base) {
    return reply.code(503).send({ detail: "MEETING_SERVICE_URL is not configured" });
  }

  const path = request.raw.url ?? request.url;
  const target = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (key === "host" || key === "connection") continue;
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
  }

  const init: RequestInit = { method: request.method, headers };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = request.body;
    if (body !== undefined && body !== null) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
      if (!headers["content-type"]) {
        headers["content-type"] = "application/json";
      }
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    request.log.error({ err, target }, "meeting-service proxy failed");
    const detail =
      process.env.NODE_ENV === "production"
        ? "meeting-service unreachable"
        : `meeting-service unreachable (${target})`;
    return reply.code(502).send({ detail });
  }

  reply.code(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (key === "transfer-encoding") return;
    reply.header(key, value);
  });

  const buf = Buffer.from(await upstream.arrayBuffer());
  return reply.send(buf);
}

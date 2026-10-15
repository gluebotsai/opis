import type { IncomingHttpHeaders, ServerResponse } from "node:http";

import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { handleEventsStream } from "../../infra/sse.js";

type StreamQuery = Record<string, unknown>;

interface LegacyStreamRequest {
  headers: IncomingHttpHeaders;
  query: StreamQuery;
  on: FastifyRequest["raw"]["on"];
}

interface LegacyStreamResponse {
  status: (statusCode: number) => LegacyStreamResponse;
  json: (body: unknown) => LegacyStreamResponse;
  writeHead: (
    statusCode: number,
    headers: Record<string, string>,
  ) => LegacyStreamResponse;
  write: ServerResponse["write"];
}

function createStreamRequest(request: FastifyRequest): LegacyStreamRequest {
  return {
    headers: request.raw.headers,
    query: (request.query ?? {}) as StreamQuery,
    on: request.raw.on.bind(request.raw),
  };
}

function createStreamResponse(reply: FastifyReply): LegacyStreamResponse {
  const raw = reply.raw;
  const response: LegacyStreamResponse = {
    status(statusCode) {
      raw.statusCode = statusCode;
      return response;
    },
    json(body) {
      if (!raw.headersSent) {
        raw.setHeader("x-route-host", "fastify");
        raw.setHeader("content-type", "application/json; charset=utf-8");
      }
      raw.end(JSON.stringify(body));
      return response;
    },
    writeHead(statusCode, headers) {
      raw.setHeader("x-route-host", "fastify");
      raw.writeHead(statusCode, headers);
      return response;
    },
    write: raw.write.bind(raw),
  };
  return response;
}

export const nativeEventsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/events/stream", async (request, reply) => {
    // The legacy SSE handler intentionally owns the raw response for the full
    // connection lifetime, so Fastify must not auto-complete this request.
    reply.hijack();
    const response = createStreamResponse(reply);

    try {
      await handleEventsStream(createStreamRequest(request), response);
    } catch (error) {
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader("content-type", "application/json; charset=utf-8");
        reply.raw.end(
          JSON.stringify({
            error:
              error instanceof Error ? error.message : "Event stream failed.",
          }),
        );
      }
    }
  });
};

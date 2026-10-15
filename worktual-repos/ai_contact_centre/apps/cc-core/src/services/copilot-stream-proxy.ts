import type { FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";

const NLP_URL = (process.env.NLP_SERVICE_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type CopilotStreamEndpoint = "stream" | "suggest-reply/stream";
export type CopilotJsonEndpoint = "suggest-reply/confirm";

function upstreamCopilotUrl(endpoint: CopilotStreamEndpoint): string {
  return `${NLP_URL}/api/v1/copilot/${endpoint}`;
}

export async function proxyCopilotStream(
  request: FastifyRequest,
  reply: FastifyReply,
  endpoint: CopilotStreamEndpoint,
): Promise<void> {
  const authorization = request.headers.authorization;
  let upstream: Response;
  try {
    upstream = await fetch(upstreamCopilotUrl(endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(request.body ?? {}),
    });
  } catch (error) {
    reply.status(502).send({
      error: "CopilotUpstreamError",
      message:
        error instanceof Error
          ? `Copilot service unreachable (${error.message}). Check NLP_SERVICE_URL and that the nlp container is running.`
          : "Copilot service unreachable",
      statusCode: 502,
    });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    reply.status(upstream.status).send({
      error: "CopilotUpstreamError",
      message: detail.trim() || `Copilot request failed (${upstream.status})`,
      statusCode: upstream.status,
    });
    return;
  }

  reply.header("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream");
  reply.header("Cache-Control", "no-cache, no-transform");
  reply.header("Connection", "keep-alive");
  reply.header("X-Accel-Buffering", "no");

  const stream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
  return reply.send(stream);
}

export async function proxyCopilotJson(
  request: FastifyRequest,
  reply: FastifyReply,
  endpoint: CopilotJsonEndpoint,
): Promise<void> {
  const authorization = request.headers.authorization;
  let upstream: Response;
  try {
    upstream = await fetch(`${NLP_URL}/api/v1/copilot/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(request.body ?? {}),
    });
  } catch (error) {
    reply.status(502).send({
      error: "CopilotUpstreamError",
      message:
        error instanceof Error
          ? `Copilot service unreachable (${error.message}). Check NLP_SERVICE_URL and that the nlp container is running.`
          : "Copilot service unreachable",
      statusCode: 502,
    });
    return;
  }

  const detail = await upstream.text().catch(() => "");
  let payload: unknown = {};
  if (detail) {
    try {
      payload = JSON.parse(detail);
    } catch {
      payload = {
        error: "CopilotUpstreamError",
        message: detail,
        statusCode: upstream.status,
      };
    }
  }
  return reply.status(upstream.status).send(payload);
}

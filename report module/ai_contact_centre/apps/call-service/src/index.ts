import "@ai-contact-center/config/load-root-env";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { createLogger } from "@ai-contact-center/observability";
import { inboundMessageEventSchema } from "@ai-contact-center/event-contracts";
import { startKafkaConsumerStub } from "./workers/kafka-stub.js";
import { verifyAccessToken } from "./lib/jwt.js";
import { fetchCoreSipSession, restoreCoreSipSession } from "./cc-core-sip.js";
import { buildSipUaSession, sipSessionHttpPaths } from "./sip-session.js";

const PORT = Number(process.env.PORT ?? 3003);
const SERVICE_NAME = "call-service";
const CHANNEL_TYPE = "voice";
const logger = createLogger({ service: SERVICE_NAME });

async function main() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(sensible);

  app.get("/health", async () => ({
    status: "ok" as const,
    service: SERVICE_NAME,
    channel: CHANNEL_TYPE,
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/ready", async () => ({
    status: "ok" as const,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
  }));

  const requireJwt = (request: FastifyRequest) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw app.httpErrors.internalServerError("JWT_SECRET is not configured");
    }
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw app.httpErrors.unauthorized("Missing bearer token");
    }
    const payload = verifyAccessToken(header.slice("Bearer ".length), jwtSecret);
    if (!payload) {
      throw app.httpErrors.unauthorized("Invalid or expired token");
    }
    return payload;
  };

  const sipSessionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = requireJwt(request);

    const core = await fetchCoreSipSession(payload.tenant_id, payload.sub);
    if (!core.session) {
      return reply.status(core.status === 404 ? 404 : 502).send({
        error: "SIP session unavailable",
        message: core.message ?? "SIP session unavailable",
      });
    }
    if (!core.session.redisRegistered) {
      return reply.status(409).send({
        error: "SIP not ready",
        message: "Redis SIP registration is not set. Sign in again.",
        redisKey: core.session.redisKey,
      });
    }

    return buildSipUaSession(core.session);
  };

  const sipRestoreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = requireJwt(request);
    const restored = await restoreCoreSipSession(payload.tenant_id, payload.sub);
    if (!restored.ok) {
      return reply.status(restored.status === 404 ? 404 : 502).send({
        error: "SIP restore failed",
        message: restored.message ?? "SIP restore failed",
      });
    }
    return { ok: true };
  };

  for (const path of sipSessionHttpPaths()) {
    app.get(path, sipSessionHandler);
    app.post(`${path}/restore`, sipRestoreHandler);
  }

  app.post("/internal/messages", async (request) => {
    const event = inboundMessageEventSchema.parse({
      ...(request.body as object),
      channel_type: CHANNEL_TYPE,
    });
    logger.info({ event_id: event.event_id, tenant_id: event.tenant_id }, "inbound message received");
    return { accepted: true, event_id: event.event_id };
  });

  startKafkaConsumerStub(logger, SERVICE_NAME);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  logger.info({ port: PORT, channel: CHANNEL_TYPE }, `${SERVICE_NAME} listening`);
}

main().catch((error) => {
  logger.error({ err: error }, "failed to start");
  process.exit(1);
});

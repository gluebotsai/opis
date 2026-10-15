import type { FastifyInstance, FastifyReply } from "fastify";
import { getHealth } from "./service.js";

export async function healthController(
  app: FastifyInstance,
  reply: FastifyReply,
) {
  const health = await getHealth(app);
  return reply.status(health.status === "ok" ? 200 : 503).send(health);
}

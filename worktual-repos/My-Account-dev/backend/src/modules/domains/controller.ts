import type { FastifyReply } from "fastify";
import { getRouteOwnership } from "./service.js";

export async function ownershipController(reply: FastifyReply) {
  return reply.send(getRouteOwnership());
}

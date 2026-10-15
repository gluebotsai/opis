import type { FastifyReply, FastifyRequest } from "fastify";

export async function currentUserController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const principal = request.principal!;
  return reply.send({
    id: principal.sub,
    organizationId: principal.organizationId,
    role: principal.role,
    permissions: principal.permissions,
  });
}

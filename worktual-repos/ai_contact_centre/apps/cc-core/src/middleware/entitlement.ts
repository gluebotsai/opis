import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { PrismaClient } from "@ai-contact-center/db-cc";

import { toDbId } from "../lib/id-schema.js";

const CONTACT_CENTER_PRODUCT = "contact-center";

export async function assertContactCenterEntitlement(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  const grant = await prisma.setup_user_product_access.findFirst({
    where: {
      organization_id: toDbId(organizationId),
      product_id: CONTACT_CENTER_PRODUCT,
    },
    select: { id: true },
  });
  if (!grant) {
    throw Object.assign(new Error("Contact Center entitlement is required"), { status: 403 });
  }
}

export function registerContactCenterEntitlement(app: FastifyInstance): void {
  app.decorate(
    "requireContactCenter",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.tenantId) {
        return reply.status(401).send({ error: "Unauthorized", message: "Missing tenant context" });
      }
      try {
        await assertContactCenterEntitlement(app.prisma, request.tenantId);
      } catch (error) {
        const status =
          typeof error === "object" && error && "status" in error
            ? Number((error as { status: number }).status)
            : 403;
        const message = error instanceof Error ? error.message : "Forbidden";
        return reply.status(status).send({ error: "Forbidden", message, statusCode: status });
      }
    },
  );
}

declare module "fastify" {
  interface FastifyInstance {
    requireContactCenter: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

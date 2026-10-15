import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";

export async function registerPlatformRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  app.get(joinApiV1(apiV1Base, "/users"), async () => {
    return app.prisma.users.findMany({
      where: { is_active: true },
      orderBy: { display_name: "asc" },
      select: {
        id: true,
        email: true,
        display_name: true,
        role: true,
        is_active: true,
      },
    });
  });

  app.get(joinApiV1(apiV1Base, "/tenants/:tenantId/users"), async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    // Platform users are global; filter by tenant when org linkage exists in future
    void tenantId;
    return app.prisma.users.findMany({
      where: { is_active: true },
      orderBy: { display_name: "asc" },
      select: {
        id: true,
        email: true,
        display_name: true,
        role: true,
        is_active: true,
      },
    });
  });

  app.get(joinApiV1(apiV1Base, "/products"), async () => {
    return app.prisma.products.findMany({
      orderBy: { id: "asc" },
    });
  });
}

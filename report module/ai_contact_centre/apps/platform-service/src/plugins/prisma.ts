import type { FastifyInstance } from "fastify";
import { platformPrisma } from "@ai-contact-center/db-platform";

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof platformPrisma;
  }
}

export async function registerPrisma(app: FastifyInstance): Promise<void> {
  app.decorate("prisma", platformPrisma);
  app.addHook("onClose", async () => {
    await platformPrisma.$disconnect();
  });
}

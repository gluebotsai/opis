import type { FastifyInstance } from "fastify";
import { ccPrisma } from "@ai-contact-center/db-cc";

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof ccPrisma;
  }
}

export async function registerPrisma(app: FastifyInstance): Promise<void> {
  app.decorate("prisma", ccPrisma);

  app.addHook("onClose", async () => {
    await ccPrisma.$disconnect();
  });
}

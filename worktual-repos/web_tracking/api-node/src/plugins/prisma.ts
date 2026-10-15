import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { assertPostgresWriteAllowed, isPostgresReadOnly } from "../lib/postgresReadOnly.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: AppPrismaClient;
  }
}

/** App code types against PrismaClient; read-only mode uses $extends at runtime. */
export type AppPrismaClient = PrismaClient;

function createPrismaClient(): AppPrismaClient {
  const client = new PrismaClient();
  if (!isPostgresReadOnly()) {
    return client;
  }

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          assertPostgresWriteAllowed(operation);
          return query(args);
        },
      },
    },
  }) as AppPrismaClient;
}

export const prismaPlugin = fp(async function prismaPlugin(app: FastifyInstance) {
  const prisma: AppPrismaClient = createPrismaClient();
  // Fastify decorate expects PrismaClient; $extends client is cast at creation time.
  app.decorate("prisma", prisma as PrismaClient);
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});

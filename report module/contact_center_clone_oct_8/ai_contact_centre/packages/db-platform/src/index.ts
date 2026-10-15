import { PrismaClient } from "./generated/index.js";

const globalForPrisma = globalThis as unknown as { platformPrisma?: PrismaClient };

export const platformPrisma =
  globalForPrisma.platformPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.platformPrisma = platformPrisma;
}

export * from "./generated/index.js";
export type { Prisma } from "./generated/index.js";

import { PrismaClient } from "./generated/index.js";

const globalForPrisma = globalThis as unknown as { ccPrisma?: PrismaClient };

export const ccPrisma =
  globalForPrisma.ccPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.ccPrisma = ccPrisma;
}

export * from "./generated/index.js";

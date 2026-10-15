import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** BigInt columns that the app still passes as decimal strings. */
const ID_KEYS = new Set([
  "id",
  "organizationId",
  "branchId",
  "campaignId",
  "sessionId",
  "contactId",
  "createdByUserId",
  "templateId",
  "batchId",
  "userId",
  "generationBatchId",
  "sourceCampaignId",
  "channelConfigId",
  "providerDomainId",
]);

const FILTER_OPS = new Set([
  "equals",
  "in",
  "notIn",
  "not",
  "lt",
  "lte",
  "gt",
  "gte",
  "set",
]);

function looksLikeIntId(value: string): boolean {
  return /^-?\d+$/.test(value) && value.length <= 19;
}

function coerceArgs(value: unknown, fieldKey?: string): unknown {
  if (typeof value === "string" && fieldKey && ID_KEYS.has(fieldKey) && looksLikeIntId(value)) {
    return BigInt(value);
  }
  if (typeof value === "bigint" || value instanceof Date || value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => coerceArgs(item, fieldKey));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FILTER_OPS.has(key)) {
        out[key] = coerceArgs(child, fieldKey);
      } else {
        out[key] = coerceArgs(child, ID_KEYS.has(key) ? key : fieldKey);
      }
    }
    return out;
  }
  return value;
}

function stringifyBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date || value == null) return value;
  if (Array.isArray(value)) return value.map(stringifyBigInts);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = stringifyBigInts(child);
    }
    return out;
  }
  return value;
}

function createPrisma(): PrismaClient {
  const base = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const nextArgs = coerceArgs(args) as typeof args;
          const result = await query(nextArgs);
          return stringifyBigInts(result) as typeof result;
        },
      },
    },
  });

  return extended as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

import { Prisma, PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaConnecting: Promise<PrismaClient> | undefined;
  cronPrisma: PrismaClient | undefined;
};

/**
 * Cap each PrismaClient's pool. Without this, every HMR / stale-client
 * recreation opens ~num_cpus*2+1 connections and Postgres hits
 * "sorry, too many clients already".
 */
const PRISMA_POOL_LIMIT = Number(process.env.PRISMA_CONNECTION_LIMIT || 5);

/**
 * Separate, smaller pool reserved for cron-scheduler sweeps (lead scoring /
 * lifecycle / nurture / enrichment, etc — see `service/scheduler/cron-scheduler.ts`).
 * Before this, cron sweeps shared the same 5-connection pool as live request
 * traffic (including live meeting-assist coaching), so a burst of sweeps
 * could starve the pool and add many seconds of latency to an in-flight
 * request waiting on a free connection. Routing is transparent: any DAO call
 * made from inside `runInCronDbContext` (only the cron scheduler uses this)
 * automatically resolves to this pool instead — no DAO changes needed.
 */
const PRISMA_CRON_POOL_LIMIT = Number(process.env.PRISMA_CRON_CONNECTION_LIMIT || 3);

/** Set for the lifetime of a cron-scheduler sweep's async call graph. */
const cronDbContext = new AsyncLocalStorage<boolean>();

/** Wrap a cron sweep's run() so its DB calls resolve to the isolated cron pool. */
export function runInCronDbContext<T>(fn: () => Promise<T>): Promise<T> {
  return cronDbContext.run(true, fn);
}

/** Prisma BigInt fields — convert string args ↔ string results for app code. */
const BIGINT_FIELD = /(?:Id|Ids)$|^(?:organizationId|ownerUserId|userId)$/;
/** String id fields that must not be coerced to BigInt (numeric-looking UUIDs / Zoom/Teams keys). */
const TEXT_ID_FIELD =
  /^(?:accountContactId|contactId|accountContactIds|contactIds|scopeId|externalMeetingId|historyId|entityId)$/;

function databaseUrlWithPoolLimit(poolLimit: number): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    // Always set our own connection_limit per client instance — two clients
    // sharing one DATABASE_URL string with a baked-in connection_limit query
    // param would otherwise both inherit the same value.
    url.searchParams.set("connection_limit", String(poolLimit));
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "10");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function looksNumericId(value: string): boolean {
  return /^-?\d+$/.test(value.trim());
}

function encodeArgs(value: unknown, key?: string): unknown {
  if (value == null) return value;
  if (
    typeof value === "string" &&
    key &&
    !TEXT_ID_FIELD.test(key) &&
    BIGINT_FIELD.test(key) &&
    looksNumericId(value)
  ) {
    return BigInt(value.trim());
  }
  if (Array.isArray(value)) {
    if (
      key &&
      !TEXT_ID_FIELD.test(key) &&
      BIGINT_FIELD.test(key) &&
      value.every((v) => typeof v === "string" && looksNumericId(v))
    ) {
      return value.map((v) => BigInt(String(v).trim()));
    }
    return value.map((v) => encodeArgs(v));
  }
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (typeof value === "object" && Prisma.Decimal.isDecimal(value)) return value;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Prisma filter operators: { in: [...] }, { equals: "1" }
      if (
        k === "in" ||
        k === "equals" ||
        k === "not" ||
        k === "lt" ||
        k === "gt" ||
        k === "lte" ||
        k === "gte"
      ) {
        out[k] = encodeArgs(v, key);
      } else {
        out[k] = encodeArgs(v, k);
      }
    }
    return out;
  }
  return value;
}

function decodeResult(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(decodeResult);
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  // Keep money as a decimal string. Walking Decimal into {s,e,d} makes Number() NaN
  // and breaks quote/invoice totals.
  if (typeof value === "object" && Prisma.Decimal.isDecimal(value)) {
    return value.toString();
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = decodeResult(v);
    }
    return out;
  }
  return value;
}

function createPrismaClient(poolLimit: number): PrismaClient {
  const url = databaseUrlWithPoolLimit(poolLimit);
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(url ? { datasources: { db: { url } } } : {}),
  });

  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const encoded = encodeArgs(args) as typeof args;
          const result = await query(encoded);
          return decodeResult(result) as typeof result;
        },
      },
    },
  });

  // App code keeps string ids; bridge encodes/decodes at the boundary.
  return extended as unknown as PrismaClient;
}

/**
 * Two shared PrismaClient singletons for the process — the default pool
 * (API requests, including live meeting-assist) and a smaller isolated pool
 * used only for cron-scheduler sweeps (selected via AsyncLocalStorage; see
 * `runInCronDbContext`). Do not recreate on schema-field probes — that leaked
 * connections under Turbopack HMR. New fields use raw SQL until the next cold
 * start / `prisma generate`.
 *
 * Do NOT import node:module / createRequire here — this file is pulled into
 * some client module graphs via activity services and Turbopack will 500.
 */
export function getPrismaClient(): PrismaClient {
  if (cronDbContext.getStore()) {
    if (globalForPrisma.cronPrisma) return globalForPrisma.cronPrisma;
    const cronClient = createPrismaClient(PRISMA_CRON_POOL_LIMIT);
    globalForPrisma.cronPrisma = cronClient;
    return cronClient;
  }

  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const client = createPrismaClient(PRISMA_POOL_LIMIT);
  globalForPrisma.prisma = client;
  return client;
}

/** Always resolve through getPrismaClient so the process keeps one singleton. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient() as unknown as Record<
      string | symbol,
      unknown
    >;
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

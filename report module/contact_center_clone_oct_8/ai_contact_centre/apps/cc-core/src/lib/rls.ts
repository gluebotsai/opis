import type { Prisma, PrismaClient } from "@ai-contact-center/db-cc";

import { serializeEntityId } from "./id-schema.js";

export type DbClient = PrismaClient | Prisma.TransactionClient;

const ORG_TRANSACTION_OPTIONS = {
  timeout: 30_000,
  maxWait: 10_000,
} as const;

/** Report data loads can fan out across many agents; keep outside short write transactions. */
export const REPORT_READ_TRANSACTION_OPTIONS = {
  timeout: 120_000,
  maxWait: 15_000,
} as const;

/** PDF persistence can run after long NLP/capture work; never share a txn with that pipeline. */
export const REPORT_WRITE_TRANSACTION_OPTIONS = {
  timeout: 180_000,
  maxWait: 15_000,
} as const;

/** Set Postgres RLS session vars for accounts schema (`platform.rls_org_ok`). */
/** Shorter timeout for read-heavy endpoints (contact list, etc.). */
export async function withOrganizationReadContext<T>(
  prisma: PrismaClient,
  organizationId: string | number | bigint,
  fn: (db: DbClient) => Promise<T>,
): Promise<T> {
  return withOrganizationContext(prisma, organizationId, fn, { timeoutMs: 15_000 });
}

export async function withOrganizationContext<T>(
  prisma: PrismaClient,
  organizationId: string | number | bigint,
  fn: (db: DbClient) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const txOptions =
    options.timeoutMs != null
      ? {
          timeout: options.timeoutMs,
          maxWait:
            options.timeoutMs > ORG_TRANSACTION_OPTIONS.timeout
              ? REPORT_READ_TRANSACTION_OPTIONS.maxWait
              : ORG_TRANSACTION_OPTIONS.maxWait,
        }
      : ORG_TRANSACTION_OPTIONS;
  const organizationIdText = serializeEntityId(organizationId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationIdText}, true)`;
    return fn(tx);
  }, txOptions);
}

export async function withOrganizationReportWriteContext<T>(
  prisma: PrismaClient,
  organizationId: string | number | bigint,
  fn: (db: DbClient) => Promise<T>,
): Promise<T> {
  const organizationIdText = serializeEntityId(organizationId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationIdText}, true)`;
    return fn(tx);
  }, REPORT_WRITE_TRANSACTION_OPTIONS);
}

/** Staff context for pre-login lookups (bypasses org filter in `platform.rls_org_ok`). */
export async function withStaffContext<T>(
  prisma: PrismaClient,
  fn: (db: DbClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    return fn(tx);
  }, ORG_TRANSACTION_OPTIONS);
}

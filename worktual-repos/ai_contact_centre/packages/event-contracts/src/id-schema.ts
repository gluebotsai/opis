import { z } from "zod";

/** CCaaS / accounts entity primary keys and foreign keys (bigint in Postgres, string in JSON/API). */
export const entityIdSchema = z
  .string()
  .regex(/^\d+$/, "Expected a numeric entity id.");

/** Correlation / tracing ids — remain UUID strings even after entity PK migration. */
export const correlationIdSchema = z.string().uuid();

export function serializeEntityId(id: bigint | number | string): string {
  return String(id);
}

export function serializeEntityIdOptional(
  id: bigint | number | string | null | undefined,
): string | null {
  if (id == null) return null;
  return String(id);
}

/** Safe JSON.stringify for API payloads that may contain bigint values from Postgres. */
export function jsonStringifyEntityPayload(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

export function parseEntityId(id: string): bigint {
  return BigInt(id);
}

export function isEntityId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^\d+$/.test(id);
}

/** Alias for Prisma bigint column filters. */
export const toDbId = parseEntityId;

export function toDbIdOptional(id: string | null | undefined): bigint | null | undefined {
  if (id == null) return id;
  return BigInt(id);
}

export function toDbIdList(ids: string[]): bigint[] {
  return ids.map((id) => BigInt(id));
}

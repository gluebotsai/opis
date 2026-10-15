const WRITE_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

export function isPostgresReadOnly(): boolean {
  const value = process.env.POSTGRES_READ_ONLY ?? "true";
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

export function assertPostgresWriteAllowed(operation: string): void {
  if (isPostgresReadOnly() && WRITE_OPS.has(operation)) {
    throw new Error(
      "PostgreSQL is read-only (POSTGRES_READ_ONLY=true). INSERT/UPDATE/DELETE are blocked on the live auth database.",
    );
  }
}

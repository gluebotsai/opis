/**
 * worktual_bigint uses bigint for org / user / contact identity columns.
 * App code keeps string ids at the edges; convert at Prisma boundaries.
 */

export function toBigIntId(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Expected numeric bigint id, got: ${value}`);
  }
  return BigInt(trimmed);
}

export function toBigIntIdOrNull(
  value: string | number | bigint | null | undefined,
): bigint | null {
  if (value == null) return null;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return null;
  return toBigIntId(raw as string | number | bigint);
}

export function idToString(value: bigint | number | string | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

export function idToStringOrNull(
  value: bigint | number | string | null | undefined,
): string | null {
  if (value == null) return null;
  return String(value);
}

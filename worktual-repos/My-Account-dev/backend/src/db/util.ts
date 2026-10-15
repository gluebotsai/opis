function toCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_: any, char: string) => char.toUpperCase());
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function ensureUuid(value: unknown, createUuid: () => string): string {
  if (isUuid(value)) {
    return value;
  }

  return createUuid();
}

export function rowToCamel(
  row: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!row) {
    return null;
  }

  return Object.fromEntries(Object.entries(row).map(([key, value]: any) => [toCamelKey(key), value]));
}

export function rowsToCamel(
  rows: ReadonlyArray<Record<string, unknown>>,
): Array<Record<string, unknown> | null> {
  return rows.map((row: any) => rowToCamel(row));
}

export function toIso(value: unknown): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : String(value);
}

export function env(name: string): string {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

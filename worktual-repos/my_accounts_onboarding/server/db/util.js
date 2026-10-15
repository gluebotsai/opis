function toCamelKey(key) {
  return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function ensureUuid(value, createUuid) {
  if (isUuid(value)) {
    return value;
  }

  return createUuid();
}

export function rowToCamel(row) {
  if (!row) {
    return null;
  }

  return Object.fromEntries(Object.entries(row).map(([key, value]) => [toCamelKey(key), value]));
}

export function rowsToCamel(rows) {
  return rows.map((row) => rowToCamel(row));
}

export function toIso(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : String(value);
}

export function env(name) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

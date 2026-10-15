/**
 * Parse dim_known_users.traits_json or identify/login props for display fields.
 */

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

function readTrait(traits: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = trimStr(traits[key]);
    if (val) return val;
  }
  return "";
}

export function parseTraitsJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  const s = trimStr(raw);
  if (!s || s === "{}" || s === "null") return {};
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export interface ParsedIdentityTraits {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  method: string;
}

export function parseIdentityFromTraitsJson(raw: unknown): ParsedIdentityTraits {
  const traits = parseTraitsJson(raw);
  const nested =
    traits.traits && typeof traits.traits === "object" && !Array.isArray(traits.traits)
      ? (traits.traits as Record<string, unknown>)
      : {};

  const firstName = readTrait(traits, "firstName", "first_name") || readTrait(nested, "firstName", "first_name");
  const lastName = readTrait(traits, "lastName", "last_name") || readTrait(nested, "lastName", "last_name");
  let fullName =
    readTrait(traits, "name", "displayName", "fullName", "full_name")
    || readTrait(nested, "name", "displayName", "fullName", "full_name");
  if (!fullName && (firstName || lastName)) {
    fullName = `${firstName} ${lastName}`.trim();
  }

  const email = readTrait(traits, "email") || readTrait(nested, "email");
  const phone = readTrait(traits, "phone") || readTrait(nested, "phone");
  const method = readTrait(traits, "method") || readTrait(nested, "method");

  return { firstName, lastName, fullName, email, phone, method };
}

/** Shown when no name/email in CDP row (never generic "User"). */
export function customerLabelFromUserId(userId: string): string {
  const id = trimStr(userId);
  if (!id) return "Customer";
  if (id.includes("@")) return id;
  if (id.length <= 24) return id;
  return `Customer · ${id.slice(0, 8)}…`;
}

export function isGenericContactType(contactType: string): boolean {
  const t = trimStr(contactType).toLowerCase();
  return !t || t === "user" || t === "contact" || t === "customer";
}

/** Fallback labels like "Customer · cmujh38m…" — not a real account name. */
export function isObfuscatedCustomerLabel(label: string): boolean {
  const s = trimStr(label);
  if (!s) return false;
  if (/^customer\s*[·•]\s*\S/i.test(s)) return true;
  return s.toLowerCase() === "customer";
}

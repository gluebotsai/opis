/**
 * Parse dim_known_users.traits_json or identify/login props for display fields.
 */
function trimStr(v) {
    return String(v ?? "").trim();
}
function readTrait(traits, ...keys) {
    for (const key of keys) {
        const val = trimStr(traits[key]);
        if (val)
            return val;
    }
    return "";
}
export function parseTraitsJson(raw) {
    if (!raw)
        return {};
    if (typeof raw === "object" && !Array.isArray(raw)) {
        return raw;
    }
    const s = trimStr(raw);
    if (!s || s === "{}" || s === "null")
        return {};
    try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        /* ignore */
    }
    return {};
}
export function parseIdentityFromTraitsJson(raw) {
    const traits = parseTraitsJson(raw);
    const nested = traits.traits && typeof traits.traits === "object" && !Array.isArray(traits.traits)
        ? traits.traits
        : {};
    const firstName = readTrait(traits, "firstName", "first_name") || readTrait(nested, "firstName", "first_name");
    const lastName = readTrait(traits, "lastName", "last_name") || readTrait(nested, "lastName", "last_name");
    let fullName = readTrait(traits, "name", "displayName", "fullName", "full_name")
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
export function customerLabelFromUserId(userId) {
    const id = trimStr(userId);
    if (!id)
        return "Customer";
    if (id.includes("@"))
        return id;
    if (id.length <= 24)
        return id;
    return `Customer · ${id.slice(0, 8)}…`;
}
export function isGenericContactType(contactType) {
    const t = trimStr(contactType).toLowerCase();
    return !t || t === "user" || t === "contact" || t === "customer";
}
/** Fallback labels like "Customer · cmujh38m…" — not a real account name. */
export function isObfuscatedCustomerLabel(label) {
    const s = trimStr(label);
    if (!s)
        return false;
    if (/^customer\s*[·•]\s*\S/i.test(s))
        return true;
    return s.toLowerCase() === "customer";
}

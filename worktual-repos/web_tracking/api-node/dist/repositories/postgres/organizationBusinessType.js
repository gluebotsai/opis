import { normalizeBusinessType } from "../../utils/organizationBusinessType.js";
const CACHE_TTL_MS = 60_000;
const cache = new Map();
/**
 * Read-only: SELECT business_type FROM accounts.organizations WHERE id = {organizationId}
 * No INSERT/UPDATE/DELETE. Parameterized organization id only.
 */
export async function getOrganizationBusinessType(prisma, organizationId) {
    const id = Number(organizationId);
    if (!Number.isInteger(id) || id <= 0)
        return null;
    const now = Date.now();
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now)
        return hit.value;
    try {
        const rows = await prisma.$queryRaw `
      SELECT business_type FROM accounts.organizations WHERE id = ${id}
    `;
        const value = normalizeBusinessType(rows[0]?.business_type);
        cache.set(id, { value, expiresAt: now + CACHE_TTL_MS });
        return value;
    }
    catch {
        cache.set(id, { value: null, expiresAt: now + 5_000 });
        return null;
    }
}

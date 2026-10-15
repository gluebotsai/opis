import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { attachDefaultWebsite, findCustomerByEmail, findCustomerById, findWebsitesForOrganization, hasWebTrackingAccess, } from "./myAccountsAuth.js";
export { attachDefaultWebsite, findCustomerByEmail, findCustomerById, findWebsitesForOrganization, hasWebTrackingAccess, };
export async function verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}
function useMyAccountsAuth() {
    return env.AUTH_SOURCE === "my_accounts";
}
async function legacyFindByEmail(prisma, email) {
    const row = await prisma.adminAccount.findFirst({
        where: { email, isActive: true },
    });
    if (!row)
        return null;
    return {
        id: Number(row.id),
        email: row.email,
        passwordHash: row.passwordHash,
        adminName: row.adminName,
        organizationId: row.organizationId,
        websiteId: row.websiteId,
        websiteUrl: row.websiteUrl,
        siteType: row.siteType,
        createdAt: row.createdAt,
    };
}
async function legacyFindById(prisma, id) {
    const row = await prisma.adminAccount.findUnique({ where: { id: BigInt(id) } });
    if (!row || !row.isActive)
        return null;
    return {
        id: Number(row.id),
        email: row.email,
        passwordHash: row.passwordHash,
        adminName: row.adminName,
        organizationId: row.organizationId,
        websiteId: row.websiteId,
        websiteUrl: row.websiteUrl,
        siteType: row.siteType,
        createdAt: row.createdAt,
    };
}
/** @deprecated use findAuthUserByEmail */
export const findAdminByEmail = findAuthUserByEmail;
export async function findAuthUserByEmail(prisma, email) {
    if (!useMyAccountsAuth()) {
        return legacyFindByEmail(prisma, email);
    }
    const customer = await findCustomerByEmail(prisma, email);
    if (!customer?.organizationId)
        return null;
    const websites = await findWebsitesForOrganization(prisma, customer.organizationId);
    return attachDefaultWebsite(customer, websites);
}
/** @deprecated use findAuthUserById */
export const findAdminById = findAuthUserById;
export async function findAuthUserById(prisma, id, preferredWebsiteId) {
    if (!useMyAccountsAuth()) {
        return legacyFindById(prisma, id);
    }
    const customer = await findCustomerById(prisma, id);
    if (!customer?.organizationId)
        return null;
    const websites = await findWebsitesForOrganization(prisma, customer.organizationId);
    return attachDefaultWebsite(customer, websites, preferredWebsiteId);
}
export async function isWebsiteRegistered(prisma, websiteId) {
    if (!useMyAccountsAuth()) {
        const row = await prisma.adminAccount.findFirst({
            where: { websiteId, isActive: true },
            select: { id: true },
        });
        return row !== null;
    }
    const rows = await prisma.$queryRaw(Prisma.sql `
    WITH live AS (
      SELECT entitlement_config AS config
      FROM accounts.subscriptions
      WHERE product_id = 'web-tracking'
        AND status <> 'cancelled'
    ),
    prelive AS (
      SELECT ap.config
      FROM accounts.active_products ap
      JOIN accounts.product_go_live pgl
        ON pgl.lead_id = ap.lead_id
       AND pgl.product_id = ap.product_id
       AND pgl.branch_id = ap.branch_id
      WHERE ap.product_id = 'web-tracking'
    ),
    configs AS (
      SELECT config FROM live
      UNION ALL
      SELECT config FROM prelive
    )
    SELECT EXISTS (
      SELECT 1
      FROM configs c,
      LATERAL jsonb_each(
        CASE
          WHEN jsonb_typeof(c.config->'visitorAllowanceBySlot') = 'object'
          THEN c.config->'visitorAllowanceBySlot'
          ELSE '{}'::jsonb
        END
      ) AS slot(key, value)
      WHERE slot.key = ${String(websiteId)}
        AND coalesce(slot.value->>'url', '') <> ''
    ) AS found
  `);
    return Boolean(rows[0]?.found);
}
/** @deprecated use isWebsiteRegistered */
export const isDomainRegistered = isWebsiteRegistered;
export async function findWebsitesByOrganizationId(prisma, organizationId) {
    if (!useMyAccountsAuth()) {
        const rows = await prisma.adminAccount.findMany({
            where: { organizationId, isActive: true },
            select: { websiteId: true, websiteUrl: true, siteType: true },
            orderBy: { websiteUrl: "asc" },
        });
        return rows.map((row) => ({
            websiteId: row.websiteId,
            websiteUrl: row.websiteUrl,
            siteType: row.siteType,
            label: null,
        }));
    }
    return findWebsitesForOrganization(prisma, organizationId);
}
export async function findWebsiteInOrganization(prisma, organizationId, websiteId) {
    const websites = await findWebsitesByOrganizationId(prisma, organizationId);
    return websites.find((w) => w.websiteId === websiteId) ?? null;
}

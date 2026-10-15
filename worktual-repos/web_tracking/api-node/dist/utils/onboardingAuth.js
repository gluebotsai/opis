import { timingSafeEqual } from "node:crypto";
import { env, corsOrigins } from "../config/env.js";
import { attachDefaultWebsite, findCustomerById, findWebsitesForOrganization, hasWebTrackingAccess, } from "../repositories/postgres/authRepository.js";
function secretsEqual(provided, expected) {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
export function onboardingServerSecret() {
    return env.INTERNAL_SERVICE_KEY?.trim() || undefined;
}
export function isOnboardingRedirectEnabled() {
    return env.AUTH_SOURCE === "my_accounts" && Boolean(onboardingServerSecret());
}
export function verifyOnboardingServerSecret(request) {
    const expected = onboardingServerSecret();
    if (!expected)
        return false;
    const internalKey = request.headers["x-internal-service-key"];
    if (typeof internalKey !== "string")
        return false;
    return secretsEqual(internalKey, expected);
}
export function dashboardPublicUrl() {
    const configured = env.DASHBOARD_PUBLIC_URL?.trim();
    if (configured)
        return configured.replace(/\/$/, "");
    const origins = corsOrigins();
    return (origins[0] ?? "http://localhost:7862").replace(/\/$/, "");
}
function mapWebsites(rows) {
    return rows.map((row) => ({
        website_id: row.websiteId,
        website_url: row.websiteUrl,
        site_type: row.siteType,
    }));
}
/** Same eligibility as POST /api/auth/login (My Accounts), without password check. */
export async function resolveMyAccountsOnboardingSession(prisma, input) {
    const row = await findCustomerById(prisma, input.user_id);
    if (!row) {
        return { ok: false, status: 403, detail: "User is not eligible for Web Tracking login (password not set or account inactive)" };
    }
    if (row.email.toLowerCase() !== input.email.trim().toLowerCase()) {
        return { ok: false, status: 403, detail: "Email does not match user_id" };
    }
    if (row.organizationId !== input.organization_id) {
        return { ok: false, status: 403, detail: "organization_id does not match user" };
    }
    if (!row.organizationId) {
        return { ok: false, status: 403, detail: "No organization linked to this account" };
    }
    const hasAccess = await hasWebTrackingAccess(prisma, row.id);
    if (!hasAccess) {
        return {
            ok: false,
            status: 403,
            detail: "No Web Tracking access for this account. Ask an admin to assign a Web Tracking role in Setup People.",
        };
    }
    const websiteRows = await findWebsitesForOrganization(prisma, row.organizationId);
    if (!websiteRows.length) {
        return {
            ok: false,
            status: 403,
            detail: "No Web Tracking websites configured for this organization. Save website URLs in My Accounts setup first.",
        };
    }
    if (input.website_id != null) {
        const allowed = websiteRows.some((w) => w.websiteId === input.website_id);
        if (!allowed) {
            return { ok: false, status: 403, detail: "website_id is not part of this organization" };
        }
    }
    const customer = attachDefaultWebsite(row, websiteRows, input.website_id);
    if (!customer) {
        return { ok: false, status: 403, detail: "No valid Web Tracking website URLs found" };
    }
    return { ok: true, customer, websites: mapWebsites(websiteRows) };
}
export async function resolveOnboardingSessionFromCode(prisma, payload) {
    const row = await findCustomerById(prisma, payload.userId);
    if (!row?.organizationId || row.organizationId !== payload.organizationId) {
        return { ok: false, status: 403, detail: "User is no longer eligible for Web Tracking login" };
    }
    return resolveMyAccountsOnboardingSession(prisma, {
        user_id: payload.userId,
        email: row.email,
        organization_id: payload.organizationId,
        website_id: payload.websiteId,
    });
}

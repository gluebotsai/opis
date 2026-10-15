import type { FastifyRequest } from "fastify";
import type { AppPrismaClient } from "../plugins/prisma.js";
import type { AuthUser } from "../repositories/postgres/authTypes.js";
import { findWebsitesForOrganization } from "../repositories/postgres/authRepository.js";
export declare function onboardingServerSecret(): string | undefined;
export declare function isOnboardingRedirectEnabled(): boolean;
export declare function verifyOnboardingServerSecret(request: FastifyRequest): boolean;
export declare function dashboardPublicUrl(): string;
export type ResolvedOnboardingSession = {
    ok: true;
    customer: AuthUser;
    websites: ReturnType<typeof mapWebsites>;
} | {
    ok: false;
    status: number;
    detail: string;
};
declare function mapWebsites(rows: Awaited<ReturnType<typeof findWebsitesForOrganization>>): Array<{
    website_id: number;
    website_url: string;
    site_type: string;
}>;
/** Same eligibility as POST /api/auth/login (My Accounts), without password check. */
export declare function resolveMyAccountsOnboardingSession(prisma: AppPrismaClient, input: {
    user_id: number;
    email: string;
    organization_id: number;
    website_id?: number;
}): Promise<ResolvedOnboardingSession>;
export declare function resolveOnboardingSessionFromCode(prisma: AppPrismaClient, payload: {
    userId: number;
    organizationId: number;
    websiteId: number;
}): Promise<ResolvedOnboardingSession>;
export {};

/**
 * Read-only My Accounts auth (worktual_bigint / accounts schema).
 * Analytics dashboard login uses Setup People (setup_users), not customer_users.
 * See WEB_TRACKING_REFERENCE.md sections 2, 5, 9, 12.
 */
import type { AppPrismaClient } from "../../plugins/prisma.js";
import type { AuthUser, WebsiteRow } from "./authTypes.js";
export declare function findCustomerByEmail(prisma: AppPrismaClient, email: string): Promise<Omit<AuthUser, "websiteId" | "websiteUrl" | "siteType"> | null>;
export declare function findCustomerById(prisma: AppPrismaClient, id: number): Promise<Omit<AuthUser, "websiteId" | "websiteUrl" | "siteType"> | null>;
export declare function hasWebTrackingAccess(prisma: AppPrismaClient, userId: number): Promise<boolean>;
/** Websites from subscriptions (live) or active_products + product_go_live (pre-live). */
export declare function findWebsitesForOrganization(prisma: AppPrismaClient, organizationId: number): Promise<WebsiteRow[]>;
export declare function attachDefaultWebsite(user: Omit<AuthUser, "websiteId" | "websiteUrl" | "siteType">, websites: WebsiteRow[], preferredWebsiteId?: number): AuthUser | null;

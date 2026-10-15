import type { AppPrismaClient } from "../../plugins/prisma.js";
import type { AuthUser, WebsiteRow } from "./authTypes.js";
import { attachDefaultWebsite, findCustomerByEmail, findCustomerById, findWebsitesForOrganization, hasWebTrackingAccess } from "./myAccountsAuth.js";
export { attachDefaultWebsite, findCustomerByEmail, findCustomerById, findWebsitesForOrganization, hasWebTrackingAccess, };
export type { AuthUser, WebsiteRow };
export declare function verifyPassword(plain: string, hash: string): Promise<boolean>;
/** @deprecated use findAuthUserByEmail */
export declare const findAdminByEmail: typeof findAuthUserByEmail;
export declare function findAuthUserByEmail(prisma: AppPrismaClient, email: string): Promise<AuthUser | null>;
/** @deprecated use findAuthUserById */
export declare const findAdminById: typeof findAuthUserById;
export declare function findAuthUserById(prisma: AppPrismaClient, id: number, preferredWebsiteId?: number): Promise<AuthUser | null>;
export declare function isWebsiteRegistered(prisma: AppPrismaClient, websiteId: number): Promise<boolean>;
/** @deprecated use isWebsiteRegistered */
export declare const isDomainRegistered: typeof isWebsiteRegistered;
export declare function findWebsitesByOrganizationId(prisma: AppPrismaClient, organizationId: number): Promise<WebsiteRow[]>;
export declare function findWebsiteInOrganization(prisma: AppPrismaClient, organizationId: number, websiteId: number): Promise<WebsiteRow | null>;

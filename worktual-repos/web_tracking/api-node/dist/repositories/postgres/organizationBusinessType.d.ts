import type { AppPrismaClient } from "../../plugins/prisma.js";
import { type OrganizationBusinessType } from "../../utils/organizationBusinessType.js";
/**
 * Read-only: SELECT business_type FROM accounts.organizations WHERE id = {organizationId}
 * No INSERT/UPDATE/DELETE. Parameterized organization id only.
 */
export declare function getOrganizationBusinessType(prisma: AppPrismaClient, organizationId: number | null | undefined): Promise<OrganizationBusinessType | null>;

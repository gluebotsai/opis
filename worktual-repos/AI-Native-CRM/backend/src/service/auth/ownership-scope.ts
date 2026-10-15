import type { CompanyChannelRole } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  canViewAllRecords,
  type AppRole,
} from "@/service/auth/rbac";
import {
  ForbiddenError,
  getCurrentOrganizationId,
  getCurrentUserRole,
} from "@/service/auth/require-role";

export type RecordOwnerScope = {
  userId: string | null;
  role: AppRole;
  /** When set, list queries must filter to this owner. Null = see all (manager/admin/finance). */
  ownerUserId: string | null;
  /**
   * Franchise / channel company ids the user may see.
   * Null = no channel restriction (org-wide roles, or user owns no channel companies).
   */
  channelCompanyIds: string[] | null;
};

/** Matches no real user — used to fail closed when the session cookie is missing. */
export const UNOWNED_SCOPE_SENTINEL = "0";

const CHANNEL_SCOPED_ROLES: CompanyChannelRole[] = [
  "franchise",
  "owned_store",
  "brand_hq",
];

/**
 * Companies this user owns as franchise / owned store / brand HQ, plus children.
 * Returns null when the user has no channel companies (fall back to owner-only).
 */
export async function resolveChannelCompanyIdsForUser(
  userId: string,
  organizationId: string,
): Promise<string[] | null> {
  const owned = await prisma.company.findMany({
    where: {
      organizationId,
      ownerUserId: userId,
      channelRole: { in: CHANNEL_SCOPED_ROLES },
    },
    select: { id: true },
  });
  if (owned.length === 0) return null;
  const ownedIds = owned.map((c) => c.id);
  const children = await prisma.company.findMany({
    where: {
      organizationId,
      parentCompanyId: { in: ownedIds },
    },
    select: { id: true },
  });
  return [...new Set([...ownedIds, ...children.map((c) => c.id)])];
}

/**
 * Default list scope: reps/viewers/marketing see only their records;
 * admin, sales_manager, and finance see org-wide.
 * Channel companies expand franchise visibility within the same tenant.
 * Missing session fails closed (empty lists), never org-wide.
 */
export async function resolveRecordOwnerScope(): Promise<RecordOwnerScope> {
  const userId = await getServerUserId();
  const role = await getCurrentUserRole();
  if (!userId) {
    return {
      userId: null,
      role,
      ownerUserId: UNOWNED_SCOPE_SENTINEL,
      channelCompanyIds: null,
    };
  }
  if (canViewAllRecords(role)) {
    return { userId, role, ownerUserId: null, channelCompanyIds: null };
  }
  let channelCompanyIds: string[] | null = null;
  try {
    const organizationId = await getCurrentOrganizationId();
    channelCompanyIds = await resolveChannelCompanyIdsForUser(
      userId,
      organizationId,
    );
  } catch {
    channelCompanyIds = null;
  }
  return { userId, role, ownerUserId: userId, channelCompanyIds };
}

/**
 * Throws if the signed-in user cannot mutate a record owned by `ownerUserId`.
 * Managers/admins/finance (canViewAllRecords) may mutate any record.
 * Creators may access records they created even when the lead is still pooled.
 * Channel-scoped users may also access records linked to their franchise companies
 * when `companyId` is provided.
 */
export async function assertRecordAccess(
  ownerUserId: string | null | undefined,
  message = "You do not have access to this record.",
  companyId?: string | null,
  createdByUserId?: string | null,
): Promise<RecordOwnerScope> {
  const scope = await resolveRecordOwnerScope();
  if (!scope.userId) {
    throw new ForbiddenError("Sign in again.");
  }
  if (canViewAllRecords(scope.role)) {
    return scope;
  }
  if (createdByUserId && createdByUserId === scope.userId) {
    return scope;
  }
  if (ownerUserId && ownerUserId !== scope.userId) {
    const coId = companyId?.trim();
    if (
      coId &&
      scope.channelCompanyIds &&
      scope.channelCompanyIds.includes(coId)
    ) {
      return scope;
    }
    throw new ForbiddenError(message);
  }
  return scope;
}

/**
 * View access for a company: own / pool / org-wide roles, or linked via a
 * contact or deal the user owns (assigned lead's account), or channel child.
 */
export async function assertCompanyViewAccess(company: {
  id: string;
  ownerUserId: string | null | undefined;
}): Promise<RecordOwnerScope> {
  const scope = await resolveRecordOwnerScope();
  if (!scope.userId) {
    throw new ForbiddenError("Sign in again.");
  }
  if (canViewAllRecords(scope.role)) {
    return scope;
  }
  if (!company.ownerUserId || company.ownerUserId === scope.userId) {
    return scope;
  }
  if (
    scope.channelCompanyIds &&
    scope.channelCompanyIds.includes(company.id)
  ) {
    return scope;
  }

  const linked = await prisma.company.findFirst({
    where: {
      id: company.id,
      OR: [
        { contactProfiles: { some: { ownerUserId: scope.userId } } },
        { contactProfiles: { some: { createdByUserId: scope.userId } } },
        { deals: { some: { ownerUserId: scope.userId } } },
      ],
    },
    select: { id: true },
  });
  if (!linked) {
    throw new ForbiddenError("You do not have access to this company.");
  }
  return scope;
}

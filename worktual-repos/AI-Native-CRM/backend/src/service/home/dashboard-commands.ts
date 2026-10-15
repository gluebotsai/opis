/**
 * Framework-agnostic home dashboard + admin ops mutations for Fastify Wave 10.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import { listAssignableUsers } from "@/service/account/user-directory";
import {
  canAssignContactOwner,
  canAssignDealOwner,
} from "@/service/auth/rbac";
import {
  ForbiddenError,
  requireRole,
} from "@/service/auth/require-role";
import { assertRecordAccess } from "@/service/auth/ownership-scope";
import { updateContact, getContact } from "@/dao/contacts/contact-service";
import { updateDealOwner, getDeal } from "@/dao/sales/deal-service";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { notifyCustomerOfOwnerChangeAsync } from "@/service/contacts/owner-change-notify";
import {
  getHomeDashboard,
  type HomeDashboardData,
} from "@/dao/home/home-dashboard";
import type { AdminOpsQuery } from "@/dao/home/admin-ops-dashboard";
import { refreshFunnelSnapshotCommand } from "@/service/reports/report-commands";

export type CommandResult =
  | { ok: true; assigned?: number }
  | { ok: false; error: string };

export async function getHomeDashboardCommand(
  query: AdminOpsQuery = {},
): Promise<HomeDashboardData> {
  return getHomeDashboard(query);
}

export async function refreshHomeAnalyticsCommand(): Promise<
  | { ok: true; generatedAt: string }
  | { ok: false; error: string }
> {
  return refreshFunnelSnapshotCommand();
}

async function assertAssignableOwner(ownerUserId: string): Promise<void> {
  const selfId = await getServerUserId();
  if (selfId && ownerUserId === selfId) return;
  const assignable = await listAssignableUsers();
  if (!assignable.some((u) => u.id === ownerUserId)) {
    throw new ForbiddenError(
      "Selected owner is not a sales user in your organization.",
    );
  }
}

export async function bulkAssignLeadsCommand(input: {
  contactIds: string[];
  ownerUserId: string;
}): Promise<CommandResult> {
  try {
    await requireRole(
      canAssignContactOwner,
      "Only admins and sales managers can bulk-assign leads.",
    );
    const ownerUserId = input.ownerUserId?.trim();
    if (!ownerUserId) return { ok: false, error: "Select a rep to assign." };
    const ids = [...new Set(input.contactIds.filter(Boolean))];
    if (ids.length === 0) {
      return { ok: false, error: "Select at least one lead." };
    }

    await assertAssignableOwner(ownerUserId);

    let assigned = 0;
    for (const id of ids) {
      const existing = await getContact(id);
      if (!existing) continue;
      await assertRecordAccess(existing.crm.ownerUserId);
      const previousOwnerUserId = existing.crm.ownerUserId?.trim() || null;
      await updateContact(id, { ownerUserId });
      assigned += 1;
      notifyCustomerOfOwnerChangeAsync({
        contactId: id,
        organizationId: await resolveRequestOrganizationId(
          existing.person.organizationId,
        ),
        newOwnerUserId: ownerUserId,
        previousOwnerUserId,
      });
    }

    return { ok: true, assigned };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Bulk assign failed.",
    };
  }
}

export async function autoAssignUntouchedLeadsCommand(input: {
  contactIds: string[];
}): Promise<CommandResult> {
  try {
    await requireRole(
      canAssignContactOwner,
      "Only admins and sales managers can auto-assign leads.",
    );
    const ids = [...new Set(input.contactIds.filter(Boolean))];
    if (ids.length === 0) {
      return { ok: false, error: "No untouched leads to assign." };
    }

    const assignable = await listAssignableUsers();
    const pool =
      assignable.filter((u) => u.role === "sales_rep").length > 0
        ? assignable.filter((u) => u.role === "sales_rep")
        : assignable;
    if (pool.length === 0) {
      return { ok: false, error: "No sales reps available for auto-assign." };
    }

    let assigned = 0;
    for (let i = 0; i < ids.length; i += 1) {
      const ownerUserId = pool[i % pool.length]!.id;
      const existing = await getContact(ids[i]!);
      if (!existing) continue;
      await assertRecordAccess(existing.crm.ownerUserId);
      const previousOwnerUserId = existing.crm.ownerUserId?.trim() || null;
      await updateContact(ids[i]!, { ownerUserId });
      assigned += 1;
      notifyCustomerOfOwnerChangeAsync({
        contactId: ids[i]!,
        organizationId: await resolveRequestOrganizationId(
          existing.person.organizationId,
        ),
        newOwnerUserId: ownerUserId,
        previousOwnerUserId,
      });
    }

    return { ok: true, assigned };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Auto-assign failed.",
    };
  }
}

export async function reassignDealCommand(input: {
  dealId: string;
  ownerUserId: string;
}): Promise<CommandResult> {
  try {
    await requireRole(
      canAssignDealOwner,
      "Only admins and sales managers can reassign deals.",
    );
    const ownerUserId = input.ownerUserId?.trim();
    if (!ownerUserId) return { ok: false, error: "Select a rep." };
    if (!input.dealId) return { ok: false, error: "Deal is required." };

    const existing = await getDeal(input.dealId);
    if (!existing) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(existing.ownerUserId);
    await assertAssignableOwner(ownerUserId);

    const previousOwnerUserId = existing.ownerUserId?.trim() || null;
    await updateDealOwner(input.dealId, ownerUserId, {
      actorUserId: await getServerUserId(),
    });

    if (existing.contactId?.trim()) {
      notifyCustomerOfOwnerChangeAsync({
        contactId: existing.contactId.trim(),
        organizationId: await resolveRequestOrganizationId(existing.organizationId),
        newOwnerUserId: ownerUserId,
        previousOwnerUserId,
      });
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Reassign failed.",
    };
  }
}

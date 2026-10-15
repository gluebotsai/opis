/**
 * Targeted notifications for named recipients. Operational CRM events go to
 * the assigned owner (`notify-admins`); use this helper when the caller already
 * knows the recipient list. Escalations still include admins.
 */

import { accountQuery } from "@/dao/db/account-pool";
import { listAdminUsers } from "@/service/account/user-directory";
import {
  insertNotifications,
  type NotificationRow,
} from "@/dao/notifications/notification-store";
import { publishUserNotification } from "@/service/notifications/notification-events";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

export type NotifyUsersInput = {
  organizationId?: string | null;
  recipientUserIds: Array<string | null | undefined>;
  kind: string;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  contactId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Keep deleted / deactivated users out of the bell. */
export async function filterActiveUserIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    const { rows } = await accountQuery<{ id: string }>(
      `SELECT id::text AS id
       FROM accounts.setup_users
       WHERE id = ANY($1::bigint[])
         AND status = 'active'`,
      [ids],
    );
    return rows.map((r) => r.id);
  } catch (err) {
    console.error("filterActiveUserIds failed", err);
    return [];
  }
}

export async function notifyUsers(
  input: NotifyUsersInput,
): Promise<NotificationRow[]> {
  try {
    const organizationId = await resolveRequestOrganizationId(input.organizationId);
    const requested = [
      ...new Set(
        input.recipientUserIds.filter((id): id is string => Boolean(id?.trim())),
      ),
    ];
    const recipients = await filterActiveUserIds(requested);
    if (recipients.length === 0) return [];

    const created = await insertNotifications(
      recipients.map((recipientUserId) => ({
        organizationId,
        recipientUserId,
        actorUserId: input.actorUserId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        contactId: input.contactId ?? null,
        metadata: input.metadata ?? null,
      })),
    );

    for (const row of created) {
      publishUserNotification({
        userId: row.recipientUserId,
        organizationId,
        notificationId: row.id,
        kind: row.kind,
      });
    }
    return created;
  } catch (err) {
    console.error("notifyUsers failed", err);
    return [];
  }
}

/**
 * Route an escalation to the lead's sales owner. Falls back to org admins when
 * the contact is unassigned or its owner is no longer active.
 */
export async function notifyOwnerOrAdmins(
  input: Omit<NotifyUsersInput, "recipientUserIds"> & {
    ownerUserId?: string | null;
  },
): Promise<{ recipients: NotificationRow[]; targetedOwner: boolean }> {
  const organizationId = await resolveRequestOrganizationId(input.organizationId);
  const owner = input.ownerUserId?.trim() || null;

  if (owner) {
    const active = await filterActiveUserIds([owner]);
    if (active.length > 0) {
      const rows = await notifyUsers({
        ...input,
        organizationId,
        recipientUserIds: active,
      });
      if (rows.length > 0) return { recipients: rows, targetedOwner: true };
    }
  }

  const admins = await listAdminUsers(organizationId);
  const rows = await notifyUsers({
    ...input,
    organizationId,
    recipientUserIds: admins.map((a) => a.id),
  });
  return { recipients: rows, targetedOwner: false };
}

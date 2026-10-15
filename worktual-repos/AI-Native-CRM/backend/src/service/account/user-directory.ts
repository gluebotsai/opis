import { prisma } from "@/dao/db/prisma";
import {
  meetingInviteEmail,
  meetingTeamRoleLabel,
  teamMemberMatchesQuery,
} from "@/lib/meeting-participants";
import {
  displayNameFromSetupUser,
  listSetupUsersForOrg,
} from "@/service/account/setup-users";
import { parseCrmRole, type AppRole } from "@/service/auth/rbac";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

export type AssignableUser = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  label: string;
};

const SALES_OWNER_ROLES = new Set<AppRole>([
  "admin",
  "sales_manager",
  "sales_rep",
  "presales",
]);

function toAssignable(row: {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  crm_role_name: string | null;
}): AssignableUser | null {
  const role = parseCrmRole(row.crm_role_name);
  if (!role) return null;
  const name = displayNameFromSetupUser(row);
  const label = `${name} (${role.replace(/_/g, " ")})`;
  return {
    id: row.id,
    email: row.email,
    name,
    role,
    label,
  };
}

/** Active org users who have a real CRM product role. Missing or unknown roles are omitted. */
export function directoryUsersFromSetupRows(
  rows: Array<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    crm_role_name: string | null;
  }>,
): AssignableUser[] {
  const users: AssignableUser[] = [];
  for (const row of rows) {
    const user = toAssignable(row);
    if (user) users.push(user);
  }
  return users;
}

/** Users who can own contacts/deals in the current org (sales-capable CRM roles). */
export async function listAssignableUsers(
  organizationId?: string | null,
): Promise<AssignableUser[]> {
  const orgId = await resolveRequestOrganizationId(organizationId);

  try {
    const rows = await listSetupUsersForOrg(orgId);
    return directoryUsersFromSetupRows(rows).filter((u) =>
      SALES_OWNER_ROLES.has(u.role),
    );
  } catch (err) {
    console.error("listAssignableUsers failed", err);
    return [];
  }
}

/** Organization admins — escalation / unassigned-notification fallback. */
export async function listAdminUsers(
  organizationId?: string | null,
): Promise<AssignableUser[]> {
  const orgId = await resolveRequestOrganizationId(organizationId);

  try {
    const rows = await listSetupUsersForOrg(orgId);
    return directoryUsersFromSetupRows(rows).filter((u) => u.role === "admin");
  } catch (err) {
    console.error("listAdminUsers failed", err);
    return [];
  }
}

/** Finance role users — discount-approval / billing escalation recipients. */
export async function listFinanceUsers(
  organizationId?: string | null,
): Promise<AssignableUser[]> {
  const orgId = await resolveRequestOrganizationId(organizationId);

  try {
    const rows = await listSetupUsersForOrg(orgId);
    return directoryUsersFromSetupRows(rows).filter((u) => u.role === "finance");
  } catch (err) {
    console.error("listFinanceUsers failed", err);
    return [];
  }
}

/** Sales managers — closest thing to a sales hierarchy in this CRM. */
export async function listSalesManagerUsers(
  organizationId?: string | null,
): Promise<AssignableUser[]> {
  const orgId = await resolveRequestOrganizationId(organizationId);

  try {
    const rows = await listSetupUsersForOrg(orgId);
    return directoryUsersFromSetupRows(rows).filter(
      (u) => u.role === "sales_manager",
    );
  } catch (err) {
    console.error("listSalesManagerUsers failed", err);
    return [];
  }
}

export type EscalationRecipientVia =
  | "sales_manager"
  | "admin"
  | "sales_manager_admin";

export function mergeEscalationRecipients(
  managers: AssignableUser[],
  admins: AssignableUser[],
): { recipients: AssignableUser[]; via: EscalationRecipientVia } {
  const byId = new Map<string, AssignableUser>();
  for (const user of managers) byId.set(user.id, user);
  for (const user of admins) {
    if (!byId.has(user.id)) byId.set(user.id, user);
  }
  const hasManagers = managers.length > 0;
  const hasAdmins = admins.length > 0;
  const via: EscalationRecipientVia =
    hasManagers && hasAdmins
      ? "sales_manager_admin"
      : hasManagers
        ? "sales_manager"
        : "admin";
  return { recipients: [...byId.values()], via };
}

export function escalationRecipientViaLabel(via: EscalationRecipientVia): string {
  if (via === "sales_manager") return "sales managers";
  if (via === "sales_manager_admin") {
    return "sales managers and organization admins";
  }
  return "organization admins";
}

/**
 * MOM / leadership recipients: sales managers and org admins (union).
 * Falls back to whichever role exists. Dedupes users who match both lists.
 */
export async function listMeetingEscalationRecipients(
  organizationId?: string | null,
): Promise<{ recipients: AssignableUser[]; via: EscalationRecipientVia }> {
  const [managers, admins] = await Promise.all([
    listSalesManagerUsers(organizationId),
    listAdminUsers(organizationId),
  ]);
  return mergeEscalationRecipients(managers, admins);
}

export async function getUserLabelsByIds(
  userIds: Array<string | number | bigint | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      userIds
        .map((id) =>
          id == null || id === ""
            ? ""
            : typeof id === "string"
              ? id.trim()
              : String(id).trim(),
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  try {
    const { accountQuery } = await import("@/dao/db/account-pool");
    const { rows } = await accountQuery<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
    }>(
      `SELECT id::text AS id, lower(work_email) AS email, first_name, last_name
       FROM accounts.setup_users
       WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    for (const row of rows) {
      map.set(row.id, displayNameFromSetupUser(row));
    }
  } catch (err) {
    console.error("getUserLabelsByIds failed", err);
  }
  return map;
}

export type MeetingTeamOption = {
  id: string;
  displayName: string;
  email: string;
  detail: string;
};

/** Every active CRM user in the org can be added to a meeting invite. */
export async function searchMeetingTeam(
  query?: string,
): Promise<MeetingTeamOption[]> {
  const orgId = await resolveRequestOrganizationId();
  const rows = await listSetupUsersForOrg(orgId);
  const team = directoryUsersFromSetupRows(rows);
  if (team.length === 0) return [];

  let organizationId: bigint | null = null;
  try {
    organizationId = BigInt(orgId);
  } catch {
    organizationId = null;
  }
  const userIds: bigint[] = [];
  for (const user of team) {
    try {
      userIds.push(BigInt(user.id));
    } catch {
      /* skip */
    }
  }
  const configured = new Map<string, string>();
  if (organizationId != null && userIds.length) {
    const connections = await prisma.userIntegrationConnection.findMany({
      where: {
        organizationId,
        provider: "google",
        userId: { in: userIds },
      },
      select: { userId: true, accountEmail: true },
    });
    for (const connection of connections) {
      const email = connection.accountEmail?.trim().toLowerCase() || "";
      if (email.includes("@")) configured.set(String(connection.userId), email);
    }
  }

  const matches: MeetingTeamOption[] = [];
  for (const user of team) {
    const inviteEmail = meetingInviteEmail({
      workEmail: user.email,
      configuredEmail: configured.get(user.id),
    });
    if (!inviteEmail.includes("@")) continue;
    if (
      !teamMemberMatchesQuery({
        name: user.name,
        workEmail: user.email,
        inviteEmail,
        query: query || "",
      })
    ) {
      continue;
    }
    matches.push({
      id: `team:${user.id}`,
      displayName: user.name,
      email: inviteEmail,
      detail: meetingTeamRoleLabel(user.role),
    });
    if (matches.length >= 40) break;
  }
  return matches;
}

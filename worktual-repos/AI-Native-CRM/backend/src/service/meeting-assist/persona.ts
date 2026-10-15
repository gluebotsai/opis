/**
 * Live Meeting Assist personas — map CRM roles to sales vs presales coaching.
 */

import { getSetupUserById } from "@/service/account/setup-users";
import { parseCrmRole, type AppRole } from "@/service/auth/rbac";

export type AssistPersona = "sales" | "presales";

/** CRM roles that receive live customer-meeting Assist when their panel is open. */
export function assistPersonaForRole(role: AppRole): AssistPersona | null {
  if (role === "presales") return "presales";
  if (role === "sales_rep" || role === "sales_manager" || role === "admin") {
    return "sales";
  }
  return null;
}

export async function assistPersonaForUserId(
  userId: string,
): Promise<AssistPersona | null> {
  const row = await getSetupUserById(userId);
  if (!row) return null;
  const role = parseCrmRole(row.crm_role_name);
  if (!role) return null;
  return assistPersonaForRole(role);
}

/** Group viewer user ids by assist persona (presales vs sales). */
export async function groupViewerIdsByPersona(
  viewerIds: string[],
): Promise<Map<AssistPersona, string[]>> {
  const groups = new Map<AssistPersona, string[]>();
  for (const id of viewerIds) {
    const persona = await assistPersonaForUserId(id);
    if (!persona) continue;
    const list = groups.get(persona) ?? [];
    if (!list.includes(id)) list.push(id);
    groups.set(persona, list);
  }
  return groups;
}

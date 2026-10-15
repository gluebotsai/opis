import type { AppRole } from "@/service/auth/rbac";

export function meetingTeamRoleLabel(role: AppRole): string {
  if (role === "presales") return "Pre-sales";
  if (role === "sales_manager") return "Sales manager";
  if (role === "sales_rep") return "Sales";
  if (role === "admin") return "Admin";
  if (role === "marketing") return "Marketing";
  if (role === "finance") return "Finance";
  if (role === "viewer") return "Viewer";
  return "Team";
}

/** Calendar guest address. Configured Google mailbox is how the person joins Meet. */
export function meetingInviteEmail(input: {
  workEmail: string;
  configuredEmail?: string | null;
}): string {
  const configured = input.configuredEmail?.trim().toLowerCase() || "";
  if (configured.includes("@")) return configured;
  return input.workEmail.trim().toLowerCase();
}

export function teamMemberMatchesQuery(input: {
  name: string;
  workEmail: string;
  inviteEmail: string;
  query: string;
}): boolean {
  const q = input.query.trim().toLowerCase();
  if (!q) return true;
  return (
    input.name.toLowerCase().includes(q) ||
    input.workEmail.toLowerCase().includes(q) ||
    input.inviteEmail.toLowerCase().includes(q)
  );
}

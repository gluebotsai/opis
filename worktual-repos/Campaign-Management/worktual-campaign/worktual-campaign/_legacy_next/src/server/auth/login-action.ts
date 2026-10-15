"use server";

import { redirect } from "next/navigation";
import type { CampaignSessionUser } from "@/server/auth/types";
import {
  authenticateCampaignUser,
} from "@/server/auth/auth-service";
import {
  clearServerSessionCookie,
  setServerSessionCookie,
  getServerUserId,
} from "@/server/auth/session-cookie";
import { accountQuery } from "@/server/db/account-pool";
import { resolveTenantId } from "@/server/org/tenant";
import {
  getDefaultBranchId,
  hasActiveCampaignProduct,
} from "@/server/auth/entitlements";

export async function loginAction(input: {
  email: string;
  password: string;
  remember?: boolean;
}): Promise<
  { ok: true; user: CampaignSessionUser } | { ok: false; error: string }
> {
  if (!input.email.trim() || !input.password) {
    return { ok: false, error: "Email and password are required." };
  }
  const result = await authenticateCampaignUser(input);
  if (result.ok) {
    await setServerSessionCookie(result.user.id, Boolean(input.remember));
  }
  return result;
}

export async function logoutAction(): Promise<void> {
  await clearServerSessionCookie();
  redirect("/login");
}

function initialsFromName(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Resolve full session from cookie; null if logged out or not entitled. */
export async function getCampaignSession(): Promise<CampaignSessionUser | null> {
  const userId = await getServerUserId();
  if (!userId) return null;

  const { rows } = await accountQuery<{
    id: string;
    email: string;
    role: string;
    display_name: string | null;
    is_active: boolean;
    organization_id: string | null;
  }>(
    `SELECT id, email, role, display_name, is_active, organization_id
     FROM public.users
     WHERE id = $1::uuid
     LIMIT 1`,
    [userId],
  );

  const user = rows[0];
  if (!user || !user.is_active) return null;

  const tenantId = resolveTenantId(user.organization_id);
  const branchId = await getDefaultBranchId(tenantId);
  if (!branchId) return null;

  const entitled = await hasActiveCampaignProduct(tenantId, branchId);
  if (!entitled) return null;

  const name = user.display_name?.trim() || user.email.split("@")[0];

  return {
    id: user.id,
    email: user.email,
    name,
    role: user.role,
    initials: initialsFromName(name),
    tenantId,
    branchId,
    orgName: "Worktual Campaign",
  };
}

export async function requireCampaignSession(): Promise<CampaignSessionUser> {
  const session = await getCampaignSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

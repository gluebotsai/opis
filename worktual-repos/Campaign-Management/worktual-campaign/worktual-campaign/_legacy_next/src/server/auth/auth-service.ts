import bcrypt from "bcryptjs";
import { accountQuery } from "@/server/db/account-pool";
import { resolveTenantId } from "@/server/org/tenant";
import {
  getDefaultBranchId,
  hasActiveCampaignProduct,
} from "@/server/auth/entitlements";
import type { CampaignSessionUser } from "@/server/auth/types";

type UserRow = {
  id: string;
  email: string;
  password: string;
  role: string;
  display_name: string | null;
  is_active: boolean;
  organization_id: string | null;
};

function initialsFromName(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (
    stored.startsWith("$2a$") ||
    stored.startsWith("$2b$") ||
    stored.startsWith("$2y$")
  ) {
    return bcrypt.compare(plain, stored);
  }
  return plain === stored;
}

/**
 * Authenticates against my_account_qa.public.users, then requires
 * active campaign product entitlement in campaign_db.
 */
export async function authenticateCampaignUser(input: {
  email: string;
  password: string;
}): Promise<
  { ok: true; user: CampaignSessionUser } | { ok: false; error: string }
> {
  const email = input.email.trim().toLowerCase();
  const { rows } = await accountQuery<UserRow>(
    `SELECT id, email, password, role, display_name, is_active, organization_id
     FROM public.users
     WHERE lower(email) = $1
     LIMIT 1`,
    [email],
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    return { ok: false, error: "Invalid email or password." };
  }

  const valid = await verifyPassword(input.password, user.password);
  if (!valid) {
    return { ok: false, error: "Invalid email or password." };
  }

  const tenantId = resolveTenantId(user.organization_id);
  const branchId = await getDefaultBranchId(tenantId);
  if (!branchId) {
    return {
      ok: false,
      error: "No branch configured for this organization. Contact support.",
    };
  }

  const entitled = await hasActiveCampaignProduct(tenantId, branchId);
  if (!entitled) {
    return {
      ok: false,
      error:
        "Campaign product is not enabled for this organization. Buy Campaign or use CRM Marketing if you have CRM.",
    };
  }

  const name = user.display_name?.trim() || email.split("@")[0];

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name,
      role: user.role,
      initials: initialsFromName(name),
      tenantId,
      branchId,
      orgName: "Worktual Campaign",
    },
  };
}

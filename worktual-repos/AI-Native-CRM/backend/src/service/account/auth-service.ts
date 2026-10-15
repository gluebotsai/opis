import bcrypt from "bcryptjs";
import type { BusinessType } from "@/config/modules";
import { resolveBusinessTypeFromCredentials } from "@/lib/business-type";
import {
  displayNameFromSetupUser,
  getSetupUserByEmail,
  roleFromSetupUser,
  type SetupUserRow,
} from "@/service/account/setup-users";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  initials: string;
  businessType: BusinessType;
  organizationId: string;
  orgName: string;
};

function initialsFromName(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function parseBusinessType(raw: string | null | undefined): BusinessType | null {
  const v = raw?.trim().toLowerCase();
  if (v === "b2b" || v === "b2c" || v === "b2b2c") return v;
  return null;
}

async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (
    stored.startsWith("$2a$") ||
    stored.startsWith("$2b$") ||
    stored.startsWith("$2y$")
  ) {
    return bcrypt.compare(plain, stored);
  }
  return plain === stored;
}

/** Session payload for an active CRM user. Null if they cannot use this app. */
export function sessionUserFromSetupRow(
  user: SetupUserRow,
): AuthenticatedUser | null {
  if (user.status !== "active" || !user.crm_role_name) return null;
  const organizationId = user.organization_id?.trim();
  if (!organizationId) return null;

  const name = displayNameFromSetupUser(user);
  const businessType =
    parseBusinessType(user.business_type) ??
    resolveBusinessTypeFromCredentials(user.email);
  return {
    id: user.id,
    email: user.email,
    name,
    role: roleFromSetupUser(user.crm_role_name),
    initials: initialsFromName(name),
    businessType,
    organizationId,
    orgName:
      user.org_name?.trim() ||
      (businessType === "b2c"
        ? "Worktual Commerce"
        : businessType === "b2b2c"
          ? "Worktual Hybrid"
          : "Worktual"),
  };
}

/**
 * Authenticates against accounts.setup_users (shared server DB).
 * CRM role from accounts.setup_user_product_access where product_id = 'crm'.
 */
export async function authenticateAccountUser(input: {
  email: string;
  password: string;
}): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  const user = await getSetupUserByEmail(email);

  if (!user || user.status !== "active") {
    return { ok: false, error: "Invalid email or password." };
  }
  if (!user.password_hash) {
    return { ok: false, error: "Invalid email or password." };
  }

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    return { ok: false, error: "Invalid email or password." };
  }

  const sessionUser = sessionUserFromSetupRow(user);
  if (!sessionUser) {
    return {
      ok: false,
      error: !user.crm_role_name
        ? "This account does not have CRM access."
        : "Your account has no organization. Ask an admin to assign a tenant.",
    };
  }

  return { ok: true, user: sessionUser };
}

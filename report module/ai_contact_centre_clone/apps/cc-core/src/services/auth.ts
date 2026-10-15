import type { PrismaClient } from "@ai-contact-center/db-cc";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { signAccessToken, DEFAULT_ACCESS_TOKEN_TTL_SECONDS } from "../lib/jwt.js";
import { serializeEntityId, parseEntityId } from "../lib/id-schema.js";
import { withStaffContext } from "../lib/rls.js";
import {
  createAuthSession,
  hasActiveAuthSession,
  isSingleSessionEnforced,
  revokeAuthSessionsForEmail,
} from "./auth-sessions.js";

const CONTACT_CENTER_PRODUCT = "contact-center";

export const loginInputSchema = z.object({
  email: z.string().trim().email("Enter a valid work email."),
  password: z.string().min(1, "Enter your password."),
  force: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export type LoginResult = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: "admin" | "agent";
    organizationId: string;
    organizationName: string;
    roleLabel: string;
  };
};

function normalizeBcryptHash(hash: string): string {
  if (hash.startsWith("$2y$")) {
    return `$2a$${hash.slice(4)}`;
  }
  return hash;
}

function resolveRole(roleName: string | null | undefined): "admin" | "agent" {
  const value = (roleName ?? "").trim().toLowerCase();
  if (
    value === "admin" ||
    value === "administrator" ||
    value === "manager" ||
    value === "supervisor"
  ) {
    return "admin";
  }
  return "agent";
}

export { resolveRole };

function displayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim() || "User";
}

export type ContactCenterSetupUser = {
  id: bigint;
  organization_id: bigint;
  first_name: string;
  last_name: string;
  work_email: string;
  password_hash: string | null;
  setup_user_product_access: Array<{ setup_roles: { name: string } }>;
  organizations: { company_name: string | null };
};

const setupUserLoginSelect = {
  id: true,
  organization_id: true,
  first_name: true,
  last_name: true,
  work_email: true,
  password_hash: true,
  setup_user_product_access: {
    where: { product_id: CONTACT_CENTER_PRODUCT },
    select: {
      setup_roles: {
        select: { name: true },
      },
    },
  },
  organizations: {
    select: { company_name: true },
  },
} as const;

export async function loadContactCenterSetupUser(
  prisma: PrismaClient,
  input: { email?: string; userId?: string },
): Promise<ContactCenterSetupUser | null> {
  const email = input.email?.trim().toLowerCase();
  const userId = input.userId?.trim();

  const candidates = await withStaffContext(prisma, async (db) => {
    if (userId) {
      return db.setup_users.findMany({
        where: { id: parseEntityId(userId), status: "active" },
        select: setupUserLoginSelect,
      });
    }
    if (!email) return [];
    return db.setup_users.findMany({
      where: {
        work_email: { equals: email, mode: "insensitive" },
        status: "active",
      },
      select: setupUserLoginSelect,
    });
  });

  const eligible = candidates.filter((user) => user.setup_user_product_access.length > 0);
  if (eligible.length === 0) return null;
  if (eligible.length > 1) {
    throw Object.assign(
      new Error("Multiple accounts found for this email. Contact your administrator."),
      { status: 409 },
    );
  }
  return eligible[0]!;
}

export async function issueSetupUserSession(
  prisma: PrismaClient,
  user: ContactCenterSetupUser,
  jwtSecret: string,
  options: { revokeExisting?: boolean } = {},
): Promise<LoginResult> {
  const roleName = user.setup_user_product_access[0]?.setup_roles.name ?? "Agent";
  const role = resolveRole(roleName);
  const organizationName = user.organizations.company_name ?? "Organization";
  const display = displayName(user.first_name, user.last_name);
  const email = user.work_email;

  if (options.revokeExisting) {
    await revokeAuthSessionsForEmail(prisma, email);
  } else if (isSingleSessionEnforced()) {
    const alreadySignedIn = await hasActiveAuthSession(prisma, email);
    if (alreadySignedIn) {
      throw Object.assign(
        new Error(
          "This account is already signed in. Sign out from the other session before signing in again.",
        ),
        { status: 409, code: "ALREADY_SIGNED_IN" },
      );
    }
  }

  const token = signAccessToken(
    {
      sub: serializeEntityId(user.id),
      tenant_id: serializeEntityId(user.organization_id),
      email: user.work_email,
      role,
    },
    jwtSecret,
    DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  );

  const expiresAt = new Date(Date.now() + DEFAULT_ACCESS_TOKEN_TTL_SECONDS * 1000);
  await createAuthSession(prisma, {
    token,
    email: user.work_email,
    role,
    displayName: display,
    expiresAt,
  });

  return {
    token,
    user: {
      id: serializeEntityId(user.id),
      email: user.work_email,
      name: display,
      role,
      organizationId: serializeEntityId(user.organization_id),
      organizationName,
      roleLabel: roleName,
    },
  };
}

export async function loginSetupUser(
  prisma: PrismaClient,
  input: LoginInput,
  jwtSecret: string,
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();

  const user = await loadContactCenterSetupUser(prisma, { email });
  if (!user?.password_hash) {
    throw Object.assign(new Error("Invalid email or password."), { status: 401 });
  }

  const matches = await bcrypt.compare(input.password, normalizeBcryptHash(user.password_hash));
  if (!matches) {
    throw Object.assign(new Error("Invalid email or password."), { status: 401 });
  }

  return issueSetupUserSession(prisma, user, jwtSecret, {
    revokeExisting: Boolean(input.force),
  });
}

export async function resolveSetupUserRole(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<"admin" | "agent"> {
  const access = await withStaffContext(prisma, async (db) =>
    db.setup_user_product_access.findFirst({
      where: {
        organization_id: parseEntityId(organizationId),
        user_id: parseEntityId(userId),
        product_id: CONTACT_CENTER_PRODUCT,
      },
      select: {
        setup_roles: {
          select: { name: true },
        },
      },
    }),
  );
  return resolveRole(access?.setup_roles.name);
}

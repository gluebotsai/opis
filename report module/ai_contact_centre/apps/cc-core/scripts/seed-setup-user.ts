/**
 * Seed a Contact Center login user in accounts.setup_users for an existing organization.
 *
 * Usage:
 *   ORGANIZATION_ID=<uuid> EMAIL=admin@example.com PASSWORD=secret npm run seed:setup-user
 *
 * Optional:
 *   FIRST_NAME=Admin LAST_NAME=User ROLE=admin|agent
 */
import "@ai-contact-center/config/load-root-env";
import bcrypt from "bcryptjs";
import { ccPrisma } from "@ai-contact-center/db-cc";

const CONTACT_CENTER_PRODUCT = "contact-center";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

async function resolveOrganizationId(): Promise<string> {
  const fromEnv = process.env.ORGANIZATION_ID ?? arg("organization-id");
  if (fromEnv) return fromEnv;

  const org = await ccPrisma.organizations.findFirst({
    where: { lifecycle_status: "active" },
    orderBy: { created_at: "desc" },
    select: { id: true, company_name: true },
  });
  if (!org) {
    throw new Error("No active organization found. Set ORGANIZATION_ID.");
  }
  console.log(`Using organization: ${org.company_name} (${org.id})`);
  return org.id;
}

async function resolveRoleId(organizationId: string, roleName: string): Promise<string> {
  const role = await ccPrisma.setup_roles.findFirst({
    where: {
      organization_id: organizationId,
      name: { equals: roleName, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  if (!role) {
    throw new Error(
      `Role "${roleName}" not found for organization ${organizationId}. Create a setup_roles row first.`,
    );
  }
  return role.id;
}

async function main() {
  const organizationId = await resolveOrganizationId();
  const email = (process.env.EMAIL ?? arg("email") ?? "cc-admin@worktual.local").trim().toLowerCase();
  const password = process.env.PASSWORD ?? arg("password") ?? "Worktual@123";
  const firstName = process.env.FIRST_NAME ?? arg("first-name") ?? "Contact";
  const lastName = process.env.LAST_NAME ?? arg("last-name") ?? "Admin";
  const roleKey = (process.env.ROLE ?? arg("role") ?? "admin").trim().toLowerCase();
  const roleName = roleKey === "agent" ? "Agent" : "Admin";

  const existing = await ccPrisma.setup_users.findFirst({
    where: {
      organization_id: organizationId,
      work_email: { equals: email, mode: "insensitive" },
    },
    select: { id: true, work_email: true },
  });

  if (existing) {
    throw new Error(`User already exists: ${existing.work_email} (${existing.id})`);
  }

  const roleId = await resolveRoleId(organizationId, roleName);
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await ccPrisma.setup_users.create({
    data: {
      organization_id: organizationId,
      first_name: firstName,
      last_name: lastName,
      work_email: email,
      status: "active",
      invite_status: "active",
      password_hash: passwordHash,
      password_set_at: new Date(),
      shift_types: ["Regular"],
      setup_user_product_access: {
        create: {
          organization_id: organizationId,
          product_id: CONTACT_CENTER_PRODUCT,
          role_id: roleId,
        },
      },
    },
    select: {
      id: true,
      work_email: true,
      organization_id: true,
      first_name: true,
      last_name: true,
    },
  });

  const org = await ccPrisma.organizations.findUnique({
    where: { id: organizationId },
    select: { company_name: true },
  });

  console.log("Created setup_users record:");
  console.log(JSON.stringify({ ...user, organizationName: org?.company_name, role: roleName }, null, 2));
  console.log("\nSign in with:");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });

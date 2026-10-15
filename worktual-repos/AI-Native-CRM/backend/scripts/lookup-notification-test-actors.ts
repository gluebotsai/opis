import { prisma } from "../src/dao/db/prisma.js";

async function main() {
  const users = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      email: string | null;
      display_name: string;
      role: string | null;
      org_id: string;
    }>
  >(
    `
    SELECT u.id::text,
           lower(u.work_email) AS email,
           trim(both FROM coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS display_name,
           r.name AS role,
           u.organization_id::text AS org_id
    FROM accounts.setup_users u
    LEFT JOIN accounts.setup_user_product_access a
      ON a.user_id = u.id AND a.product_id = 'crm'
    LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
    WHERE lower(coalesce(u.work_email, '')) LIKE '%aravind%'
       OR lower(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) LIKE '%aravind%'
       OR lower(coalesce(u.work_email, '')) LIKE '%yaswanth%'
       OR lower(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) LIKE '%yaswanth%'
    ORDER BY u.id
    LIMIT 20
    `,
  );

  const contacts = await prisma.$queryRawUnsafe<
    Array<{ id: string; owner_user_id: string | null; email: string; org_id: string }>
  >(
    `
    SELECT cp.id, cp.owner_user_id::text, lower(ik.key_value) AS email, cp.organization_id::text AS org_id
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
    JOIN cdp.identity_keys ik ON ik.cdp_id = p.cdp_id AND ik.key_type = 'email'
    WHERE lower(ik.key_value) LIKE '%sample151102%'
       OR lower(coalesce(p.first_name, '')) LIKE '%raghuram%'
    LIMIT 10
    `,
  );

  const admins = await prisma.$queryRawUnsafe<
    Array<{ id: string; email: string | null; role: string | null; org_id: string }>
  >(
    `
    SELECT u.id::text, lower(u.work_email) AS email, r.name AS role, u.organization_id::text AS org_id
    FROM accounts.setup_users u
    JOIN accounts.setup_user_product_access a ON a.user_id = u.id AND a.product_id = 'crm'
    JOIN accounts.setup_roles r ON r.id = a.role_id
    WHERE r.name IN ('admin', 'sales_manager')
    ORDER BY u.id
    LIMIT 10
    `,
  );

  console.log(JSON.stringify({ users, contacts, admins }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

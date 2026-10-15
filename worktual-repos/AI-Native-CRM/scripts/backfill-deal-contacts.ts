/**
 * One-time / reusable: ensure every deal contact_name/email maps to a
 * real my_account_qa.contacts row and deals.contact_id is set.
 *
 * Run: npx tsx scripts/backfill-deal-contacts.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const prisma = new PrismaClient();
const account = new Pool({
  connectionString:
    process.env.ACCOUNT_DATABASE_URL ??
    "postgresql://postgres@localhost:5432/my_account_qa",
});

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Unknown", last: "Contact" };
  if (parts.length === 1) return { first: parts[0], last: "Contact" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function findContactByEmail(email: string) {
  const { rows } = await account.query<{ id: string }>(
    `SELECT id::text AS id FROM public.contacts
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [email],
  );
  return rows[0]?.id ?? null;
}

async function createContact(args: {
  first: string;
  last: string;
  email: string;
  companyId: string;
  companyName: string;
  industry: string | null;
}) {
  const { rows } = await account.query<{ id: string }>(
    `INSERT INTO public.contacts (
       first_name, last_name, email,
       company_name, company_industry, crm_company_id,
       lifecycle_stage, crm_status, tags, lead_source, notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'prospect','active',ARRAY['backfill']::text[],
       'Deal backfill','Created from existing deal contact fields'
     )
     RETURNING id::text AS id`,
    [
      args.first,
      args.last,
      args.email.toLowerCase(),
      args.companyName,
      args.industry,
      args.companyId,
    ],
  );
  return rows[0].id;
}

async function main() {
  // Repair empty-string UUIDs that break Prisma reads.
  await prisma.$executeRawUnsafe(
    `UPDATE deals SET contact_id = NULL WHERE contact_id IS NOT NULL AND length(trim(contact_id::text)) = 0`,
  );

  const deals = await prisma.deal.findMany({
    where: {
      contactId: null,
      contactEmail: { not: null },
    },
    include: { company: { select: { id: true, name: true, industry: true } } },
  });

  let linked = 0;
  let created = 0;

  for (const deal of deals) {
    const email = deal.contactEmail?.trim().toLowerCase();
    if (!email) continue;

    let contactId = await findContactByEmail(email);
    if (!contactId) {
      const name = deal.contactName?.trim() || email.split("@")[0] || "Unknown";
      const { first, last } = splitName(name);
      contactId = await createContact({
        first,
        last,
        email,
        companyId: deal.companyId,
        companyName: deal.company.name,
        industry: deal.company.industry,
      });
      created += 1;
    } else {
      // Ensure hard link + denormalized company on existing contact
      await account.query(
        `UPDATE public.contacts SET
           crm_company_id = COALESCE(NULLIF(trim(crm_company_id), ''), $2),
           company_name = COALESCE(NULLIF(trim(company_name), ''), $3),
           updated_at = now()
         WHERE id = $1::uuid`,
        [contactId, deal.companyId, deal.company.name],
      );
    }

    const display =
      deal.contactName?.trim() ||
      (await account.query<{ n: string }>(
        `SELECT trim(first_name || ' ' || last_name) AS n
         FROM public.contacts WHERE id = $1::uuid`,
        [contactId],
      )).rows[0]?.n ||
      email;

    await prisma.deal.update({
      where: { id: deal.id },
      data: {
        contactId,
        contactName: display,
        contactEmail: email,
      },
    });
    linked += 1;
  }

  console.log(
    `Backfill complete: linked ${linked} deals, created ${created} contacts.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await account.end();
    await prisma.$disconnect();
  });

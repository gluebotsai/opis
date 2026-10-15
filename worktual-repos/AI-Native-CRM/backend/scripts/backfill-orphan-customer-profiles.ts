/**
 * Ops: backfill stub cdp.customer_profile (+ optional email key) for CRM
 * contact_profiles whose account_contact_id has no matching CDP row.
 *
 * Enriches from deal contactName / contactEmail and linked company name when present.
 * Row DML only — no CDP DDL.
 *
 *   cd backend && npx tsx --env-file=../.env scripts/backfill-orphan-customer-profiles.ts
 *   cd backend && npx tsx --env-file=../.env scripts/backfill-orphan-customer-profiles.ts --apply
 */
import { accountQuery } from "../src/dao/db/account-pool";
import { prisma } from "../src/dao/db/prisma";
import { randomUUID } from "node:crypto";

const apply = process.argv.includes("--apply");

function splitName(raw: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const parts = (raw ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Unknown", lastName: "Contact" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "Contact" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ").slice(0, 120),
  };
}

async function main() {
  const profiles = await prisma.contactProfile.findMany({
    select: {
      accountContactId: true,
      organizationId: true,
      companyId: true,
      notes: true,
      status: true,
      company: { select: { name: true, domain: true, industry: true } },
    },
    take: 5_000,
  });

  if (profiles.length === 0) {
    console.info("No contact_profiles found.");
    return;
  }

  const ids = profiles.map((p) => p.accountContactId);
  const { rows: existing } = await accountQuery<{ cdp_id: string }>(
    `SELECT cdp_id::text AS cdp_id
     FROM cdp.customer_profile
     WHERE cdp_id = ANY($1::text[])`,
    [ids],
  );
  const have = new Set(existing.map((r) => r.cdp_id));
  const orphans = profiles.filter((p) => !have.has(p.accountContactId));

  const deals = await prisma.deal.findMany({
    where: { contactId: { in: orphans.map((o) => o.accountContactId) } },
    select: { contactId: true, contactName: true, contactEmail: true },
    orderBy: { updatedAt: "desc" },
  });
  const denorm = new Map<
    string,
    { name: string | null; email: string | null }
  >();
  for (const d of deals) {
    if (!d.contactId || denorm.has(d.contactId)) continue;
    denorm.set(d.contactId, {
      name: d.contactName?.trim() || null,
      email: d.contactEmail?.trim().toLowerCase() || null,
    });
  }

  console.info(
    `contact_profiles=${profiles.length} with_cdp=${have.size} orphans=${orphans.length} mode=${apply ? "APPLY" : "dry-run"}`,
  );

  let created = 0;
  let keys = 0;
  let skipped = 0;

  for (const orphan of orphans) {
    const orgId = orphan.organizationId?.trim();
    if (!orgId) {
      console.warn(`skip ${orphan.accountContactId}: missing organizationId`);
      skipped += 1;
      continue;
    }

    const hint = denorm.get(orphan.accountContactId);
    const { firstName, lastName } = splitName(hint?.name);
    const email = hint?.email?.includes("@") ? hint.email : null;
    const company = orphan.company?.name?.trim() || null;
    const customFields: Record<string, unknown> = {
      backfilled_from: "crm.contact_profiles",
    };
    if (orphan.company?.domain?.trim()) {
      customFields.company_domain = orphan.company.domain.trim();
    }
    if (orphan.company?.industry?.trim()) {
      customFields.industry = orphan.company.industry.trim();
    }

    if (!apply) {
      console.info(
        `would create cdp_id=${orphan.accountContactId} name="${firstName} ${lastName}" email=${email ?? "(none)"} company=${company ?? "(none)"}`,
      );
      continue;
    }

    await accountQuery(
      `INSERT INTO cdp.customer_profile (
         cdp_id, organization_id, first_name, last_name, company, custom_fields
       ) VALUES (
         $1::text, $2::bigint, $3, $4, $5, $6::jsonb
       )
       ON CONFLICT (cdp_id) DO NOTHING`,
      [
        orphan.accountContactId,
        orgId,
        firstName,
        lastName,
        company,
        JSON.stringify(customFields),
      ],
    );
    created += 1;

    if (email) {
      try {
        await accountQuery(
          `INSERT INTO cdp.identity_keys (
             identity_id, cdp_id, organization_id, key_type, key_value,
             verified, source_system, confidence_score
           ) VALUES (
             $1::text, $2::text, $3::bigint, 'email', $4, false, 'crm', 1.0
           )
           ON CONFLICT (organization_id, key_type, key_value) DO NOTHING`,
          [randomUUID(), orphan.accountContactId, orgId, email],
        );
        keys += 1;
      } catch (err) {
        console.warn(
          `email key skipped for ${orphan.accountContactId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  if (apply) {
    console.info(`created_profiles=${created} email_keys=${keys} skipped=${skipped}`);
  } else {
    console.info("Re-run with --apply to insert stub profiles.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });

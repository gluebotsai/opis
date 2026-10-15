/**
 * Copy CRM fields from my_account_qa.public.contacts → crm_qa.contact_profiles.
 * Run BEFORE dropping CRM columns from the shared contacts table.
 *
 * Usage: npx tsx scripts/backfill-contact-profiles.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import pg from "pg";

const accountUrl = process.env.ACCOUNT_DATABASE_URL;
const crmUrl = process.env.DATABASE_URL;

if (!accountUrl) throw new Error("ACCOUNT_DATABASE_URL is not set");
if (!crmUrl) throw new Error("DATABASE_URL is not set");

type Row = {
  id: string;
  organization_id: string | null;
  crm_company_id: string | null;
  crm_location_id: string | null;
  owner_user_id: string | null;
  lifecycle_stage: string | null;
  lead_source: string | null;
  lead_status: string | null;
  disqualify_reason: string | null;
  bant_budget: boolean | null;
  bant_authority: boolean | null;
  bant_need: boolean | null;
  bant_timeline: boolean | null;
  converted_deal_id: string | null;
  tags: string[] | null;
  crm_status: string | null;
  notes: string | null;
  is_pinned: boolean | null;
};

async function main() {
  const account = new pg.Pool({ connectionString: accountUrl });
  const prisma = new PrismaClient();

  // Detect whether CRM columns still exist (idempotent if already dropped).
  const colCheck = await account.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'contacts'
       AND column_name = 'lifecycle_stage'`,
  );
  if (colCheck.rows.length === 0) {
    console.log(
      "CRM columns already removed from my_account_qa.contacts — nothing to backfill.",
    );
    await account.end();
    await prisma.$disconnect();
    return;
  }

  const { rows } = await account.query<Row>(
    `SELECT
       id::text AS id,
       organization_id::text AS organization_id,
       crm_company_id,
       crm_location_id,
       owner_user_id::text AS owner_user_id,
       lifecycle_stage,
       lead_source,
       lead_status,
       disqualify_reason,
       bant_budget,
       bant_authority,
       bant_need,
       bant_timeline,
       converted_deal_id,
       COALESCE(tags, '{}') AS tags,
       crm_status,
       notes,
       COALESCE(is_pinned, false) AS is_pinned
     FROM public.contacts`,
  );

  console.log(`Backfilling ${rows.length} contact profiles…`);

  // Validate company/location FKs exist in CRM before writing.
  const companyIds = [
    ...new Set(
      rows
        .map((r) => r.crm_company_id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const locationIds = [
    ...new Set(
      rows
        .map((r) => r.crm_location_id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const validCompanies = new Set(
    (
      await prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: { id: true },
      })
    ).map((c) => c.id),
  );
  const validLocations = new Set(
    (
      await prisma.companyLocation.findMany({
        where: { id: { in: locationIds } },
        select: { id: true },
      })
    ).map((l) => l.id),
  );

  let upserted = 0;
  for (const row of rows) {
    const organizationId = row.organization_id?.trim();
    if (!organizationId) {
      console.warn(`Skipping contact ${row.id}: missing organization_id`);
      continue;
    }
    const companyId = row.crm_company_id?.trim() || null;
    const locationId = row.crm_location_id?.trim() || null;
    await prisma.contactProfile.upsert({
      where: { accountContactId: row.id },
      create: {
        accountContactId: row.id,
        organizationId,
        companyId:
          companyId && validCompanies.has(companyId) ? companyId : null,
        locationId:
          locationId && validLocations.has(locationId) ? locationId : null,
        ownerUserId: row.owner_user_id,
        lifecycleStage: row.lifecycle_stage || "lead",
        leadSource: row.lead_source,
        leadStatus: row.lead_status || "new",
        disqualifyReason: row.disqualify_reason,
        bantBudget: row.bant_budget,
        bantAuthority: row.bant_authority,
        bantNeed: row.bant_need,
        bantTimeline: row.bant_timeline,
        convertedDealId: row.converted_deal_id,
        tags: row.tags ?? [],
        status: row.crm_status || "active",
        notes: row.notes,
        isPinned: Boolean(row.is_pinned),
      },
      update: {
        organizationId,
        companyId:
          companyId && validCompanies.has(companyId) ? companyId : null,
        locationId:
          locationId && validLocations.has(locationId) ? locationId : null,
        ownerUserId: row.owner_user_id,
        lifecycleStage: row.lifecycle_stage || "lead",
        leadSource: row.lead_source,
        leadStatus: row.lead_status || "new",
        disqualifyReason: row.disqualify_reason,
        bantBudget: row.bant_budget,
        bantAuthority: row.bant_authority,
        bantNeed: row.bant_need,
        bantTimeline: row.bant_timeline,
        convertedDealId: row.converted_deal_id,
        tags: row.tags ?? [],
        status: row.crm_status || "active",
        notes: row.notes,
        isPinned: Boolean(row.is_pinned),
      },
    });
    upserted += 1;
  }

  console.log(`Upserted ${upserted} contact_profiles.`);
  await account.end();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

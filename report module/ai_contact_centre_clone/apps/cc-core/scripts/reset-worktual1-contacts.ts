/**
 * Wipe all CDP contacts for worktual1 and seed 10 sample contacts with full details.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/reset-worktual1-contacts.ts
 *   npx tsx apps/cc-core/scripts/reset-worktual1-contacts.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { randomUUID } from "node:crypto";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const live = process.argv.includes("--live");

type ContactSeed = {
  id: string;
  firstName: string;
  lastName: string;
  primaryEmail: string;
  primaryPhone: string;
  secondaryEmail?: string;
  secondaryPhone?: string;
  gender?: string;
  dateOfBirth?: string;
  company: string;
  industry: string;
  city: string;
  region: string;
  country: string;
  language: string;
  timezone: string;
  department: string;
  lifeCycleStage: string;
  companySize: string;
  customFields: Record<string, unknown>;
  profileAttributes: Record<string, unknown>;
  whatsappPhone?: string;
};

const CONTACTS: ContactSeed[] = [
  {
    id: "c1000001-0000-4000-8000-000000000001",
    firstName: "Priya",
    lastName: "Sharma",
    primaryEmail: "priya.sharma@technova.io",
    primaryPhone: "+91 98452 18830",
    secondaryEmail: "priya@technova-support.com",
    secondaryPhone: "+91 80 4123 9900",
    gender: "female",
    dateOfBirth: "1990-04-12",
    company: "TechNova Solutions",
    industry: "SaaS",
    city: "Bengaluru",
    region: "Karnataka",
    country: "IN",
    language: "en",
    timezone: "Asia/Kolkata",
    department: "Customer Success",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { plan: "Enterprise", accountTier: "Gold", supportPriority: "high" },
    profileAttributes: { leadScore: 92, preferredChannel: "webchat", npsLast: 9, vip: true },
    whatsappPhone: "919845218830",
  },
  {
    id: "c1000001-0000-4000-8000-000000000002",
    firstName: "James",
    lastName: "Okafor",
    primaryEmail: "j.okafor@atlasretail.co.uk",
    primaryPhone: "+44 20 7946 0958",
    secondaryPhone: "+44 20 7946 0959",
    gender: "male",
    dateOfBirth: "1985-09-03",
    company: "Atlas Retail Group",
    industry: "Retail",
    city: "London",
    region: "England",
    country: "GB",
    language: "en",
    timezone: "Europe/London",
    department: "Operations",
    lifeCycleStage: "customer",
    companySize: "1001-5000",
    customFields: { storeCount: 42, posVendor: "Worktual POS", region: "EMEA" },
    profileAttributes: { leadScore: 78, preferredChannel: "email", npsLast: 7 },
  },
  {
    id: "c1000001-0000-4000-8000-000000000003",
    firstName: "Maria",
    lastName: "Gonzalez",
    primaryEmail: "maria.gonzalez@solsticehealth.es",
    primaryPhone: "+34 91 123 4567",
    gender: "female",
    dateOfBirth: "1988-11-21",
    company: "Solstice Health",
    industry: "Healthcare",
    city: "Madrid",
    region: "Madrid",
    country: "ES",
    language: "es",
    timezone: "Europe/Madrid",
    department: "Patient Services",
    lifeCycleStage: "customer",
    companySize: "501-1000",
    customFields: { hipaaRegion: "EU", clinics: 14 },
    profileAttributes: { leadScore: 85, preferredChannel: "voice", npsLast: 8 },
    whatsappPhone: "34911234567",
  },
  {
    id: "c1000001-0000-4000-8000-000000000004",
    firstName: "David",
    lastName: "Chen",
    primaryEmail: "david.chen@pacificfreight.sg",
    primaryPhone: "+65 6123 4401",
    gender: "male",
    dateOfBirth: "1992-01-15",
    company: "Pacific Freight Co",
    industry: "Logistics",
    city: "Singapore",
    region: "Central",
    country: "SG",
    language: "en",
    timezone: "Asia/Singapore",
    department: "Fleet Operations",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { fleetSize: 128, trackingIntegration: "enabled" },
    profileAttributes: { leadScore: 71, preferredChannel: "whatsapp", npsLast: 6 },
    whatsappPhone: "6561234401",
  },
  {
    id: "c1000001-0000-4000-8000-000000000005",
    firstName: "Emily",
    lastName: "Watson",
    primaryEmail: "emily.watson@brightpath.edu",
    primaryPhone: "+1 617 555 0142",
    gender: "female",
    dateOfBirth: "1995-07-08",
    company: "BrightPath Education",
    industry: "Education",
    city: "Boston",
    region: "MA",
    country: "US",
    language: "en",
    timezone: "America/New_York",
    department: "Admissions",
    lifeCycleStage: "lead",
    companySize: "51-200",
    customFields: { campusCount: 3, crmSync: "pending" },
    profileAttributes: { leadScore: 64, preferredChannel: "webchat", npsLast: null },
  },
  {
    id: "c1000001-0000-4000-8000-000000000006",
    firstName: "Rahul",
    lastName: "Mehta",
    primaryEmail: "rahul.mehta@finedge.in",
    primaryPhone: "+91 22 4012 7788",
    secondaryEmail: "rahul.m@finedge.in",
    gender: "male",
    dateOfBirth: "1987-12-30",
    company: "FinEdge Payments",
    industry: "Fintech",
    city: "Mumbai",
    region: "Maharashtra",
    country: "IN",
    language: "en",
    timezone: "Asia/Kolkata",
    department: "Risk & Compliance",
    lifeCycleStage: "customer",
    companySize: "501-1000",
    customFields: { pciLevel: 1, monthlyVolume: "42Cr INR" },
    profileAttributes: { leadScore: 88, preferredChannel: "email", npsLast: 8 },
    whatsappPhone: "912240127788",
  },
  {
    id: "c1000001-0000-4000-8000-000000000007",
    firstName: "Sophie",
    lastName: "Laurent",
    primaryEmail: "sophie.laurent@maisondupont.fr",
    primaryPhone: "+33 1 42 68 53 00",
    gender: "female",
    dateOfBirth: "1983-05-19",
    company: "Maison Dupont",
    industry: "Luxury Retail",
    city: "Paris",
    region: "Île-de-France",
    country: "FR",
    language: "fr",
    timezone: "Europe/Paris",
    department: "Client Relations",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { boutiqueCount: 9, vipProgram: "Maison Elite" },
    profileAttributes: { leadScore: 95, preferredChannel: "webchat", npsLast: 10, vip: true },
  },
  {
    id: "c1000001-0000-4000-8000-000000000008",
    firstName: "Michael",
    lastName: "Torres",
    primaryEmail: "m.torres@greengrid.com",
    primaryPhone: "+1 512 555 0199",
    gender: "male",
    dateOfBirth: "1979-03-22",
    company: "GreenGrid Energy",
    industry: "Utilities",
    city: "Austin",
    region: "TX",
    country: "US",
    language: "en",
    timezone: "America/Chicago",
    department: "Customer Care",
    lifeCycleStage: "customer",
    companySize: "1001-5000",
    customFields: { serviceArea: "Central Texas", outageAlerts: true },
    profileAttributes: { leadScore: 73, preferredChannel: "voice", npsLast: 5 },
  },
  {
    id: "c1000001-0000-4000-8000-000000000009",
    firstName: "Aisha",
    lastName: "Patel",
    primaryEmail: "aisha.patel@carelink.ca",
    primaryPhone: "+1 416 555 0173",
    gender: "female",
    dateOfBirth: "1991-10-02",
    company: "CareLink Home Services",
    industry: "Home Services",
    city: "Toronto",
    region: "ON",
    country: "CA",
    language: "en",
    timezone: "America/Toronto",
    department: "Scheduling",
    lifeCycleStage: "customer",
    companySize: "51-200",
    customFields: { technicians: 38, serviceZones: 6 },
    profileAttributes: { leadScore: 69, preferredChannel: "whatsapp", npsLast: 7 },
    whatsappPhone: "14165550173",
  },
  {
    id: "c1000001-0000-4000-8000-000000000010",
    firstName: "Liam",
    lastName: "O'Brien",
    primaryEmail: "liam.obrien@celtictelecom.ie",
    primaryPhone: "+353 1 555 0120",
    gender: "male",
    dateOfBirth: "1986-08-14",
    company: "Celtic Telecom",
    industry: "Telecom",
    city: "Dublin",
    region: "Leinster",
    country: "IE",
    language: "en",
    timezone: "Europe/Dublin",
    department: "Business Support",
    lifeCycleStage: "customer",
    companySize: "501-1000",
    customFields: { businessLines: 2400, slaTier: "Premium" },
    profileAttributes: { leadScore: 81, preferredChannel: "email", npsLast: 8 },
  },
];

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

async function previewCounts() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const rows = await ccPrisma.$queryRaw<
    Array<{ contacts: number; profiles: number; identities: number; interactions: number }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM cdp.contacts WHERE organization_id = ${ORG_ID}::bigint) AS contacts,
      (SELECT COUNT(*)::int FROM cdp.profiles WHERE organization_id = ${ORG_ID}::bigint) AS profiles,
      (SELECT COUNT(*)::int FROM cdp.contact_identities WHERE organization_id = ${ORG_ID}::bigint) AS identities,
      (SELECT COUNT(*)::int FROM cdp.interactions WHERE organization_id = ${ORG_ID}::bigint) AS interactions
  `;
  return rows[0];
}

async function wipeContacts() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  await ccPrisma.$executeRaw`
    DELETE FROM cdp.interaction_events
    WHERE organization_id = ${ORG_ID}::bigint
  `;
  await ccPrisma.$executeRaw`
    DELETE FROM cdp.interactions WHERE organization_id = ${ORG_ID}::bigint
  `;
  await ccPrisma.$executeRaw`
    DELETE FROM cdp.contact_identities WHERE organization_id = ${ORG_ID}::bigint
  `;
  await ccPrisma.$executeRaw`
    DELETE FROM cdp.profiles WHERE organization_id = ${ORG_ID}::bigint
  `;
  await ccPrisma.$executeRaw`
    DELETE FROM cdp.contacts WHERE organization_id = ${ORG_ID}::bigint
  `;
}

async function seedContact(contact: ContactSeed) {
  const profileId = `d2000001-0000-4000-8000-${contact.id.slice(-12)}`;
  const now = new Date();

  await ccPrisma.$executeRaw`
    INSERT INTO cdp.contacts (
      id, organization_id, first_name, last_name, primary_email, primary_phone,
      secondary_email, secondary_phone, gender, date_of_birth,
      company, industry, city, region, country, language, timezone,
      source_system, custom_fields, is_active, created_at, updated_at,
      life_cycle_stage, department, company_size
    ) VALUES (
      ${contact.id}::bigint,
      ${ORG_ID}::bigint,
      ${contact.firstName},
      ${contact.lastName},
      ${contact.primaryEmail},
      ${contact.primaryPhone},
      ${contact.secondaryEmail ?? null},
      ${contact.secondaryPhone ?? null},
      ${contact.gender ?? null},
      ${contact.dateOfBirth ?? null}::date,
      ${contact.company},
      ${contact.industry},
      ${contact.city},
      ${contact.region},
      ${contact.country},
      ${contact.language},
      ${contact.timezone},
      'sample_seed',
      ${JSON.stringify(contact.customFields)}::jsonb,
      true,
      ${now},
      ${now},
      ${contact.lifeCycleStage},
      ${contact.department},
      ${contact.companySize}
    )
  `;

  await ccPrisma.$executeRaw`
    INSERT INTO cdp.profiles (
      id, organization_id, external_id, email, attributes, created_at, updated_at
    ) VALUES (
      ${profileId}::bigint,
      ${ORG_ID}::bigint,
      ${contact.id},
      ${contact.primaryEmail},
      ${JSON.stringify(contact.profileAttributes)}::jsonb,
      ${now},
      ${now}
    )
  `;

  const identities: Array<{ type: string; value: string }> = [
    { type: "email", value: contact.primaryEmail.toLowerCase() },
    { type: "phone", value: normalizePhoneDigits(contact.primaryPhone) },
  ];
  if (contact.whatsappPhone) {
    identities.push({ type: "whatsapp_phone", value: contact.whatsappPhone });
  }
  identities.push({ type: "webchat_visitor", value: `visitor_${contact.id.slice(0, 8)}` });

  for (const identity of identities) {
    const sourceChannel =
      identity.type === "email"
        ? "email"
        : identity.type === "whatsapp_phone"
          ? "whatsapp"
          : identity.type === "webchat_visitor"
            ? "webchat"
            : "webchat";

    await ccPrisma.$executeRaw`
      INSERT INTO cdp.contact_identities (
        id, organization_id, contact_id, identity_type, identity_value,
        source_channel, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        ${randomUUID()}::bigint,
        ${ORG_ID}::bigint,
        ${contact.id}::bigint,
        ${identity.type},
        ${identity.value},
        ${sourceChannel},
        ${now},
        ${now},
        ${now},
        ${now}
      )
      ON CONFLICT (organization_id, identity_type, identity_value) DO UPDATE
        SET contact_id = EXCLUDED.contact_id, last_seen_at = NOW(), updated_at = NOW()
    `;
  }
}

async function main() {
  const before = await previewCounts();
  console.log(JSON.stringify({ organizationId: ORG_ID, live, before }, null, 2));

  if (!live) {
    console.log("\nDry run only. Re-run with --live to wipe and seed 10 contacts.");
    return;
  }

  await wipeContacts();
  for (const contact of CONTACTS) {
    await seedContact(contact);
  }

  const after = await previewCounts();
  console.log(
    JSON.stringify(
      {
        status: "complete",
        contactsSeeded: CONTACTS.length,
        after,
        sample: CONTACTS.map((c) => ({
          name: `${c.firstName} ${c.lastName}`,
          email: c.primaryEmail,
          company: c.company,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });

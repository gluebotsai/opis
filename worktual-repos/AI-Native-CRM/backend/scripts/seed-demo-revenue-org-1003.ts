/**
 * Idempotent demo book for org 1003.
 * 100 contacts, 25 companies, 60 deals, 20 paid INR invoices.
 *
 * Run from backend/:
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/seed-demo-revenue-org-1003.ts
 *
 * A second run updates the same demo1003-* rows. It does not delete other CRM data.
 */
import { Pool } from "pg";
import { prisma } from "../src/dao/db/prisma";
import { formatCdpId } from "../src/lib/cdp-id";
import { kolkataQuarterBounds } from "../src/dao/home/revenue-board";

const ORG = "1003";
const TAG = "demo-revenue";

const FIRST = [
  "Asha", "Rohan", "Meera", "Vikram", "Ananya",
  "Kabir", "Diya", "Arjun", "Sara", "Neil",
];
const LAST = [
  "Iyer", "Mehta", "Nair", "Shah", "Kapoor",
  "Reddy", "Das", "Gill", "Joshi", "Bose",
];
const COMPANIES = [
  "Northwind Labs", "Bluepeak Systems", "Harborline", "Cedarbyte", "Orbit Desk",
  "Fieldnote", "Lumenpath", "Sable Works", "Kindred Grid", "Paperlane",
  "Brightfold", "Copperlane", "Nimbus Hall", "Westbridge", "Plainform",
  "Aster and Co", "Highline", "Moss & Meter", "Quietpath", "Silverthread",
  "Dawnroute", "Pebbleton", "Vividline", "Oakroom", "Marlow Street",
];
const PRODUCTS = ["CRM Platform", "Voice Assist", "Inbox", "Analytics"];
const OPEN_STAGES = ["qualification", "discover", "propose", "negotiate"] as const;

const THIS_UNASSIGNED = 655_000;
const LAST_UNASSIGNED = 400_000;
const THIS_OWNED = [500_000, 480_000, 450_000, 420_000, 400_000, 380_000, 360_000, 340_000, 515_000];
const LAST_OWNED = [450_000, 420_000, 400_000, 380_000, 360_000, 350_000, 340_000, 320_000, 580_000];

type WonSpec = { amount: number; quarter: "current" | "previous"; assigned: boolean };

function wonSpec(index: number): WonSpec {
  if (index === 0) return { amount: THIS_UNASSIGNED, quarter: "current", assigned: false };
  if (index < 10) return { amount: THIS_OWNED[index - 1]!, quarter: "current", assigned: true };
  if (index === 10) return { amount: LAST_UNASSIGNED, quarter: "previous", assigned: false };
  return { amount: LAST_OWNED[index - 11]!, quarter: "previous", assigned: true };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function accountUrl(): string {
  const url = process.env.ACCOUNT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("ACCOUNT_DATABASE_URL or DATABASE_URL is required.");
  }
  return url;
}

async function loadOwnerIds(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ id: string; role: string | null }>(
    `SELECT u.id::text AS id, r.name AS role
     FROM accounts.setup_users u
     LEFT JOIN accounts.setup_user_product_access a
       ON a.user_id = u.id AND a.product_id = 'crm'
     LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE u.status = 'active' AND u.organization_id = $1::bigint
     ORDER BY u.id`,
    [ORG],
  );
  const sales = new Set(["admin", "sales_manager", "sales_rep", "presales"]);
  const ids = rows
    .filter((row) => row.role && sales.has(row.role))
    .map((row) => row.id);
  if (ids.length === 0) {
    throw new Error(`No active setup users for organization ${ORG}.`);
  }
  return ids;
}

async function upsertPerson(
  pool: Pool,
  args: {
    cdpId: string;
    email: string;
    identityId: string;
    firstName: string;
    lastName: string;
    companyName: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.customer_profile (
       cdp_id, organization_id, first_name, last_name, company, country, contact_type, acquisition_channel
     ) VALUES ($1::text, $2::bigint, $3, $4, $5, 'India', 'contact', $6)
     ON CONFLICT (cdp_id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       company = EXCLUDED.company,
       organization_id = EXCLUDED.organization_id,
       acquisition_channel = EXCLUDED.acquisition_channel`,
    [args.cdpId, ORG, args.firstName, args.lastName, args.companyName, TAG],
  );
  await pool.query(
    `INSERT INTO cdp.identity_keys (
       identity_id, cdp_id, organization_id, key_type, key_value, verified, source_system, confidence_score
     ) VALUES ($1::text, $2::text, $3::bigint, 'email', $4, false, 'crm', 1.0)
     ON CONFLICT (identity_id) DO UPDATE SET
       key_value = EXCLUDED.key_value,
       cdp_id = EXCLUDED.cdp_id`,
    [args.identityId, args.cdpId, ORG, args.email],
  );
}

async function main() {
  const pool = new Pool({ connectionString: accountUrl() });
  const bounds = kolkataQuarterBounds(new Date());
  const currentPaidAt = new Date(bounds.currentStart.getTime() + 2 * 24 * 60 * 60 * 1000);
  const previousPaidAt = new Date(bounds.previousStart.getTime() + 20 * 24 * 60 * 60 * 1000);
  const owners = await loadOwnerIds(pool);
  let ownerCursor = 0;
  const nextOwner = () => owners[ownerCursor++ % owners.length]!;

  const slots = Array<"lead" | "open" | "lost" | "won">(100).fill("lead");
  for (let company = 0; company < 20; company++) slots[company * 4] = "won";
  const rest = slots.flatMap((slot, index) => (slot === "lead" ? [index] : []));
  for (let i = 0; i < 25; i++) slots[rest[i]!] = "open";
  for (let i = 0; i < 15; i++) slots[rest[25 + i]!] = "lost";

  let wonCount = 0;
  let openCount = 0;
  let lostCount = 0;

  for (let companyIndex = 0; companyIndex < COMPANIES.length; companyIndex++) {
    const companyId = `demo1003-co-${pad(companyIndex + 1)}`;
    const locationId = `demo1003-loc-${pad(companyIndex + 1)}`;
    const companyName = COMPANIES[companyIndex]!;
    const companyOwner = nextOwner();
    await prisma.company.upsert({
      where: { id: companyId },
      create: {
        id: companyId,
        organizationId: ORG,
        name: companyName,
        domain: `demo1003-co${pad(companyIndex + 1)}.example.com`,
        industry: "Technology",
        ownerUserId: companyOwner,
      },
      update: {
        name: companyName,
        organizationId: ORG,
        ownerUserId: companyOwner,
      },
    });
    await prisma.companyLocation.upsert({
      where: { id: locationId },
      create: {
        id: locationId,
        organizationId: ORG,
        companyId,
        name: "HQ",
        type: "hq",
        city: "Chennai",
        ownerUserId: companyOwner,
      },
      update: {
        companyId,
        organizationId: ORG,
        city: "Chennai",
      },
    });
  }

  for (let index = 0; index < 100; index++) {
    const companyIndex = Math.floor(index / 4);
    const companyId = `demo1003-co-${pad(companyIndex + 1)}`;
    const locationId = `demo1003-loc-${pad(companyIndex + 1)}`;
    const companyName = COMPANIES[companyIndex]!;
    const firstName = FIRST[index % FIRST.length]!;
    const lastName = LAST[Math.floor(index / FIRST.length) % LAST.length]!;
    const email = `demo1003.contact${pad(index + 1, 3)}@example.com`;
    const cdpId = formatCdpId({
      sourceName: "crm",
      organizationId: ORG,
      externalId: `demo1003ct${pad(index + 1, 3)}`,
    });
    const slot = slots[index]!;
    const ownerUserId = nextOwner();

    await upsertPerson(pool, {
      cdpId,
      email,
      identityId: `demo1003-email-${pad(index + 1, 3)}`,
      firstName,
      lastName,
      companyName,
    });

    let convertedDealId: string | null = null;
    if (slot === "won") {
      const spec = wonSpec(wonCount);
      const dealId = `demo1003-deal-won-${pad(wonCount + 1)}`;
      const paidAt = spec.quarter === "current" ? currentPaidAt : previousPaidAt;
      const dealOwner = spec.assigned ? ownerUserId : null;
      convertedDealId = dealId;
      await prisma.deal.upsert({
        where: { id: dealId },
        create: {
          id: dealId,
          organizationId: ORG,
          title: `${companyName} expansion`,
          stage: "closed_won",
          amount: spec.amount,
          companyId,
          locationId,
          contactId: cdpId,
          contactName: `${firstName} ${lastName}`,
          contactEmail: email,
          ownerUserId: dealOwner,
          notes: TAG,
          closedAt: paidAt,
          createdAt: new Date(paidAt.getTime() - 21 * 24 * 60 * 60 * 1000),
        },
        update: {
          stage: "closed_won",
          amount: spec.amount,
          ownerUserId: dealOwner,
          closedAt: paidAt,
          companyId,
          locationId,
          contactId: cdpId,
          contactEmail: email,
        },
      });
      await upsertCommercial(dealId, wonCount + 1, spec.amount, paidAt, companyId, companyName, `${firstName} ${lastName}`, dealOwner);
      wonCount += 1;
    } else if (slot === "open") {
      const dealId = `demo1003-deal-open-${pad(openCount + 1)}`;
      convertedDealId = dealId;
      await prisma.deal.upsert({
        where: { id: dealId },
        create: {
          id: dealId,
          organizationId: ORG,
          title: `${companyName} evaluation`,
          stage: OPEN_STAGES[openCount % OPEN_STAGES.length]!,
          amount: 100_000 + openCount * 15_000,
          companyId,
          locationId,
          contactId: cdpId,
          contactName: `${firstName} ${lastName}`,
          contactEmail: email,
          ownerUserId,
          notes: TAG,
          createdAt: new Date(bounds.currentStart.getTime() - 10 * 24 * 60 * 60 * 1000),
        },
        update: {
          stage: OPEN_STAGES[openCount % OPEN_STAGES.length]!,
          amount: 100_000 + openCount * 15_000,
          ownerUserId,
          companyId,
          locationId,
          contactId: cdpId,
        },
      });
      openCount += 1;
    } else if (slot === "lost") {
      const dealId = `demo1003-deal-lost-${pad(lostCount + 1)}`;
      const closedAt = previousPaidAt;
      await prisma.deal.upsert({
        where: { id: dealId },
        create: {
          id: dealId,
          organizationId: ORG,
          title: `${companyName} renewal`,
          stage: "closed_lost",
          amount: 50_000 + lostCount * 10_000,
          companyId,
          locationId,
          contactId: cdpId,
          contactName: `${firstName} ${lastName}`,
          contactEmail: email,
          ownerUserId,
          notes: TAG,
          lostReason: "Timing",
          closedAt,
          createdAt: new Date(closedAt.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
        update: {
          stage: "closed_lost",
          amount: 50_000 + lostCount * 10_000,
          ownerUserId,
          closedAt,
          companyId,
          locationId,
          contactId: cdpId,
        },
      });
      lostCount += 1;
    }

    await prisma.contactProfile.upsert({
      where: { accountContactId: cdpId },
      create: {
        accountContactId: cdpId,
        organizationId: ORG,
        companyId,
        locationId,
        ownerUserId,
        leadSource: TAG,
        leadStatus: slot === "won" ? "converted" : slot === "lead" ? "new" : "working",
        convertedDealId,
        status: "active",
        tags: [TAG],
      },
      update: {
        organizationId: ORG,
        companyId,
        locationId,
        ownerUserId,
        leadSource: TAG,
        leadStatus: slot === "won" ? "converted" : slot === "lead" ? "new" : "working",
        convertedDealId,
      },
    });
  }

  console.log(
    JSON.stringify({
      organizationId: ORG,
      companies: COMPANIES.length,
      contacts: 100,
      openDeals: openCount,
      wonDeals: wonCount,
      lostDeals: lostCount,
      leads: slots.filter((slot) => slot === "lead").length,
      thisQuarterInr: THIS_UNASSIGNED + THIS_OWNED.reduce((sum, n) => sum + n, 0),
      lastQuarterInr: LAST_UNASSIGNED + LAST_OWNED.reduce((sum, n) => sum + n, 0),
      quarter: bounds.quarterLabel,
      previousQuarter: bounds.previousQuarterLabel,
    }),
  );
  await pool.end();
  await prisma.$disconnect();
}

async function upsertCommercial(
  dealId: string,
  sequence: number,
  amount: number,
  paidAt: Date,
  companyId: string,
  companyName: string,
  customerName: string,
  ownerUserId: string | null,
) {
  const quoteId = `demo1003-quote-${pad(sequence)}`;
  const invoiceId = `demo1003-inv-${pad(sequence)}`;
  const product = PRODUCTS[(sequence - 1) % PRODUCTS.length]!;
  await prisma.quote.upsert({
    where: { id: quoteId },
    create: {
      id: quoteId,
      organizationId: ORG,
      dealId,
      number: `DEMO-1003-Q-${pad(sequence, 3)}`,
      status: "accepted",
      currency: "INR",
      subtotal: amount,
      total: amount,
      customerName,
      companyName,
      sentAt: paidAt,
      acceptedAt: paidAt,
      approvalStatus: "approved",
      createdByUserId: ownerUserId,
    },
    update: {
      dealId,
      status: "accepted",
      currency: "INR",
      subtotal: amount,
      total: amount,
      acceptedAt: paidAt,
    },
  });
  await prisma.quoteLine.upsert({
    where: { id: `demo1003-qline-${pad(sequence)}` },
    create: {
      id: `demo1003-qline-${pad(sequence)}`,
      organizationId: ORG,
      quoteId,
      name: product,
      quantity: 1,
      unitPrice: amount,
      amount,
    },
    update: { name: product, unitPrice: amount, amount },
  });
  await prisma.invoice.upsert({
    where: { id: invoiceId },
    create: {
      id: invoiceId,
      organizationId: ORG,
      dealId,
      companyId,
      number: `DEMO-1003-${pad(sequence, 3)}`,
      status: "paid",
      currency: "INR",
      total: amount,
      issueDate: paidAt,
      dueAt: paidAt,
      paidAt,
      sentAt: paidAt,
      approvalStatus: "approved",
      createdByUserId: ownerUserId,
      notes: TAG,
    },
    update: {
      dealId,
      companyId,
      status: "paid",
      currency: "INR",
      total: amount,
      paidAt,
    },
  });
  await prisma.invoiceLine.upsert({
    where: { id: `demo1003-iline-${pad(sequence)}` },
    create: {
      id: `demo1003-iline-${pad(sequence)}`,
      organizationId: ORG,
      invoiceId,
      kind: "product",
      name: product,
      quantity: 1,
      unitPrice: amount,
      amount,
    },
    update: { name: product, unitPrice: amount, amount, invoiceId },
  });
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

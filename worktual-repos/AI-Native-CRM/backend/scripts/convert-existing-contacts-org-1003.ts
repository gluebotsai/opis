/**
 * Convert 20 existing org-1003 contacts into a mixed pipeline book.
 * Reuses live contacts, companies, locations, CRM users, and inventory products.
 * Does not insert CDP people or catalog SKUs.
 *
 * Run from backend/:
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/convert-existing-contacts-org-1003.ts
 *
 * Re-running removes only the previous TAG book, then recreates it.
 */
import "./load-repo-env.ts";
import type { DealStage, InvoiceStatus, QuoteStatus } from "@prisma/client";
import { Pool } from "pg";
import { prisma } from "../src/dao/db/prisma";
import { kolkataQuarterBounds } from "../src/dao/home/revenue-board";

const ORG = "1003";
const TAG = "existing-book-1003";
const SALES_ROLES = new Set(["admin", "sales_manager", "sales_rep", "presales"]);

const STAGES: Array<{
  stage: DealStage;
  quote?: QuoteStatus;
  invoice?: InvoiceStatus;
  lostReason?: string;
  quarter?: "current" | "previous";
}> = [
  { stage: "qualification", quote: "draft" },
  { stage: "qualification", quote: "draft" },
  { stage: "qualification", quote: "draft" },
  { stage: "qualification", quote: "draft" },
  { stage: "discover", quote: "draft" },
  { stage: "discover", quote: "draft" },
  { stage: "discover", quote: "draft" },
  { stage: "propose", quote: "sent" },
  { stage: "propose", quote: "sent" },
  { stage: "propose", quote: "sent" },
  { stage: "negotiate", quote: "sent" },
  { stage: "negotiate", quote: "sent" },
  { stage: "negotiate", quote: "sent" },
  { stage: "closed_won", quote: "accepted", invoice: "paid", quarter: "current" },
  { stage: "closed_won", quote: "accepted", invoice: "paid", quarter: "current" },
  { stage: "closed_won", quote: "accepted", invoice: "paid", quarter: "current" },
  { stage: "closed_won", quote: "accepted", invoice: "paid", quarter: "previous" },
  { stage: "closed_won", quote: "accepted", invoice: "sent", quarter: "current" },
  { stage: "closed_lost", quote: "rejected", lostReason: "Pricing" },
  { stage: "closed_lost", quote: "rejected", lostReason: "Timing" },
];

function accountUrl(): string {
  const url = process.env.ACCOUNT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("ACCOUNT_DATABASE_URL or DATABASE_URL is required.");
  return url;
}

function displayName(first: string | null, last: string | null): string {
  return `${first ?? ""} ${last ?? ""}`.replace(/\s+/g, " ").trim() || "Unknown";
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function nextSeq(table: "quotes" | "sales_orders" | "invoices"): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ max_seq: number | null }>>(
    `SELECT COALESCE(MAX((substring(number FROM '(\\d+)$'))::int), 0)::int AS max_seq
     FROM crm.${table}
     WHERE organization_id = $1::bigint`,
    ORG,
  );
  return Number(rows[0]?.max_seq ?? 0) + 1;
}

async function loadOwners(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ id: string; role: string | null }>(
    `SELECT u.id::text AS id, lower(replace(r.name, ' ', '_')) AS role
     FROM accounts.setup_users u
     LEFT JOIN accounts.setup_user_product_access a
       ON a.user_id = u.id AND a.product_id = 'crm'
     LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE u.status = 'active' AND u.organization_id = $1::bigint
     ORDER BY u.id`,
    [ORG],
  );
  const ids = rows.filter((row) => row.role && SALES_ROLES.has(row.role)).map((row) => row.id);
  if (ids.length < 2) {
    throw new Error(`Need at least 2 CRM sales users in org ${ORG}.`);
  }
  return ids;
}

type ProductRow = { id: string; name: string; currency: string; price: number };

async function loadProducts(): Promise<ProductRow[]> {
  const rows = await prisma.product.findMany({
    where: { organizationId: ORG, status: "active" },
    select: { id: true, name: true, currency: true, price: true },
    orderBy: { name: "asc" },
  });
  const usable = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      currency: row.currency,
      price: Number(row.price ?? 0),
    }))
    .filter((row) => row.price > 0 && row.price < 1_000_000);
  if (usable.length === 0) {
    throw new Error(`No usable active inventory.products for org ${ORG}.`);
  }
  return usable;
}

type ContactRow = {
  profile_id: string;
  account_contact_id: string;
  company_id: string;
  location_id: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  email: string | null;
};

async function loadContacts(pool: Pool): Promise<ContactRow[]> {
  const { rows } = await pool.query<ContactRow>(
    `SELECT DISTINCT ON (p.company_id)
        p.id AS profile_id,
        p.account_contact_id,
        p.company_id,
        p.location_id,
        cp.first_name,
        cp.last_name,
        cp.company,
        (
          SELECT ik.key_value FROM cdp.identity_keys ik
          WHERE ik.cdp_id = p.account_contact_id AND ik.key_type = 'email'
          LIMIT 1
        ) AS email
     FROM crm.contact_profiles p
     JOIN cdp.customer_profile cp ON cp.cdp_id = p.account_contact_id
     WHERE p.organization_id = $1::bigint
       AND p.converted_deal_id IS NULL
       AND p.company_id IS NOT NULL
       AND coalesce(p.lead_status, '') NOT IN ('disqualified', 'converted')
       AND p.lead_status !~ '^[0-9]+$'
       AND p.account_contact_id NOT LIKE 'CDP-crm-org1003-demo1003ct%'
       AND coalesce(cp.first_name, '') <> ''
       AND lower(coalesce(cp.first_name, '')) NOT LIKE 'visitor%'
       AND NOT EXISTS (
         SELECT 1 FROM crm.deals d
         WHERE d.organization_id = $1::bigint
           AND d.contact_id = p.account_contact_id
           AND d.notes = $2
       )
     ORDER BY p.company_id,
              CASE WHEN (
                SELECT ik.key_value FROM cdp.identity_keys ik
                WHERE ik.cdp_id = p.account_contact_id AND ik.key_type = 'email'
                LIMIT 1
              ) IS NOT NULL THEN 0 ELSE 1 END,
              p.updated_at DESC
     LIMIT 20`,
    [ORG, TAG],
  );
  if (rows.length < 20) {
    throw new Error(`Need 20 unconverted contacts with companies; found ${rows.length}.`);
  }
  return rows;
}

async function purgePreviousBook() {
  const deals = await prisma.deal.findMany({
    where: { organizationId: ORG, notes: TAG },
    select: { id: true },
  });
  const dealIds = deals.map((deal) => deal.id);
  if (dealIds.length === 0) return;

  const quotes = await prisma.quote.findMany({
    where: { organizationId: ORG, dealId: { in: dealIds } },
    select: { id: true },
  });
  const quoteIds = quotes.map((quote) => quote.id);
  const orders = await prisma.salesOrder.findMany({
    where: { organizationId: ORG, dealId: { in: dealIds } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: ORG, dealId: { in: dealIds } },
    select: { id: true },
  });
  const invoiceIds = invoices.map((invoice) => invoice.id);

  if (invoiceIds.length) {
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  if (orderIds.length) {
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (quoteIds.length) {
    await prisma.quoteLine.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
  }
  await prisma.dealActivity.deleteMany({ where: { dealId: { in: dealIds } } });
  await prisma.contactProfile.updateMany({
    where: { organizationId: ORG, convertedDealId: { in: dealIds } },
    data: { convertedDealId: null, leadStatus: "qualified" },
  });
  await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
}

async function main() {
  const pool = new Pool({ connectionString: accountUrl() });
  try {
    await purgePreviousBook();
    const [owners, products, contacts] = await Promise.all([
      loadOwners(pool),
      loadProducts(),
      loadContacts(pool),
    ]);
    const bounds = kolkataQuarterBounds(new Date());
    const currentPaidAt = new Date(bounds.currentStart.getTime() + 3 * 24 * 60 * 60 * 1000);
    const previousPaidAt = new Date(bounds.previousStart.getTime() + 20 * 24 * 60 * 60 * 1000);

    let quoteSeq = await nextSeq("quotes");
    let orderSeq = await nextSeq("sales_orders");
    let invoiceSeq = await nextSeq("invoices");

    const summary: Array<Record<string, string>> = [];

    for (let index = 0; index < 20; index++) {
      const contact = contacts[index]!;
      const spec = STAGES[index]!;
      const ownerUserId = owners[index % owners.length]!;
      const product = products[index % products.length]!;
      const quantity = (index % 3) + 1;
      const unitPrice = product.price;
      const amount = unitPrice * quantity;
      const personName = displayName(contact.first_name, contact.last_name);
      const companyName = contact.company?.trim() || personName;
      const title = companyName === personName ? companyName : `${companyName} — ${personName}`;
      const now = new Date();

      let locationId = contact.location_id;
      if (!locationId) {
        const existing = await prisma.companyLocation.findFirst({
          where: { companyId: contact.company_id },
          orderBy: { createdAt: "asc" },
        });
        if (existing) {
          locationId = existing.id;
        } else {
          const loc = await prisma.companyLocation.create({
            data: {
              organizationId: ORG,
              companyId: contact.company_id,
              name: "HQ",
              type: "hq",
              ownerUserId,
            },
          });
          locationId = loc.id;
        }
      }

      const terminal = spec.stage === "closed_won" || spec.stage === "closed_lost";
      const eventAt =
        spec.invoice === "paid" && spec.quarter === "previous"
          ? previousPaidAt
          : spec.invoice === "paid" || spec.invoice === "sent"
            ? currentPaidAt
            : terminal
              ? daysAgo(10 + index)
              : now;
      const createdAt = new Date(eventAt.getTime() - 21 * 24 * 60 * 60 * 1000);

      const deal = await prisma.deal.create({
        data: {
          organizationId: ORG,
          title,
          stage: spec.stage,
          amount,
          companyId: contact.company_id,
          locationId,
          contactId: contact.account_contact_id,
          contactName: personName,
          contactEmail: contact.email,
          ownerUserId,
          notes: TAG,
          lostReason: spec.lostReason ?? null,
          expectedCloseDate: terminal ? eventAt : new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000),
          closedAt: terminal ? eventAt : null,
          createdAt,
        },
      });

      await prisma.contactProfile.update({
        where: { id: contact.profile_id },
        data: {
          ownerUserId,
          assignedAt: createdAt,
          assignmentBaselineStatus: "qualified",
          companyId: contact.company_id,
          locationId,
          leadStatus: "converted",
          convertedDealId: deal.id,
        },
      });

      const company = await prisma.company.findUnique({
        where: { id: contact.company_id },
        select: { ownerUserId: true },
      });
      if (!company?.ownerUserId) {
        await prisma.company.update({
          where: { id: contact.company_id },
          data: { ownerUserId },
        });
      }

      await pool.query(
        `UPDATE cdp.customer_profile
         SET contact_type = $1, updated_at = NOW()
         WHERE cdp_id = $2 AND organization_id = $3::bigint`,
        [spec.stage === "closed_won" ? "customer" : "prospect", contact.account_contact_id, ORG],
      );

      await prisma.dealActivity.create({
        data: {
          organizationId: ORG,
          dealId: deal.id,
          type: "note",
          subject:
            spec.stage === "closed_won"
              ? "Deal won — commercial pack recorded"
              : spec.stage === "closed_lost"
                ? `Closed lost — ${spec.lostReason}`
                : "Opportunity opened from converted contact",
          createdByUserId: ownerUserId,
          createdAt,
        },
      });

      if (spec.quote) {
        const quoteNumber = `Q-${String(quoteSeq).padStart(5, "0")}`;
        quoteSeq += 1;
        const sentAt = spec.quote === "draft" ? null : eventAt;
        const acceptedAt = spec.quote === "accepted" ? eventAt : null;
        const quote = await prisma.quote.create({
          data: {
            organizationId: ORG,
            dealId: deal.id,
            number: quoteNumber,
            version: 1,
            status: spec.quote,
            currency: product.currency,
            subtotal: amount,
            discountPct: 0,
            total: amount,
            companyName,
            customerName: personName,
            vendorName: "Worktual",
            sentAt,
            acceptedAt,
            approvalStatus: spec.quote === "draft" ? "drafting" : "approved",
            createdByUserId: ownerUserId,
            createdAt,
            lines: {
              create: [
                {
                  organizationId: ORG,
                  productId: product.id,
                  name: product.name,
                  quantity,
                  unitPrice,
                  amount,
                  sortOrder: 0,
                },
              ],
            },
          },
        });

        if (spec.quote === "accepted") {
          const orderNumber = `SO-${String(orderSeq).padStart(5, "0")}`;
          orderSeq += 1;
          const order = await prisma.salesOrder.create({
            data: {
              organizationId: ORG,
              dealId: deal.id,
              quoteId: quote.id,
              companyId: contact.company_id,
              contactId: contact.account_contact_id,
              number: orderNumber,
              status: "confirmed",
              currency: product.currency,
              total: amount,
              confirmedAt: eventAt,
              createdByUserId: ownerUserId,
              createdAt: eventAt,
              lines: {
                create: [
                  {
                    organizationId: ORG,
                    productId: product.id,
                    name: product.name,
                    quantity,
                    unitPrice,
                    amount,
                    sortOrder: 0,
                  },
                ],
              },
            },
          });

          if (spec.invoice) {
            const invoiceNumber = `INV-${String(invoiceSeq).padStart(5, "0")}`;
            invoiceSeq += 1;
            const dueAt = new Date(eventAt.getTime() + 30 * 24 * 60 * 60 * 1000);
            const paid = spec.invoice === "paid";
            await prisma.invoice.create({
              data: {
                organizationId: ORG,
                orderId: order.id,
                dealId: deal.id,
                companyId: contact.company_id,
                number: invoiceNumber,
                status: spec.invoice,
                currency: product.currency,
                total: amount,
                discountAmount: 0,
                taxAmount: 0,
                issueDate: eventAt,
                dueAt,
                paidAt: paid ? eventAt : null,
                sentAt: eventAt,
                leadEmail: contact.email,
                billingKind: "standard",
                approvalStatus: "approved",
                approvedAt: eventAt,
                approvedByUserId: ownerUserId,
                dunningStage: "none",
                createdByUserId: ownerUserId,
                createdAt: eventAt,
                notes: TAG,
                lines: {
                  create: [
                    {
                      organizationId: ORG,
                      kind: "product",
                      productId: product.id,
                      name: product.name,
                      quantity,
                      unitPrice,
                      taxPercent: 0,
                      amount,
                      sortOrder: 0,
                    },
                  ],
                },
              },
            });
          }
        }
      }

      summary.push({
        stage: spec.stage,
        owner: ownerUserId,
        contact: personName,
        company: companyName,
        product: product.name,
        amount: String(amount),
      });
    }

    console.log(
      JSON.stringify(
        {
          organizationId: ORG,
          tag: TAG,
          converted: summary.length,
          owners: owners,
          products: products.map((p) => p.id),
          byStage: summary.reduce<Record<string, number>>((acc, row) => {
            acc[row.stage] = (acc[row.stage] ?? 0) + 1;
            return acc;
          }, {}),
          rows: summary,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

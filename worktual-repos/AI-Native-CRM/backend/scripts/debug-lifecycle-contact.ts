/**
 * Debug lifecycle state for a contact by email.
 * Usage: npx tsx --env-file=../.env scripts/debug-lifecycle-contact.ts sample151102@gmail.com
 */
import { prisma } from "../src/dao/db/prisma.js";
import { buildLifecycleContext } from "../src/service/ai/lead-lifecycle-context.js";
import { decideLifecycleHeuristic } from "../src/service/ai/lead-lifecycle-decide.js";

const email = process.argv[2]?.trim() || "sample151102@gmail.com";

async function main() {
  const contacts = await prisma.$queryRawUnsafe<
    Array<{
      contact_id: string;
      owner_user_id: string | null;
      org_id: string;
      lead_status: string | null;
      lifecycle_last_action: string | null;
      lifecycle_last_reason: string | null;
      lifecycle_last_run_at: Date | null;
      email: string;
      name: string;
    }>
  >(
    `
    SELECT cp.account_contact_id AS contact_id, cp.owner_user_id::text, cp.organization_id::text,
           cp.lead_status, cp.lifecycle_last_action, cp.lifecycle_last_reason,
           cp.lifecycle_last_run_at, lower(ik.key_value) AS email,
           trim(both FROM coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) AS name
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
    JOIN cdp.identity_keys ik ON ik.cdp_id = p.cdp_id AND ik.key_type = 'email'
    WHERE lower(ik.key_value) = lower($1)
    `,
    email,
  );

  if (!contacts.length) {
    console.log("NO CONTACT for", email);
    return;
  }
  const c = contacts[0]!;
  console.log("CONTACT", JSON.stringify(c, null, 2));

  const deals = await prisma.deal.findMany({
    where: { contactId: c.contact_id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      stage: true,
      ownerUserId: true,
      updatedAt: true,
    },
  });
  console.log("DEALS", JSON.stringify(deals, null, 2));

  for (const d of deals) {
    const quotes = await prisma.quote.findMany({
      where: { dealId: d.id },
      select: { id: true, number: true, status: true, acceptedAt: true },
    });
    const proposals = await prisma.proposal.findMany({
      where: { dealId: d.id },
      select: { id: true, number: true, status: true },
    });
    const invoices = await prisma.invoice.findMany({
      where: { dealId: d.id },
      select: { id: true, number: true, status: true },
    });
    console.log("DEAL_DETAIL", d.id, { quotes, proposals, invoices });
  }

  const jobs = await prisma.leadLifecycleJob.findMany({
    where: { contactId: c.contact_id },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      id: true,
      status: true,
      triggerReason: true,
      decision: true,
      fromStage: true,
      toStage: true,
      reason: true,
      resultSummary: true,
      updatedAt: true,
    },
  });
  console.log("LIFECYCLE_JOBS", JSON.stringify(jobs, null, 2));

  const confirmations = await prisma.processConfirmation.findMany({
    where: { contactId: c.contact_id },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      actionKind: true,
      status: true,
      title: true,
      summary: true,
      ownerUserId: true,
      createdAt: true,
    },
  });
  console.log("CONFIRMATIONS", JSON.stringify(confirmations, null, 2));

  const ctx = await buildLifecycleContext(c.contact_id, c.org_id);
  if (ctx) {
    const heuristic = decideLifecycleHeuristic(ctx);
    console.log(
      "HEURISTIC",
      JSON.stringify(
        {
          dealStage: ctx.deal?.stage,
          quotes: ctx.deal?.quotes,
          paymentConfirmed: ctx.signals.paymentConfirmed,
          decision: heuristic,
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

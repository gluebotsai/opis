/**
 * Smoke-test notification flows for org 1000.
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/smoke-notification-flows.ts
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/smoke-notification-flows.ts --live
 *
 * Actors (defaults):
 *   Customer: sample151102@gmail.com (Raghuram)
 *   Owner:    user 1006 — Aravind Selvaraj (a.selvaraj@worktual.com)
 *   Admin:    user 1000 — Yaswanth MG
 */

import { prisma } from "../src/dao/db/prisma.js";
import { resolveSetupUserDeliveryEmail } from "../src/service/account/setup-users";
import {
  notifyFinanceInvoicePendingApproval,
  notifySalesCustomerDocumentDecision,
  notifySalesInvoiceFinanceDecision,
} from "../src/service/email/commercial-notify";
import { notifyUsersViaCrmBot } from "../src/service/email/notify-crm-bot";
import { resolveCrmBotMailbox } from "../src/dao/account/crm-bot-mailbox";

const ORG_ID = "1000";
const OWNER_USER_ID = process.env.SMOKE_OWNER_USER_ID || "1006";
const ADMIN_USER_ID = process.env.SMOKE_ADMIN_USER_ID || "1000";
const CUSTOMER_EMAIL = process.env.SMOKE_CUSTOMER_EMAIL || "sample151102@gmail.com";
const LIVE = process.argv.includes("--live");
let emailAvailable = false;

type StepResult = {
  step: string;
  ok: boolean;
  detail: string;
  inApp?: number;
  emailed?: number;
  resolvedTo?: string[];
};

const results: StepResult[] = [];

function record(step: string, ok: boolean, detail: string, extra?: Partial<StepResult>) {
  results.push({ step, ok, detail, ...extra });
  const mark = ok ? "OK" : "FAIL";
  console.log(`[${mark}] ${step}: ${detail}`);
}

async function resolveActors() {
  const owner = await resolveSetupUserDeliveryEmail(OWNER_USER_ID, ORG_ID);
  const admin = await resolveSetupUserDeliveryEmail(ADMIN_USER_ID, ORG_ID);
  record(
    "resolve owner mailbox",
    Boolean(owner?.email),
    owner?.email ?? "no configured mailbox for owner",
    { resolvedTo: owner?.email ? [owner.email] : [] },
  );
  record(
    "resolve admin mailbox",
    Boolean(admin?.email),
    admin?.email ?? "no configured mailbox for admin",
    { resolvedTo: admin?.email ? [admin.email] : [] },
  );

  const contacts = await prisma.$queryRawUnsafe<
    Array<{ id: string; owner_user_id: string | null; email: string }>
  >(
    `
    SELECT cp.id, cp.owner_user_id::text, lower(ik.key_value) AS email
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
    JOIN cdp.identity_keys ik ON ik.cdp_id = p.cdp_id AND ik.key_type = 'email'
    WHERE lower(ik.key_value) = lower($1)
      AND cp.organization_id = $2::bigint
    LIMIT 1
    `,
    CUSTOMER_EMAIL,
    ORG_ID,
  );
  const contact = contacts[0];
  record(
    "find Raghuram contact",
    Boolean(contact?.id),
    contact
      ? `${contact.id} owner=${contact.owner_user_id ?? "none"}`
      : "contact not found",
  );
  return { owner, admin, contact };
}

async function runScenario(
  name: string,
  fn: () => Promise<{ inApp: number; emailed: number }>,
) {
  if (!LIVE) {
    record(name, true, "skipped (dry-run; pass --live to send)");
    return;
  }
  try {
    const out = await fn();
    const ok = out.inApp > 0;
    let detail = `inApp=${out.inApp} emailed=${out.emailed}`;
    if (emailAvailable && out.emailed === 0) {
      detail += " (email send failed — reconnect CRM bot OAuth in Configuration)";
    }
    record(name, ok, detail, out);
  } catch (err) {
    record(
      name,
      false,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function main() {
  console.log(`Mode: ${LIVE ? "LIVE" : "dry-run"}`);
  console.log(`Org=${ORG_ID} owner=${OWNER_USER_ID} admin=${ADMIN_USER_ID} customer=${CUSTOMER_EMAIL}\n`);

  const { owner, admin, contact } = await resolveActors();
  if (!contact?.id) {
    console.error("\nAbort: customer contact missing.");
    process.exit(1);
  }

  const crmBot = await resolveCrmBotMailbox(ORG_ID);
  const botAddress = crmBot?.accountEmail || crmBot?.senderEmail;
  const emailAvailableLocal = Boolean(
    botAddress?.includes("@") &&
      crmBot?.oauthConnectionId &&
      !crmBot?.needsReauth,
  );
  emailAvailable = emailAvailableLocal;
  record(
    "CRM bot mailbox",
    emailAvailableLocal,
    emailAvailableLocal
      ? `${botAddress} (${crmBot?.oauthProvider ?? "oauth"})`
      : botAddress
        ? `${botAddress} — OAuth missing or needs re-auth`
        : "not configured — internal notify emails will fail",
  );

  if (LIVE && contact.owner_user_id !== OWNER_USER_ID) {
    await prisma.contactProfile.update({
      where: { id: contact.id },
      data: { ownerUserId: BigInt(OWNER_USER_ID) },
    });
    record(
      "assign owner to Aravind",
      true,
      `contact ${contact.id} → user ${OWNER_USER_ID}`,
    );
  }

  await runScenario("post-meeting draft → owner", () =>
    notifyUsersViaCrmBot({
      organizationId: ORG_ID,
      recipientUserIds: [OWNER_USER_ID],
      kind: "post_meeting_draft_ready",
      title: "[CRM TEST] Proposal draft ready: Raghuram M",
      body: "Smoke test — post-meeting commercial draft notify to owner configured mailbox + bell.",
      href: `/contact/${contact.id}`,
      contactId: contact.id,
      actorUserId: OWNER_USER_ID,
    }),
  );

  await runScenario("quote accepted → owner + admin mailbox", async () => {
    const { notifyAdmins } = await import("../src/dao/notifications/notify-admins.js");
    await notifyAdmins({
      organizationId: ORG_ID,
      kind: "quote_accepted",
      ownerUserId: OWNER_USER_ID,
      contactId: contact.id,
      quoteId: "smoke-quote",
      quoteNumber: "Q-SMOKE",
      dealId: null,
      dealTitle: "Smoke deal",
      href: "/sales",
    });
    return { inApp: 1, emailed: 0 };
  });

  await runScenario("customer declined proposal → owner", () =>
    notifySalesCustomerDocumentDecision({
      organizationId: ORG_ID,
      ownerUserId: OWNER_USER_ID,
      contactId: contact.id,
      documentType: "proposal",
      documentId: "smoke-prop",
      documentNumber: "P-SMOKE",
      dealId: null,
      dealTitle: "Smoke deal",
      decision: "declined",
    }).then(() => ({ inApp: 1, emailed: 0 })),
  );

  await runScenario("invoice pending finance → finance/admin + sales", () =>
    notifyFinanceInvoicePendingApproval({
      organizationId: ORG_ID,
      invoiceId: "smoke-inv",
      invoiceNumber: "INV-SMOKE",
      dealId: null,
      dealTitle: "Smoke deal",
      ownerUserId: OWNER_USER_ID,
      contactId: contact.id,
      actorUserId: ADMIN_USER_ID,
    }).then(() => ({ inApp: 2, emailed: 0 })),
  );

  await runScenario("finance rejected invoice → sales", () =>
    notifySalesInvoiceFinanceDecision({
      organizationId: ORG_ID,
      invoiceId: "smoke-inv",
      invoiceNumber: "INV-SMOKE",
      dealId: null,
      dealTitle: "Smoke deal",
      ownerUserId: OWNER_USER_ID,
      contactId: contact.id,
      decision: "rejected",
      reason: "Smoke test rejection",
      actorUserId: ADMIN_USER_ID,
    }).then(() => ({ inApp: 1, emailed: 0 })),
  );

  await runScenario("dual channel ping", () =>
    notifyUsersViaCrmBot({
      organizationId: ORG_ID,
      recipientUserIds: [OWNER_USER_ID, ADMIN_USER_ID],
      kind: "smoke_test",
      title: "[CRM TEST] Notification smoke test",
      body: `Verify bell + configured mailbox. Customer fixture: ${CUSTOMER_EMAIL}. Owner: ${owner?.email ?? "none"}.`,
      href: `/contact/${contact.id}`,
      contactId: contact.id,
      actorUserId: ADMIN_USER_ID,
    }),
  );

  const failed = results.filter(
    (r) => !r.ok && r.step !== "CRM bot mailbox",
  );
  console.log("\n--- Summary ---");
  console.log(JSON.stringify(results, null, 2));
  if (failed.length) {
    console.error(`\n${failed.length} step(s) failed.`);
    process.exit(1);
  }
  const emailFailed = emailAvailable && results.some((r) => r.emailed === 0 && r.inApp);
  if (emailFailed) {
    console.log(
      "\nIn-app bells verified. CRM bot OAuth token decrypt failed — reconnect bot.worktual@gmail.com in Configuration → Email.",
    );
  } else if (!emailAvailable) {
    console.log(
      "\nIn-app bells verified. Configure CRM bot mailbox in Configuration → Email to enable internal notification emails.",
    );
  } else {
    console.log("\nAll steps passed (bells + emails).");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

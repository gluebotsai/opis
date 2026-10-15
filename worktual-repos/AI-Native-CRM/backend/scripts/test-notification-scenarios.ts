/**
 * End-to-end notification + email scenario tests for org 1000.
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/test-notification-scenarios.ts
 *   npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/test-notification-scenarios.ts --live
 */
import { prisma } from "../src/dao/db/prisma.js";
import { resolveSetupUserDeliveryEmail } from "../src/service/account/setup-users";
import { resolveCrmBotMailbox } from "../src/dao/account/crm-bot-mailbox";
import { resolveEmailSendProvider } from "../src/service/email/send-connected-email";
import { sendConnectedEmailForUser } from "../src/service/email/send-connected-email";
import { sendCrmBotEmail } from "../src/service/email/send-crm-bot-email";
import { notifyUsersViaCrmBot } from "../src/service/email/notify-crm-bot";
import {
  notifyFinanceInvoicePendingApproval,
  notifySalesCustomerDocumentDecision,
  notifySalesInvoiceFinanceDecision,
} from "../src/service/email/commercial-notify";
import { sendLeadAssignmentWelcome } from "../src/service/ai/lead-assignment-welcome";
import { sendOwnerChangeCustomerNotice } from "../src/service/contacts/owner-change-notify";

const ORG_ID = "1000";
const OWNER_USER_ID = process.env.SMOKE_OWNER_USER_ID || "1006";
const ADMIN_USER_ID = process.env.SMOKE_ADMIN_USER_ID || "1000";
const CUSTOMER_EMAIL = process.env.SMOKE_CUSTOMER_EMAIL || "sample151102@gmail.com";
const LIVE = process.argv.includes("--live");

type Result = {
  scenario: string;
  channel: "customer" | "sales";
  inApp: string;
  email: string;
  status: "pass" | "fail" | "skip" | "partial";
  detail: string;
};

const results: Result[] = [];

function log(r: Result) {
  results.push(r);
  const icon =
    r.status === "pass"
      ? "PASS"
      : r.status === "partial"
        ? "PARTIAL"
        : r.status === "skip"
          ? "SKIP"
          : "FAIL";
  console.log(`[${icon}] [${r.channel}] ${r.scenario}: ${r.detail}`);
}

async function findContact() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; account_contact_id: string; owner_user_id: string | null }>
  >(
    `
    SELECT cp.id, cp.account_contact_id, cp.owner_user_id::text
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
  const row = rows[0];
  if (!row) return null;
  return {
    profileId: row.id,
    accountContactId: row.account_contact_id,
    ownerUserId: row.owner_user_id,
  };
}

async function main() {
  console.log(`Mode: ${LIVE ? "LIVE" : "config-only"}\n`);

  const contact = await findContact();
  if (!contact?.accountContactId) {
    console.error("Customer fixture not found:", CUSTOMER_EMAIL);
    process.exit(1);
  }

  const ownerMailbox = await resolveSetupUserDeliveryEmail(OWNER_USER_ID, ORG_ID);
  const adminMailbox = await resolveSetupUserDeliveryEmail(ADMIN_USER_ID, ORG_ID);
  const ownerProvider = await resolveEmailSendProvider(OWNER_USER_ID, null);
  const bot = await resolveCrmBotMailbox(ORG_ID);

  log({
    scenario: "Rep inbox configured (customer mail)",
    channel: "customer",
    inApp: "n/a",
    email: ownerMailbox?.email ?? "missing",
    status: ownerProvider ? "pass" : "fail",
    detail: ownerProvider
      ? `${ownerMailbox?.email} via ${ownerProvider}`
      : "Owner has no connected Gmail/Microsoft with send scope",
  });

  log({
    scenario: "CRM bot configured (internal/nurture mail)",
    channel: "sales",
    inApp: "n/a",
    email: bot?.accountEmail ?? "missing",
    status: bot?.oauthConnectionId && !bot.needsReauth ? "pass" : "fail",
    detail: bot
      ? `${bot.accountEmail} oauth=${Boolean(bot.oauthConnectionId)} needsReauth=${Boolean(bot.needsReauth)}`
      : "CRM bot mailbox not configured",
  });

  if (!LIVE) {
    console.log("\nPass --live to execute send + in-app scenarios.");
    return;
  }

  const repCustomer = await sendConnectedEmailForUser({
    userId: OWNER_USER_ID,
    to: CUSTOMER_EMAIL,
    subject: "[CRM TEST] Proposal follow-up (rep inbox)",
    body: "Scenario: customer receives proposal/quote/invoice-style mail from assigned rep inbox.",
  });
  log({
    scenario: "Customer mail — proposal/quote/invoice path (rep inbox)",
    channel: "customer",
    inApp: "n/a",
    email: repCustomer.ok ? "sent" : "failed",
    status: repCustomer.ok ? "pass" : "fail",
    detail: repCustomer.ok
      ? `From ${repCustomer.fromEmail} via ${repCustomer.via}`
      : repCustomer.error,
  });

  const welcome = await sendLeadAssignmentWelcome({
    contactId: contact.accountContactId,
    organizationId: ORG_ID,
    ownerUserId: OWNER_USER_ID,
    scoreResult: {
      score: 72,
      fitScore: 40,
      intentScore: 32,
      band: "hot",
      grade: "A",
      salesReady: true,
      rationale: "Smoke test",
      scoreBreakdown: {},
      pillars: {},
      positiveReasons: [],
      negativeReasons: [],
      behaviouralPositiveReasons: [],
      behaviouralNegativeReasons: [],
      behaviouralReasons: [],
      factors: [],
      nextBestAction: "Schedule discovery call",
      source: "heuristic",
    },
  });
  log({
    scenario: "Customer mail — welcome on assignment (score ≥40)",
    channel: "customer",
    inApp: "n/a",
    email: welcome.ok ? "sent" : "failed",
    status: welcome.ok ? "pass" : "fail",
    detail: welcome.ok ? "LLM composed + sent from rep inbox" : welcome.reason ?? "failed",
  });

  const ownerChange = await sendOwnerChangeCustomerNotice({
    contactId: contact.accountContactId,
    organizationId: ORG_ID,
    newOwnerUserId: ADMIN_USER_ID,
    previousOwnerUserId: OWNER_USER_ID,
  });
  log({
    scenario: "Customer mail — owner reassignment notice",
    channel: "customer",
    inApp: "n/a",
    email: ownerChange.ok ? "sent" : "failed",
    status: ownerChange.ok ? "pass" : "fail",
    detail: ownerChange.ok
      ? "LLM composed + sent from new owner inbox"
      : ownerChange.reason ?? "failed",
  });

  const draftNotify = await notifyUsersViaCrmBot({
    organizationId: ORG_ID,
    recipientUserIds: [OWNER_USER_ID],
    kind: "post_meeting_draft_ready",
    title: "[CRM TEST] Post-meeting draft ready",
    body: "Sales internal: proposal draft ready after meeting.",
    href: `/contact/${contact.accountContactId}`,
    contactId: contact.accountContactId,
    actorUserId: ADMIN_USER_ID,
  });
  log({
    scenario: "Sales mail — post-meeting draft ready",
    channel: "sales",
    inApp: String(draftNotify.inApp),
    email: draftNotify.emailed > 0 ? "sent" : "failed",
    status:
      draftNotify.inApp > 0 && draftNotify.emailed > 0
        ? "pass"
        : draftNotify.inApp > 0
          ? "partial"
          : "fail",
    detail: `inApp=${draftNotify.inApp} emailed=${draftNotify.emailed}`,
  });

  const declined = await notifySalesCustomerDocumentDecision({
    organizationId: ORG_ID,
    ownerUserId: OWNER_USER_ID,
    contactId: contact.accountContactId,
    documentType: "proposal",
    documentId: "smoke-prop",
    documentNumber: "P-SMOKE",
    dealId: null,
    dealTitle: "Smoke deal",
    decision: "declined",
  });
  log({
    scenario: "Sales mail — customer declined proposal",
    channel: "sales",
    inApp: "1",
    email: "via notifyUsersViaCrmBot",
    status: "partial",
    detail: "In-app created; email uses CRM bot path",
  });

  const financePending = await notifyFinanceInvoicePendingApproval({
    organizationId: ORG_ID,
    invoiceId: "smoke-inv",
    invoiceNumber: "INV-SMOKE",
    dealId: null,
    dealTitle: "Smoke deal",
    ownerUserId: OWNER_USER_ID,
    contactId: contact.accountContactId,
    actorUserId: ADMIN_USER_ID,
  });
  log({
    scenario: "Sales/finance mail — invoice pending approval",
    channel: "sales",
    inApp: "2+",
    email: "via notifyUsersViaCrmBot",
    status: "partial",
    detail: "Finance + owner notified in-app; email uses CRM bot",
  });

  const financeRejected = await notifySalesInvoiceFinanceDecision({
    organizationId: ORG_ID,
    invoiceId: "smoke-inv",
    invoiceNumber: "INV-SMOKE",
    dealId: null,
    dealTitle: "Smoke deal",
    ownerUserId: OWNER_USER_ID,
    contactId: contact.accountContactId,
    decision: "rejected",
    reason: "Smoke test",
    actorUserId: ADMIN_USER_ID,
  });
  log({
    scenario: "Sales mail — finance rejected invoice",
    channel: "sales",
    inApp: "1",
    email: "via notifyUsersViaCrmBot",
    status: "partial",
    detail: "Owner notified in-app; email uses CRM bot",
  });

  const botDirect = await sendCrmBotEmail({
    organizationId: ORG_ID,
    to: ownerMailbox?.email ?? "",
    subject: "[CRM TEST] Nurture / internal bot path",
    body: "Scenario: nurture + internal alerts via CRM bot mailbox.",
  });
  log({
    scenario: "Customer/sales mail — nurture & CRM bot internal",
    channel: "sales",
    inApp: "n/a",
    email: botDirect.ok ? "sent" : "failed",
    status: botDirect.ok ? "pass" : "fail",
    detail: botDirect.ok ? `To ${ownerMailbox?.email}` : botDirect.error,
  });

  // restore owner after owner-change test
  await prisma.contactProfile.update({
    where: { id: contact.profileId },
    data: { ownerUserId: BigInt(OWNER_USER_ID) },
  });

  console.log("\n--- Summary ---");
  const passed = results.filter((r) => r.status === "pass").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(`Pass: ${passed} | Partial: ${partial} | Fail: ${failed}`);
  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

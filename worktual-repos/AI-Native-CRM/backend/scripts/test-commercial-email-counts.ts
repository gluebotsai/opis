import { notifyUsersViaCrmBot } from "../src/service/email/notify-crm-bot";
import {
  notifySalesCustomerDocumentDecision,
  notifyFinanceInvoicePendingApproval,
  notifySalesInvoiceFinanceDecision,
} from "../src/service/email/commercial-notify";
import { notifyAdmins } from "../src/dao/notifications/notify-admins";
import { prisma } from "../src/dao/db/prisma.js";

const ORG = "1000";
const CONTACT = "723c9f6a-4b90-4221-9411-3d17835144e0";

async function main() {
  const r1 = await notifyUsersViaCrmBot({
    organizationId: ORG,
    recipientUserIds: ["1006"],
    kind: "proposal_customer_declined",
    title: "[CRM TEST] Customer declined proposal",
    body: "Verify email path.",
    href: `/contact/${CONTACT}`,
    contactId: CONTACT,
    actorUserId: "1000",
  });
  console.log("customer declined proposal", r1);

  const r2 = await notifyUsersViaCrmBot({
    organizationId: ORG,
    recipientUserIds: ["1000", "1006"],
    kind: "invoice_pending_finance_approval",
    title: "[CRM TEST] Finance approval needed",
    body: "Verify finance email.",
    href: "/finance/test",
    contactId: CONTACT,
    actorUserId: "1000",
  });
  console.log("invoice pending finance", r2);

  const r3 = await notifyUsersViaCrmBot({
    organizationId: ORG,
    recipientUserIds: ["1006"],
    kind: "invoice_finance_rejected",
    title: "[CRM TEST] Finance rejected invoice",
    body: "Verify sales email.",
    href: "/finance/test",
    contactId: CONTACT,
    actorUserId: "1000",
  });
  console.log("finance rejected", r3);

  await notifyAdmins({
    organizationId: ORG,
    kind: "quote_accepted",
    ownerUserId: "1006",
    contactId: CONTACT,
    quoteId: "test-q",
    quoteNumber: "Q-TEST",
    dealId: null,
    dealTitle: "Test deal",
    href: "/sales",
  });
  console.log("quote accepted in-app created (notifyAdmins email path separate)");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

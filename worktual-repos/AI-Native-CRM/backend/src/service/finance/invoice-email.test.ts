/**
 * run: npx tsx --tsconfig tsconfig.json src/service/finance/invoice-email.test.ts
 */
import { buildInvoiceEmailContent } from "@/service/finance/invoice-email";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ctx = {
  number: "INV-00001",
  currency: "USD",
  total: "1200",
  dueLabel: "Jan 15, 2026",
  dealTitle: "Acme rollout",
  companyName: "Acme Corp",
  orderNumber: "ORD-001",
  contactName: "Alex",
  paymentTerms: "Net 30",
  sections: [{ key: "payment", body: "Bank: Example IBAN" }],
};

const initial = buildInvoiceEmailContent("initial_send", ctx);
assert(initial.subject.includes("INV-00001"), "initial subject has number");
assert(initial.body.includes("Please find invoice"), "initial body intro");

const reminder = buildInvoiceEmailContent("payment_reminder", ctx);
assert(reminder.subject.toLowerCase().includes("reminder"), "reminder subject");
assert(reminder.body.includes("payment reminder"), "reminder body label");
assert(reminder.body.includes("INV-00001"), "reminder same invoice number");

console.log("invoice-email templates ok");

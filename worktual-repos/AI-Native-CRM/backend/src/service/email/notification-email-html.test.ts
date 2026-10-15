import assert from "node:assert/strict";
import { buildNotificationEmailHtml } from "./notification-email-html";

const html = buildNotificationEmailHtml({
  kind: "quote_sent",
  title: "Quote sent: Q-1042",
  message: "Quote sent for Enterprise rollout.",
  href: "https://crm.example.com/sales/quotes/q1",
  sellerName: "Worktual",
  logoUrl: "https://crm.example.com/brand/worktual-logo.png",
  contactName: "Nandha Kumar",
  companyName: "Acme Corp",
  dealTitle: "Enterprise rollout",
  documentLabel: "Quote Q-1042",
  actorLabel: "Manoj M.",
  nextStep: "Follow up within 2 business days if the customer has questions.",
});

assert.match(html, /QUOTE/);
assert.match(html, /Quote sent: Q-1042/);
assert.match(html, /Nandha Kumar/);
assert.match(html, /Open in CRM/);
assert.match(html, /NEXT STEP/);
assert.match(html, /Follow up within 2 business days/);
assert.doesNotMatch(html, /<script/i);

const financeHtml = buildNotificationEmailHtml({
  kind: "invoice_pending_finance_approval",
  title: "Finance approval needed: Invoice INV-9",
  message: "Invoice needs Finance approval before customer send.",
  href: "https://crm.example.com/finance/inv9",
  sellerName: "Worktual",
  documentLabel: "Invoice INV-9",
});

assert.match(financeHtml, /FINANCE/);
assert.match(financeHtml, /Invoice INV-9/);

const meetingHtml = buildNotificationEmailHtml({
  kind: "meeting_miss",
  title: "Meeting not conducted: Nandha Kumar · Acme Corp",
  message:
    "No transcript after the grace window — the lead may not have joined, or capture failed.",
  href: "https://crm.example.com/contact/c1",
  sellerName: "Worktual",
  contactName: "Nandha Kumar",
  companyName: "Acme Corp",
  documentLabel: "Discovery call",
  nextStep:
    "Confirm whether the meeting happened, check capture/bot admit, then reschedule or mark as no-show.",
});
assert.match(meetingHtml, /MEETING/);
assert.match(meetingHtml, /Meeting not conducted/);
assert.match(meetingHtml, /Open in CRM/);

const coachingHtml = buildNotificationEmailHtml({
  kind: "rep_performance",
  title: "Rep performance: Priya S. — Needs work",
  message:
    "Priya S. received a needs work signal on the meeting with Nandha Kumar. Focus areas: Uncover budget earlier.",
  href: "https://crm.example.com/contact/c1",
  sellerName: "Worktual",
  contactName: "Nandha Kumar",
  companyName: "Acme Corp",
  nextStep:
    "Review the meeting with the rep and confirm follow-up actions are logged in CRM.",
});
assert.match(coachingHtml, /COACHING/);
assert.match(coachingHtml, /Rep performance: Priya S/);
assert.doesNotMatch(coachingHtml, /rewrite your discovery/i);

console.log("notification-email-html.test.ts: ok");

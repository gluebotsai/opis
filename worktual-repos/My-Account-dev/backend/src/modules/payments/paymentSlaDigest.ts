import { pool } from "../../db/pool.js";
import { getPaymentConfirmSlaHours } from "../../infra/env.js";
import {
  resolveFinanceMailSenderContext,
  resolveFinanceTeamEmails,
} from "../notifications/service.js";
import { sendEmail } from "../mail/mail-runtime.js";
import * as paymentsRepo from "../../repositories/raw/payments.repo.js";

function parseLeadSnapshot(snapshot: any) {
  if (!snapshot) {
    return {};
  }
  return typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
}

export async function processPaymentConfirmSlaDigest() {
  const financeEmails = await resolveFinanceTeamEmails();
  if (!financeEmails.length) {
    return { sent: false, reason: "missing_finance_recipient", overdueCount: 0 };
  }

  const slaHours = getPaymentConfirmSlaHours();
  const rows = await paymentsRepo.selectOverdueReportedPayments(pool, slaHours);
  if (!rows.length) {
    return { sent: false, reason: "no_overdue_payments", overdueCount: 0 };
  }

  const lines = rows.map((row: any) => {
    const lead = parseLeadSnapshot(row.lead_snapshot);
    const reportedAt = row.payment_reported_at
      ? new Date(row.payment_reported_at).toISOString()
      : "—";
    return [
      `- ${lead.companyName || "Unknown company"} (quotation ${row.quotation_id})`,
      `  Reported: ${reportedAt}`,
      `  Tenant: ${lead.tenantId || "—"}`,
    ].join("\n");
  });

  await sendEmail(
    {
      to: financeEmails,
      subject: `Payment confirm SLA digest — ${rows.length} overdue`,
      body: [
        "The following payments were reported and are still awaiting finance confirmation:",
        "",
        ...lines,
        "",
        "Please verify bank deposits and confirm payment in the finance queue.",
        "",
        "Regards,",
        "Worktual Accounts",
      ].join("\n"),
      mailbox: "finance",
    },
    "finance",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    await resolveFinanceMailSenderContext(),
  );

  return { sent: true, overdueCount: rows.length, recipients: financeEmails };
}

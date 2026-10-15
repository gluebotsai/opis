#!/usr/bin/env tsx
/**
 * Manually send a daily campaign report email.
 *
 * Usage:
 *   tsx scripts/send-daily-report.ts --user-id=1027
 *   tsx scripts/send-daily-report.ts --email=user@example.com
 *   tsx scripts/send-daily-report.ts --user-id=1027 --date=2026-09-05 --force
 */
import "dotenv/config";
import { getDailyReportRecipient, listDailyReportRecipients } from "../src/dao/daily-report-users.js";
import { sendDailyCampaignReportEmail } from "../src/services/daily-report/send-report.js";
import { resolveOrganizationTimezone } from "../src/dao/daily-campaign-report.js";
import { todayLocalDate } from "../src/helpers/report-day-window.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const userId = arg("user-id");
  const email = arg("email")?.toLowerCase();
  const toEmail = arg("to")?.toLowerCase();
  const force = process.argv.includes("--force");
  const useToday = process.argv.includes("--today");

  let recipient = userId ? await getDailyReportRecipient(userId) : null;
  if (!recipient && email) {
    const all = await listDailyReportRecipients();
    recipient = all.find((r) => r.email.toLowerCase() === email) ?? null;
  }
  if (!recipient) {
    console.error(
      "Provide --user-id= or --email= for an active Campaign product user (setup_user_product_access.product_id = campaign).",
    );
    process.exit(1);
  }

  const tz = await resolveOrganizationTimezone(
    recipient.organizationId,
    recipient.userId,
  );
  const reportDate =
    arg("date") ||
    (useToday ? todayLocalDate(tz) : todayLocalDate(tz));

  console.log(
    `Sending daily report to ${toEmail || recipient.email} for ${reportDate} (${tz}) force=${force}`,
  );

  const result = await sendDailyCampaignReportEmail({
    recipient,
    reportDate,
    force,
    toEmail: toEmail || undefined,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok || result.skipped ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { env } from "../../config/env.js";
import {
  hasDailyReportBeenSent,
  recordDailyReportDelivery,
} from "../../dao/daily-report-delivery.js";
import { loadAccountsMailboxForSendDao } from "../../dao/accounts-email-mailbox.js";
import {
  accountsLaunchFailReason,
  isAccountsLaunchReady,
} from "../../helpers/email-launch-transport.js";
import { isDailyReportSendWindow } from "../../helpers/report-day-window.js";
import type { CampaignSessionUser } from "../../types/auth.js";
import { sendAccountsMailboxCampaignEmail } from "../accounts-email-send.js";
import { buildDailyCampaignReport } from "./build-report.js";
import { renderDailyCampaignReportEmail } from "./render-email.js";
import type { DailyReportRecipient } from "./types.js";

export type SendDailyReportResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  providerId?: string;
  error?: string;
};

function reportSession(organizationId: string): CampaignSessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000098",
    organizationId,
    branchId: "",
    email: "daily-report@local",
    name: "Daily report",
    role: "system",
    initials: "DR",
    orgName: "system",
    mode: "b2b",
    industry: "generic-b2b",
    businessType: "",
    industryType: null,
  };
}

export async function sendDailyCampaignReportEmail(input: {
  recipient: DailyReportRecipient;
  reportDate?: string;
  force?: boolean;
  /** Test override — deliver to this inbox while keeping recipient org context. */
  toEmail?: string;
}): Promise<SendDailyReportResult> {
  const report = await buildDailyCampaignReport({
    recipient: input.recipient,
    reportDate: input.reportDate,
  });

  if (
    !input.force &&
    (await hasDailyReportBeenSent({
      organizationId: input.recipient.organizationId,
      userId: input.recipient.userId,
      reportDate: report.reportDate,
    }))
  ) {
    return { ok: true, skipped: true, reason: "already_sent" };
  }

  const { subject, html } = renderDailyCampaignReportEmail(report);
  const deliverTo = (input.toEmail || input.recipient.email).trim();

  if (!env.dailyReport.enabled) {
    await recordDailyReportDelivery({
      organizationId: input.recipient.organizationId,
      userId: input.recipient.userId,
      reportDate: report.reportDate,
      timezone: report.timezone,
      recipientEmail: deliverTo,
      status: "failed",
      errorMessage: "Daily report sending disabled (DAILY_REPORT_ENABLED=false)",
    });
    return { ok: false, error: "Daily report sending is disabled" };
  }

  let mailbox: Awaited<ReturnType<typeof loadAccountsMailboxForSendDao>> = null;
  try {
    mailbox = await loadAccountsMailboxForSendDao(
      reportSession(input.recipient.organizationId),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordDailyReportDelivery({
      organizationId: input.recipient.organizationId,
      userId: input.recipient.userId,
      reportDate: report.reportDate,
      timezone: report.timezone,
      recipientEmail: deliverTo,
      status: "failed",
      errorMessage: message,
    });
    return { ok: false, error: message };
  }

  if (!isAccountsLaunchReady(mailbox)) {
    const reason = accountsLaunchFailReason(mailbox);
    await recordDailyReportDelivery({
      organizationId: input.recipient.organizationId,
      userId: input.recipient.userId,
      reportDate: report.reportDate,
      timezone: report.timezone,
      recipientEmail: deliverTo,
      status: "failed",
      errorMessage: reason,
    });
    return { ok: false, error: reason };
  }

  try {
    const result = await sendAccountsMailboxCampaignEmail(
      mailbox,
      mailbox.public,
      {
        to: deliverTo,
        subject,
        html,
        first_name: input.recipient.firstName,
      },
    );
    const providerId = result.message_id || "accounts_mailbox";
    await recordDailyReportDelivery({
      organizationId: input.recipient.organizationId,
      userId: input.recipient.userId,
      reportDate: report.reportDate,
      timezone: report.timezone,
      recipientEmail: deliverTo,
      status: "sent",
      providerId,
    });
    return { ok: true, providerId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordDailyReportDelivery({
      organizationId: input.recipient.organizationId,
      userId: input.recipient.userId,
      reportDate: report.reportDate,
      timezone: report.timezone,
      recipientEmail: deliverTo,
      status: "failed",
      errorMessage: message,
    });
    return { ok: false, error: message };
  }
}

/**
 * Mon–Fri 17:00–18:00 local — end-of-day report send window (business hours 9–18).
 */
export function shouldSendDailyReportNow(input: {
  timezone: string;
  at?: Date;
}): boolean {
  return isDailyReportSendWindow(input.timezone, input.at ?? new Date());
}

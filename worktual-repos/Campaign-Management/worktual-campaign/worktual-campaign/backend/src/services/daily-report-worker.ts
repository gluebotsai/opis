// @ts-nocheck
/**
 * Daily campaign report email worker.
 * Sends today's report once per Campaign login user (setup_user_product_access.campaign)
 * during Mon–Fri 17:00–18:00 local.
 */

import { listDailyReportRecipients } from "../dao/daily-report-users.js";
import { resolveOrganizationTimezone } from "../dao/daily-campaign-report.js";
import { todayLocalDate } from "../helpers/report-day-window.js";
import { env } from "../config/env.js";
import {
  sendDailyCampaignReportEmail,
  shouldSendDailyReportNow,
} from "./daily-report/send-report.js";

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export async function runDailyReportTick(log?: Logger): Promise<{
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  waiting: number;
}> {
  if (!env.dailyReport.enabled) {
    return { attempted: 0, sent: 0, skipped: 0, failed: 0, waiting: 0 };
  }

  const recipients = await listDailyReportRecipients();
  let attempted = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let waiting = 0;

  for (const recipient of recipients) {
    try {
      const timezone = await resolveOrganizationTimezone(
        recipient.organizationId,
        recipient.userId,
      );
      if (!shouldSendDailyReportNow({ timezone })) {
        waiting += 1;
        continue;
      }
      const reportDate = todayLocalDate(timezone);
      attempted += 1;
      const result = await sendDailyCampaignReportEmail({ recipient, reportDate });
      if (result.skipped) skipped += 1;
      else if (result.ok) sent += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      log?.error({ err, userId: recipient.userId }, "Daily report send failed");
    }
  }

  if (attempted || (sent === 0 && failed === 0 && waiting === recipients.length)) {
    log?.info(
      { attempted, sent, skipped, failed, waiting, recipients: recipients.length },
      "Daily report worker tick",
    );
  }
  return { attempted, sent, skipped, failed, waiting };
}

export function startDailyReportWorker(log: Logger) {
  const interval = env.dailyReport.workerIntervalMs;
  log.info(
    { intervalMs: interval, sendWindow: "Mon-Fri 17:00-18:00 local" },
    "Daily report email worker started",
  );

  const tick = () => {
    void runDailyReportTick(log).catch((err) => {
      log.error({ err }, "Daily report worker tick failed");
    });
  };

  tick();
  return setInterval(tick, interval);
}

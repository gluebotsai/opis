// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * Proactive B2B watchers: send-time optimizer + WA/SMS template compliance.
 * Emits in-app notifications; does not auto-launch or auto-submit.
 */

import { prisma } from "../plugins/prisma.js";
import { upsertAppNotification } from "../dao/notifications.js";
import {
  getSendTimeInsightDao,
  listScheduledSendMismatchesDao,
  listTenantsWithEmailOpensDao,
} from "../dao/send-time-insight.js";
import { listTemplateComplianceIssuesDao } from "../dao/template-compliance.js";

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export async function scanSendTimeOptimizer(log?: Logger): Promise<{
  peaks: number;
  mismatches: number;
}> {
  const tenants = await listTenantsWithEmailOpensDao();
  const insightByTenant = new Map<
    string,
    Awaited<ReturnType<typeof getSendTimeInsightDao>>
  >();
  let peaks = 0;

  for (const t of tenants) {
    const insight = await getSendTimeInsightDao(t.organizationId, t.timezone);
    insightByTenant.set(t.organizationId, insight);
    if (!insight.has_peak || !insight.differs_from_default) continue;
    const owner = await firstCampaignOwner(t.organizationId);
    const row = await upsertAppNotification({
      organizationId: t.organizationId,
      userId: owner,
      kind: "send_time_insight",
      title: "Better B2B send window",
      body: insight.reason,
      href: "/campaigns/create",
      sourceKey: `send-time:peak:${t.organizationId}:${insight.peak_weekday}:${insight.peak_hour}`,
    });
    if (row) peaks += 1;
  }

  const mismatches = await listScheduledSendMismatchesDao(insightByTenant);
  let mismatchWritten = 0;
  for (const m of mismatches) {
    const when = [m.launchLocalDate, m.launchLocalTime].filter(Boolean).join(" ");
    const row = await upsertAppNotification({
      organizationId: m.organizationId,
      userId: m.userId,
      kind: "send_time_mismatch",
      title: "Scheduled time is off peak opens",
      body: `"${m.campaignName}" is set${when ? ` for ${when}` : ""}. Past opens peak ${m.peakWeekdayName} ${m.peakLocalTime}.`,
      href: `/campaigns/${m.campaignId}`,
      sourceKey: `send-time:mismatch:${m.campaignId}`,
      updateExisting: true,
    });
    if (row) mismatchWritten += 1;
  }

  if (peaks || mismatchWritten) {
    log?.info(
      { peaks, mismatches: mismatchWritten },
      "Send-time optimizer notifications",
    );
  }
  return { peaks, mismatches: mismatchWritten };
}

export async function scanTemplateCompliance(log?: Logger): Promise<{
  written: number;
}> {
  const issues = await listTemplateComplianceIssuesDao();
  let written = 0;
  for (const issue of issues) {
    const row = await upsertAppNotification({
      organizationId: issue.organizationId,
      userId: issue.userId,
      kind: issue.kind,
      title: issue.title,
      body: issue.body,
      href: issue.href,
      sourceKey: issue.sourceKey,
      updateExisting: true,
    });
    if (row) written += 1;
  }
  if (written) {
    log?.info(
      { event: "proactive_template_scan", written, issues: issues.length },
      "Proactive template library scan notifications written",
    );
  }
  return { written };
}

async function firstCampaignOwner(organizationId: string): Promise<string | null> {
  const row = await prisma.campaign.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: { createdByUserId: true },
  });
  return row?.createdByUserId || null;
}

export function startProactiveAgentWorker(log: Logger) {
  const interval = 10 * 60 * 1000;
  log.info(
    { event: "proactive_worker_started", intervalMs: interval },
    "Proactive agent worker started (send-time + template library scan)",
  );

  const tick = async () => {
    try {
      await scanSendTimeOptimizer(log);
    } catch (err) {
      log.error({ err }, "Send-time optimizer tick failed");
    }
    try {
      await scanTemplateCompliance(log);
    } catch (err) {
      log.error({ err, event: "proactive_template_scan_error" }, "Proactive template library scan tick failed");
    }
  };

  void tick();
  return setInterval(() => void tick(), interval);
}

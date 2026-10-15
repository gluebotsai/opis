import { createLogger } from "@ai-contact-center/observability";

import type { FastifyInstance } from "fastify";

import {
  REPORT_READ_TRANSACTION_OPTIONS,
  withOrganizationContext,
  withOrganizationReportWriteContext,
} from "../lib/rls.js";
import { serializeEntityId, toDbId } from "../lib/id-schema.js";
import { composeScheduledReportPdf } from "./report-composer.js";
import { captureDashboardReportPngForSchedule } from "./dashboard-report-snapshot.js";
import { fetchAgentPerformanceSummary, fetchExecutiveSummary, sendReportEmail } from "./report-delivery.js";
import { sendScheduledReportWhatsApp } from "./report-whatsapp.js";
import {
  buildScheduledReportPdfStorageKey,
  writeScheduledReportPdf,
} from "./scheduled-report-storage.js";
import {
  buildAgentNlpSummaryPayload,
  buildNlpSummaryPayload,
  buildScheduledReportFileName,
  computeNextRunAt,
  loadAgentReportContext,
  loadOrgAgentReportRows,
  loadOrgReportContext,
  logExportAudit,
  type ScheduledReportRecord,
  resolveAdminRecipientEmail,
  resolveReportMailbox,
  resolveReportWindow,
  resolveSetupUserDisplayName,
} from "./scheduled-reports.js";
import { buildAgentCsvSection, buildKpiCsvSection } from "./reporting.js";

const RUNNER_INTERVAL_MS = 60_000;
let runnerTimer: NodeJS.Timeout | null = null;
let runnerBusy = false;
const runnerLogger = createLogger({ service: "cc-core-report-runner" });

function scheduleLabel(schedule: ScheduledReportRecord["schedule"]): string {
  const labels: Record<string, string> = {
    every_1h: "Hourly",
    every_2h: "Every 2 hours",
    every_3h: "Every 3 hours",
    every_6h: "Every 6 hours",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  return labels[schedule] ?? schedule;
}

function exportFileName(scheduleName: string, periodLabel: string, sendAt: string): string {
  return buildScheduledReportFileName(scheduleName, periodLabel, sendAt);
}

type ReportRunInit =
  | { kind: "done"; result: { runId: string; status: "succeeded" } }
  | {
      kind: "failed";
      result: {
        runId: string;
        status: "failed";
        errorCode?: string;
        errorMessage?: string;
      };
    }
  | {
      kind: "ready";
      runId: string;
      mailbox: NonNullable<Awaited<ReturnType<typeof resolveReportMailbox>>>;
      recipientEmail: string;
    };

async function markReportRunFailed(
  app: FastifyInstance,
  schedule: ScheduledReportRecord,
  trigger: "scheduled" | "manual",
  runId: string,
  errorCode: string,
  errorMessage: string,
): Promise<{
  runId: string;
  status: "failed";
  errorCode: string;
  errorMessage: string;
}> {
  await withOrganizationReportWriteContext(app.prisma, schedule.organizationId, async (db) => {
    await db.scheduled_report_runs.update({
      where: { id: toDbId(runId) },
      data: {
        status: "failed",
        error_code: errorCode,
        error_message: errorMessage,
        finished_at: new Date(),
      },
    });
    if (trigger === "scheduled") {
      await db.scheduled_reports.update({
        where: { id: toDbId(schedule.id) },
        data: {
          last_run_at: new Date(),
          next_run_at: computeNextRunAt(schedule, new Date()),
          updated_at: new Date(),
        },
      });
    }
  });
  return { runId, status: "failed", errorCode, errorMessage };
}

async function markReportRunSucceeded(
  app: FastifyInstance,
  schedule: ScheduledReportRecord,
  trigger: "scheduled" | "manual",
  input: {
    runId: string;
    pdfBuffer: Buffer;
    summaryText: string | null;
    recipientEmail: string;
    sentFromEmail: string;
    agentRowCount: number;
    fileName: string;
  },
): Promise<{ runId: string; status: "succeeded" }> {
  const runStatus = trigger === "manual" ? "manual_succeeded" : "succeeded";
  const pdfPath = buildScheduledReportPdfStorageKey(
    schedule.organizationId,
    schedule.id,
    input.runId,
  );
  await writeScheduledReportPdf(pdfPath, input.pdfBuffer);

  await withOrganizationReportWriteContext(app.prisma, schedule.organizationId, async (db) => {
    await db.scheduled_report_runs.update({
      where: { id: toDbId(input.runId) },
      data: {
        status: runStatus,
        pdf_path: pdfPath,
        pdf_bytes: null,
        summary_text: input.summaryText,
        sent_to_email: input.recipientEmail,
        sent_from_email: input.sentFromEmail,
        finished_at: new Date(),
      },
    });
  });

  await withOrganizationContext(app.prisma, schedule.organizationId, async (db) => {
    if (trigger === "scheduled") {
      await db.scheduled_reports.update({
        where: { id: toDbId(schedule.id) },
        data: {
          last_run_at: new Date(),
          next_run_at: computeNextRunAt(schedule, new Date()),
          updated_at: new Date(),
        },
      });
    }
    await logExportAudit(db, {
      exportedByUserId: schedule.createdByUserId,
      exportedByEmail: input.recipientEmail,
      format: "pdf",
      rowCount: input.agentRowCount,
      fileName: input.fileName,
    });
  });
  return { runId: input.runId, status: "succeeded" };
}

async function deliverScheduledReportWhatsAppIfApproved(
  app: FastifyInstance,
  schedule: ScheduledReportRecord,
  runId: string,
  periodLabel: string,
  fileName: string,
): Promise<void> {
  try {
    const result = await sendScheduledReportWhatsApp(app.prisma, {
      organizationId: schedule.organizationId,
      createdByUserId: schedule.createdByUserId,
      runId,
      scheduleName: schedule.name,
      periodLabel,
      fileName,
    });
    if (result.sent) {
      runnerLogger.info(
        { scheduleId: schedule.id, runId, to: result.to },
        "scheduled report WhatsApp sent",
      );
      return;
    }
    runnerLogger.info(
      { scheduleId: schedule.id, runId, reason: result.reason },
      "scheduled report WhatsApp skipped",
    );
  } catch (error) {
    runnerLogger.warn(
      { err: error, scheduleId: schedule.id, runId },
      "scheduled report WhatsApp failed; email stands",
    );
  }
}

export async function executeScheduledReportRun(
  app: FastifyInstance,
  schedule: ScheduledReportRecord,
  trigger: "scheduled" | "manual",
  options?: { dashboardImagePng?: Buffer | null },
): Promise<{
  runId: string;
  status: "succeeded" | "failed";
  errorCode?: string;
  errorMessage?: string;
}> {
  if (schedule.reportScope === "agent") {
    return executeAgentScheduledReportRun(app, schedule, trigger);
  }
  return executeOrganizationScheduledReportRun(app, schedule, trigger, options);
}

async function executeOrganizationScheduledReportRun(
  app: FastifyInstance,
  schedule: ScheduledReportRecord,
  trigger: "scheduled" | "manual",
  options?: { dashboardImagePng?: Buffer | null },
): Promise<{
  runId: string;
  status: "succeeded" | "failed";
  errorCode?: string;
  errorMessage?: string;
}> {
  const now = new Date();
  const window = resolveReportWindow(schedule, now);

  const init = await withOrganizationContext(
    app.prisma,
    schedule.organizationId,
    async (db): Promise<ReportRunInit> => {
      const existingSucceeded = await db.scheduled_report_runs.findFirst({
        where: {
          scheduled_report_id: toDbId(schedule.id),
          period_start: window.start,
          period_end: window.end,
          status: "succeeded",
        },
        select: { id: true },
      });
      if (existingSucceeded && trigger === "scheduled") {
        await db.scheduled_reports.update({
          where: { id: toDbId(schedule.id) },
          data: {
            last_run_at: now,
            next_run_at: computeNextRunAt(schedule, now),
            updated_at: now,
          },
        });
        return {
          kind: "done",
          result: {
            runId: serializeEntityId(existingSucceeded.id),
            status: "succeeded" as const,
          },
        };
      }

      const run = await db.scheduled_report_runs.create({
        data: {
          scheduled_report_id: toDbId(schedule.id),
          organization_id: toDbId(schedule.organizationId),
          status: "running",
          period_start: window.start,
          period_end: window.end,
          period_label: window.label,
          started_at: now,
        },
      });
      const runId = serializeEntityId(run.id);

      const mailbox = await resolveReportMailbox(db, schedule.organizationId);
      if (!mailbox) {
        await db.scheduled_report_runs.update({
          where: { id: run.id },
          data: {
            status: "failed",
            error_code: "internal_report_mailbox_not_configured",
            error_message:
              "No CCaaS internal report mailbox is configured (ccaas_handler=internal).",
            finished_at: new Date(),
          },
        });
        return {
          kind: "failed",
          result: {
            runId,
            status: "failed" as const,
            errorCode: "internal_report_mailbox_not_configured",
            errorMessage:
              "No CCaaS internal report mailbox is configured (ccaas_handler=internal).",
          },
        };
      }

      const recipientEmail = await resolveAdminRecipientEmail(
        db,
        schedule.organizationId,
        schedule.createdByUserId,
      );
      if (!recipientEmail) {
        await db.scheduled_report_runs.update({
          where: { id: run.id },
          data: {
            status: "failed",
            error_code: "admin_recipient_not_found",
            error_message: "Admin login email was not found.",
            finished_at: new Date(),
          },
        });
        return {
          kind: "failed",
          result: {
            runId,
            status: "failed" as const,
            errorCode: "admin_recipient_not_found",
            errorMessage: "Admin login email was not found.",
          },
        };
      }

      return {
        kind: "ready",
        runId,
        mailbox,
        recipientEmail,
      };
    },
  );

  if (init.kind === "done") return init.result;
  if (init.kind === "failed") return init.result;

  const { runId, mailbox, recipientEmail } = init;
  const reportContext = await withOrganizationContext(
    app.prisma,
    schedule.organizationId,
    async (db) => loadOrgReportContext(db, schedule.organizationId, window),
    { timeoutMs: REPORT_READ_TRANSACTION_OPTIONS.timeout },
  );
  const agentRows = schedule.includedSections.agentTable
    ? await withOrganizationContext(
        app.prisma,
        schedule.organizationId,
        async (db) =>
          loadOrgAgentReportRows(db, schedule.organizationId, window, schedule.timeZone),
        { timeoutMs: REPORT_READ_TRANSACTION_OPTIONS.timeout },
      )
    : [];

  try {
    const nlpPayload = buildNlpSummaryPayload({
    agentRows,
    includeAgentSection: schedule.includedSections.agentTable,
    channelRows: reportContext.channelRows.map((row) => ({
      channel: row.channel,
      value: row.value,
    })),
    dispositionRows: reportContext.dispositionRows,
  });

  let summaryText: string | null = null;
  let highlights: string[] = [];
  let improvementSuggestions: string[] = [];
  if (schedule.includedSections.aiSummary) {
    const summary = await fetchExecutiveSummary(schedule.organizationId, {
      periodLabel: window.label,
      scheduleLabel: scheduleLabel(schedule.schedule),
      orgKpis: reportContext.orgKpis,
      teamRollup: nlpPayload.teamRollup,
      topPerformers: nlpPayload.topPerformers,
      needsAttention: nlpPayload.needsAttention,
      channelMixTop3: nlpPayload.channelMixTop3,
      dispositionMixTop3: nlpPayload.dispositionMixTop3,
      includedSections: [
        ...(schedule.includedSections.dashboardKpis ? ["dashboardKpis"] : []),
        ...(schedule.includedSections.agentTable ? ["agentTable"] : []),
        "aiSummary",
      ],
    });
    summaryText = summary?.summary ?? "Performance report generated for the selected period.";
    highlights = summary?.highlights ?? [];
    improvementSuggestions = summary?.improvementSuggestions ?? [];
    if (improvementSuggestions.length === 0 && nlpPayload.needsAttention?.length) {
      improvementSuggestions = nlpPayload.needsAttention.map(
        (row) =>
          `${row.name}: ${row.reason === "zero_handled" ? "increase handled volume" : "improve SLA (${row.slaRate}%)"}`,
      );
    }
  }

  const exportedAt = new Date();
  const kpiCsvText =
    schedule.includedSections.dashboardKpis
      ? buildKpiCsvSection(
          reportContext.orgKpis,
          { start: window.start, end: window.end },
          exportedAt,
          "Organization dashboard KPIs",
        ).join("\n")
      : undefined;
  const agentCsvText =
    schedule.includedSections.agentTable && agentRows.length > 0
      ? buildAgentCsvSection(agentRows, {
          subDay: window.subDay,
          title: "Agent performance & presence",
        }).join("\n")
      : undefined;

  let dashboardImagePng = options?.dashboardImagePng ?? null;
  if (schedule.includedSections.dashboardKpis && !dashboardImagePng) {
    dashboardImagePng = await captureDashboardReportPngForSchedule(schedule, window);
    if (!dashboardImagePng) {
      runnerLogger.warn(
        { scheduleId: schedule.id, runId },
        "dashboard snapshot unavailable; sending KPI layout PDF instead",
      );
    }
  }

  const pdfBuffer = await composeScheduledReportPdf({
    title: schedule.name,
    periodLabel: window.label,
    exportedAt,
    sections: schedule.includedSections,
    window,
    dashboardImagePng,
    dashboardLayout: schedule.includedSections.dashboardKpis
      ? {
          periodLabel: window.label,
          orgKpis: {
            ...reportContext.orgKpis,
            resolved: reportContext.resolved,
          },
          daily: reportContext.dailyRows,
          channels: reportContext.channelRows,
          dispositions: reportContext.dispositionRows.map((row) => ({
            label: row.label,
            value: Number(row.value),
          })),
        }
      : undefined,
    kpiCsvText,
    agentCsvText,
    summaryText,
    highlights,
    improvementSuggestions,
  });

  const fileName = exportFileName(schedule.name, window.label, schedule.sendAt);
  const emailResult = await sendReportEmail({
    organizationId: schedule.organizationId,
    channelConfigId: mailbox.channelConfigId,
    fromEmail: mailbox.senderEmail,
    fromName: mailbox.senderName,
    replyTo: mailbox.replyTo,
    toEmail: recipientEmail,
    subject: `[Worktual] ${schedule.name} — ${window.label}`,
    pdfBuffer,
    fileName,
  });

  if (!emailResult.ok) {
    return markReportRunFailed(
      app,
      schedule,
      trigger,
      runId,
      "report_email_send_failed",
      emailResult.error,
    );
  }

  const result = await markReportRunSucceeded(app, schedule, trigger, {
    runId,
    pdfBuffer,
    summaryText,
    recipientEmail,
    sentFromEmail: emailResult.fromEmail,
    agentRowCount: agentRows.length,
    fileName,
  });
  await deliverScheduledReportWhatsAppIfApproved(
    app,
    schedule,
    runId,
    window.label,
    fileName,
  );
  return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed";
    runnerLogger.error({ err: error, scheduleId: schedule.id, runId }, "report run failed");
    return markReportRunFailed(app, schedule, trigger, runId, "report_run_failed", message);
  }
}

async function executeAgentScheduledReportRun(
  app: FastifyInstance,
  schedule: ScheduledReportRecord,
  trigger: "scheduled" | "manual",
): Promise<{
  runId: string;
  status: "succeeded" | "failed";
  errorCode?: string;
  errorMessage?: string;
}> {
  const now = new Date();
  const window = resolveReportWindow(schedule, now);
  const agentUserId = schedule.targetUserId ?? schedule.createdByUserId;

  const init = await withOrganizationContext(
    app.prisma,
    schedule.organizationId,
    async (db): Promise<ReportRunInit> => {
      const existingSucceeded = await db.scheduled_report_runs.findFirst({
        where: {
          scheduled_report_id: toDbId(schedule.id),
          period_start: window.start,
          period_end: window.end,
          status: "succeeded",
        },
        select: { id: true },
      });
      if (existingSucceeded && trigger === "scheduled") {
        await db.scheduled_reports.update({
          where: { id: toDbId(schedule.id) },
          data: {
            last_run_at: now,
            next_run_at: computeNextRunAt(schedule, now),
            updated_at: now,
          },
        });
        return {
          kind: "done",
          result: {
            runId: serializeEntityId(existingSucceeded.id),
            status: "succeeded" as const,
          },
        };
      }

      const run = await db.scheduled_report_runs.create({
        data: {
          scheduled_report_id: toDbId(schedule.id),
          organization_id: toDbId(schedule.organizationId),
          status: "running",
          period_start: window.start,
          period_end: window.end,
          period_label: window.label,
          started_at: now,
        },
      });
      const runId = serializeEntityId(run.id);

      const mailbox = await resolveReportMailbox(db, schedule.organizationId);
      if (!mailbox) {
        await db.scheduled_report_runs.update({
          where: { id: run.id },
          data: {
            status: "failed",
            error_code: "internal_report_mailbox_not_configured",
            error_message:
              "No CCaaS internal report mailbox is configured (ccaas_handler=internal).",
            finished_at: new Date(),
          },
        });
        return {
          kind: "failed",
          result: {
            runId,
            status: "failed" as const,
            errorCode: "internal_report_mailbox_not_configured",
            errorMessage:
              "No CCaaS internal report mailbox is configured (ccaas_handler=internal).",
          },
        };
      }

      const recipientEmail = await resolveAdminRecipientEmail(
        db,
        schedule.organizationId,
        agentUserId,
      );
      if (!recipientEmail) {
        await db.scheduled_report_runs.update({
          where: { id: run.id },
          data: {
            status: "failed",
            error_code: "agent_recipient_not_found",
            error_message: "Agent login email was not found.",
            finished_at: new Date(),
          },
        });
        return {
          kind: "failed",
          result: {
            runId,
            status: "failed" as const,
            errorCode: "agent_recipient_not_found",
            errorMessage: "Agent login email was not found.",
          },
        };
      }

      return {
        kind: "ready",
        runId,
        mailbox,
        recipientEmail,
      };
    },
  );

  if (init.kind === "done") return init.result;
  if (init.kind === "failed") return init.result;

  const { runId, mailbox, recipientEmail } = init;

  try {
    const [reportContext, agentName] = await withOrganizationContext(
      app.prisma,
      schedule.organizationId,
      async (db) =>
        Promise.all([
          loadAgentReportContext(db, schedule.organizationId, agentUserId, window),
          resolveSetupUserDisplayName(db, schedule.organizationId, agentUserId),
        ]),
      { timeoutMs: REPORT_READ_TRANSACTION_OPTIONS.timeout },
    );

    const nlpPayload = buildAgentNlpSummaryPayload({
      channelRows: reportContext.channelRows,
      dispositionRows: reportContext.dispositionRows,
    });

    let summaryText: string | null = null;
    let highlights: string[] = [];
    let improvementSuggestions: string[] = [];
    if (schedule.includedSections.aiSummary) {
      const summary = await fetchAgentPerformanceSummary(schedule.organizationId, {
        periodLabel: window.label,
        scheduleLabel: scheduleLabel(schedule.schedule),
        agentName,
        agentKpis: reportContext.agentKpis,
        channelMixTop3: nlpPayload.channelMixTop3,
        dispositionMixTop3: nlpPayload.dispositionMixTop3,
        includedSections: [
          ...(schedule.includedSections.dashboardKpis ? ["performanceKpis"] : []),
          "aiSummary",
        ],
      });
      summaryText =
        summary?.summary ??
        `Personal performance report for ${window.label}. Review the attached KPIs for details.`;
      highlights = summary?.highlights ?? [];
      improvementSuggestions = summary?.improvementSuggestions ?? [];
    }

    const exportedAt = new Date();
    const kpiCsvText = schedule.includedSections.dashboardKpis
      ? buildKpiCsvSection(
          reportContext.agentKpis,
          { start: window.start, end: window.end },
          exportedAt,
          "My performance KPIs",
        ).join("\n")
      : undefined;

    const pdfBuffer = await composeScheduledReportPdf({
      title: schedule.name,
      periodLabel: window.label,
      exportedAt,
      sections: schedule.includedSections,
      window,
      dashboardLayout: schedule.includedSections.dashboardKpis
        ? {
            periodLabel: window.label,
            orgKpis: {
              ...reportContext.agentKpis,
              resolved: reportContext.resolved,
            },
            daily: reportContext.dailyRows,
            channels: reportContext.channelRows,
            dispositions: reportContext.dispositionRows.map((row) => ({
              label: row.label,
              value: Number(row.value),
            })),
          }
        : undefined,
      kpiCsvText,
      summaryText,
      highlights,
      improvementSuggestions,
    });

    const fileName = exportFileName(schedule.name, window.label, schedule.sendAt);
    const emailResult = await sendReportEmail({
      organizationId: schedule.organizationId,
      channelConfigId: mailbox.channelConfigId,
      fromEmail: mailbox.senderEmail,
      fromName: mailbox.senderName,
      replyTo: mailbox.replyTo,
      toEmail: recipientEmail,
      subject: `[Worktual] ${schedule.name} — ${window.label}`,
      pdfBuffer,
      fileName,
    });

    if (!emailResult.ok) {
      return markReportRunFailed(
        app,
        schedule,
        trigger,
        runId,
        "report_email_send_failed",
        emailResult.error,
      );
    }

    const result = await markReportRunSucceeded(app, schedule, trigger, {
      runId,
      pdfBuffer,
      summaryText,
      recipientEmail,
      sentFromEmail: emailResult.fromEmail,
      agentRowCount: 0,
      fileName,
    });
    await deliverScheduledReportWhatsAppIfApproved(
      app,
      schedule,
      runId,
      window.label,
      fileName,
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed";
    runnerLogger.error({ err: error, scheduleId: schedule.id, runId }, "agent report run failed");
    return markReportRunFailed(app, schedule, trigger, runId, "report_run_failed", message);
  }
}

async function pollDueSchedules(app: FastifyInstance): Promise<void> {
  if (runnerBusy) return;
  runnerBusy = true;
  try {
    const dueRows = await app.prisma.scheduled_reports.findMany({
      where: {
        enabled: true,
        next_run_at: { lte: new Date() },
      },
      orderBy: { next_run_at: "asc" },
      take: 5,
    });

    for (const scheduleRow of dueRows) {
      const schedule = {
        id: serializeEntityId(scheduleRow.id),
        organizationId: serializeEntityId(scheduleRow.organization_id),
        createdByUserId: serializeEntityId(scheduleRow.created_by_user_id),
        reportScope:
          (scheduleRow as { report_scope?: string }).report_scope === "agent"
            ? ("agent" as const)
            : ("organization" as const),
        targetUserId:
          (scheduleRow as { target_user_id?: bigint | null }).target_user_id == null
            ? null
            : serializeEntityId(
                (scheduleRow as { target_user_id: bigint }).target_user_id,
              ),
        name: scheduleRow.name,
        enabled: scheduleRow.enabled,
        schedule: scheduleRow.schedule,
        weekday: scheduleRow.weekday,
        monthDay: scheduleRow.month_day,
        sendMode: scheduleRow.send_mode,
        sendAt: scheduleRow.send_at,
        timeZone: scheduleRow.time_zone,
        period: scheduleRow.period,
        formats: scheduleRow.formats as { pdf: boolean; csv: boolean },
        includedSections: scheduleRow.included_sections as {
          dashboardKpis: boolean;
          agentTable: boolean;
          aiSummary: boolean;
        },
        nextRunAt: scheduleRow.next_run_at?.toISOString() ?? null,
        lastRunAt: scheduleRow.last_run_at?.toISOString() ?? null,
        createdAt: scheduleRow.created_at.toISOString(),
        updatedAt: scheduleRow.updated_at.toISOString(),
      } as ScheduledReportRecord;

      try {
        await executeScheduledReportRun(app, schedule, "scheduled");
      } catch (error) {
        runnerLogger.error({ err: error, scheduleId: schedule.id }, "scheduled report run failed");
      }
    }
  } finally {
    runnerBusy = false;
  }
}

export function startReportRunner(app: FastifyInstance): void {
  if (runnerTimer) return;
  if (process.env.REPORT_RUNNER_ENABLED === "false") return;
  runnerTimer = setInterval(() => {
    void pollDueSchedules(app).catch((error) => {
      runnerLogger.error({ err: error }, "report runner poll failed");
    });
  }, RUNNER_INTERVAL_MS);
  void pollDueSchedules(app).catch((error) => {
    runnerLogger.error({ err: error }, "report runner initial poll failed");
  });
}

import {
  addCalendarDays,
  dayWindowUtc,
  formatReportDateLabel,
  todayLocalDate,
} from "../../helpers/report-day-window.js";
import {
  aggregatePeriodMessagingStats,
  buildAttentionItems,
  buildChannelPerformanceRows,
  buildDayComparison,
  loadCampaignActivityRows,
  loadContactActivitySummary,
  loadCurrentCampaignStatus,
  loadOverallSummary,
  loadScheduledCampaignRows,
  loadWhatsAppTemplateActivity,
  resolveOrganizationTimezone,
} from "../../dao/daily-campaign-report.js";
import { loadOrganizationName } from "../../dao/daily-report-users.js";
import type {
  AttentionItem,
  CampaignActivityRow,
  ChannelPerformanceRow,
  ContactActivitySummary,
  CurrentCampaignStatus,
  DailyCampaignReport,
  DailyReportRecipient,
  DayComparison,
  OverallSummary,
  ReportSection,
  ScheduledCampaignRow,
  UpcomingActivity,
  WhatsAppTemplateActivity,
} from "./types.js";

function emptyOverall(): OverallSummary {
  return {
    campaignsLaunched: 0,
    campaignsCompleted: 0,
    campaignsRunning: 0,
    campaignsScheduled: 0,
    campaignsFailed: 0,
    campaignsPaused: 0,
    campaignsCancelled: 0,
    contactsTargeted: 0,
    contactsReached: 0,
    messagesSent: 0,
    messagesDelivered: 0,
    messagesFailed: 0,
    deliveryRate: null,
    clickRate: null,
    noActivity: true,
  };
}

function emptyContactActivity(): ContactActivitySummary {
  return {
    created: 0,
    updated: 0,
    imported: 0,
    addedToCampaigns: 0,
    reached: 0,
    notReached: 0,
    failed: 0,
    unsubscribed: 0,
    duplicates: null,
    noActivity: true,
  };
}

function emptyWhatsAppActivity(): WhatsAppTemplateActivity {
  return {
    submitted: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    activated: 0,
    deactivated: 0,
    rejectedDetails: [],
    noActivity: true,
  };
}

function emptyCurrentStatus(): CurrentCampaignStatus {
  return { active: [], scheduled: [], paused: [], failed: [], cancelled: [] };
}

function okSection<T>(data: T): ReportSection<T> {
  return { data, available: true, error: null };
}

function errSection<T>(fallback: T, error: unknown): ReportSection<T> {
  const message = error
    ? error instanceof Error
      ? error.message
      : String(error)
    : "Data could not be loaded";
  return { data: fallback, available: false, error: message };
}

export async function buildDailyCampaignReport(input: {
  recipient: DailyReportRecipient;
  reportDate?: string;
}): Promise<DailyCampaignReport> {
  const timezone = await resolveOrganizationTimezone(
    input.recipient.organizationId,
    input.recipient.userId,
  );
  const reportDate = input.reportDate || todayLocalDate(timezone);
  const window = dayWindowUtc(reportDate, timezone);
  if (!window) {
    throw new Error(`Invalid report day window for ${reportDate} (${timezone})`);
  }

  const prevDate = addCalendarDays(reportDate, -1);
  const prevWindow = dayWindowUtc(prevDate, timezone);

  const orgName = await loadOrganizationName(input.recipient.organizationId);

  let messaging = {
    byChannel: new Map(),
    byCampaign: new Map(),
    totals: {
      sent: 0,
      delivered: 0,
      failed: 0,
      opens: 0,
      clicks: 0,
      processed: 0,
    },
  };
  let overall: ReportSection<OverallSummary> = errSection(emptyOverall(), null);
  let campaignActivity: ReportSection<CampaignActivityRow[]> = errSection([], null);
  let currentStatus: ReportSection<CurrentCampaignStatus> = errSection(
    emptyCurrentStatus(),
    null,
  );
  let channelPerformance: ReportSection<ChannelPerformanceRow[]> = errSection(
    [],
    null,
  );
  let contactActivity: ReportSection<ContactActivitySummary> = errSection(
    emptyContactActivity(),
    null,
  );
  let whatsappTemplates: ReportSection<WhatsAppTemplateActivity> = errSection(
    emptyWhatsAppActivity(),
    null,
  );
  let scheduledCampaigns: ReportSection<ScheduledCampaignRow[]> = errSection(
    [],
    null,
  );
  let comparison: ReportSection<DayComparison | null> = okSection(null);

  const scope = {
    organizationId: input.recipient.organizationId,
    userId: input.recipient.userId,
  };

  try {
    messaging = await aggregatePeriodMessagingStats({
      ...scope,
      windowStart: window.start,
      windowEnd: window.end,
    });
  } catch (err) {
    overall = errSection(overall.data, err);
  }

  try {
    const summary = await loadOverallSummary({
      ...scope,
      windowStart: window.start,
      windowEnd: window.end,
      messagingTotals: messaging.totals,
    });
    const noActivity =
      summary.messagesSent === 0 &&
      summary.campaignsLaunched === 0 &&
      summary.campaignsCompleted === 0 &&
      summary.campaignsCancelled === 0;
    overall = okSection({ ...summary, noActivity });
  } catch (err) {
    overall = errSection(overall.data, err);
  }

  try {
    const rows = await loadCampaignActivityRows({
      ...scope,
      windowStart: window.start,
      windowEnd: window.end,
      byCampaign: messaging.byCampaign,
    });
    campaignActivity = okSection(rows);
  } catch (err) {
    campaignActivity = errSection([], err);
  }

  try {
    currentStatus = okSection(
      await loadCurrentCampaignStatus(
        input.recipient.organizationId,
        input.recipient.userId,
      ),
    );
  } catch (err) {
    currentStatus = errSection(currentStatus.data, err);
  }

  try {
    channelPerformance = okSection(
      buildChannelPerformanceRows(messaging.byChannel),
    );
  } catch (err) {
    channelPerformance = errSection([], err);
  }

  try {
    contactActivity = okSection(
      await loadContactActivitySummary({
        ...scope,
        windowStart: window.start,
        windowEnd: window.end,
        contactsReached: messaging.totals.delivered,
        contactsFailed: messaging.totals.failed,
      }),
    );
  } catch (err) {
    contactActivity = errSection(contactActivity.data, err);
  }

  try {
    whatsappTemplates = okSection(
      await loadWhatsAppTemplateActivity({
        ...scope,
        windowStart: window.start,
        windowEnd: window.end,
      }),
    );
  } catch (err) {
    whatsappTemplates = errSection(whatsappTemplates.data, err);
  }

  try {
    scheduledCampaigns = okSection(
      await loadScheduledCampaignRows(
        input.recipient.organizationId,
        input.recipient.userId,
      ),
    );
  } catch (err) {
    scheduledCampaigns = errSection([], err);
  }

  const upcomingRows = scheduledCampaigns.available
    ? scheduledCampaigns.data
    : [];
  const upcomingActivity: ReportSection<UpcomingActivity> = okSection({
    scheduledCampaigns: upcomingRows,
    noUpcoming: upcomingRows.length === 0,
  });

  let attentionRequired: ReportSection<AttentionItem[]> = okSection([]);
  try {
    attentionRequired = okSection(
      buildAttentionItems({
        current: currentStatus.data,
        whatsapp: whatsappTemplates.data,
        scheduled: upcomingRows,
      }),
    );
  } catch (err) {
    attentionRequired = errSection([], err);
  }

  if (prevWindow) {
    try {
      const prevMessaging = await aggregatePeriodMessagingStats({
        ...scope,
        windowStart: prevWindow.start,
        windowEnd: prevWindow.end,
      });
      comparison = okSection(
        buildDayComparison(messaging.totals, prevMessaging.totals),
      );
    } catch {
      comparison = okSection(null);
    }
  }

  return {
    reportDate,
    reportDateLabel: formatReportDateLabel(reportDate, timezone),
    timezone,
    userId: input.recipient.userId,
    userName: input.recipient.displayName,
    userEmail: input.recipient.email,
    organizationId: input.recipient.organizationId,
    organizationName: orgName,
    generatedAt: new Date().toISOString(),
    overall,
    campaignActivity,
    currentStatus,
    channelPerformance,
    contactActivity,
    whatsappTemplates,
    scheduledCampaigns,
    attentionRequired,
    upcomingActivity,
    comparison,
  };
}

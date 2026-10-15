/** Daily campaign report — typed sections with explicit availability/errors. */

export type ReportSection<T> = {
  data: T;
  available: boolean;
  error: string | null;
};

export type OverallSummary = {
  campaignsLaunched: number;
  campaignsCompleted: number;
  campaignsRunning: number;
  campaignsScheduled: number;
  campaignsFailed: number;
  campaignsPaused: number;
  campaignsCancelled: number;
  contactsTargeted: number;
  contactsReached: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesFailed: number;
  deliveryRate: number | null;
  clickRate: number | null;
  noActivity: boolean;
};

export type CampaignActivityRow = {
  campaignId: string;
  name: string;
  channels: string[];
  status: string;
  audienceCount: number;
  contactsProcessed: number;
  messagesSent: number;
  delivered: number;
  failed: number;
  startedAt: string | null;
  completedAt: string | null;
};

export type CurrentCampaignStatus = {
  active: Array<{ id: string; name: string; channels: string[] }>;
  scheduled: Array<{ id: string; name: string; channels: string[]; launchLabel: string }>;
  paused: Array<{ id: string; name: string; channels: string[]; reason: string | null }>;
  failed: Array<{ id: string; name: string; channels: string[]; detail: string }>;
  cancelled: Array<{ id: string; name: string; channels: string[] }>;
};

export type ChannelPerformanceRow = {
  channel: string;
  label: string;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number | null;
  opens: number | null;
  openRate: number | null;
  clicks: number | null;
  clickRate: number | null;
};

export type ContactActivitySummary = {
  created: number;
  updated: number;
  imported: number;
  addedToCampaigns: number;
  reached: number;
  notReached: number;
  failed: number;
  unsubscribed: number;
  duplicates: number | null;
  noActivity: boolean;
};

export type WhatsAppTemplateActivity = {
  submitted: number;
  pending: number;
  approved: number;
  rejected: number;
  activated: number;
  deactivated: number;
  rejectedDetails: Array<{ name: string; reason: string | null }>;
  noActivity: boolean;
};

export type ScheduledCampaignRow = {
  campaignId: string;
  name: string;
  channels: string[];
  scheduledAt: string;
  expectedContacts: number;
};

export type AttentionItem = {
  kind: string;
  title: string;
  detail: string;
  href: string | null;
};

export type UpcomingActivity = {
  scheduledCampaigns: ScheduledCampaignRow[];
  noUpcoming: boolean;
};

export type DayComparisonMetric = {
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
};

export type DayComparison = {
  metrics: DayComparisonMetric[];
  available: boolean;
};

export type DailyCampaignReport = {
  reportDate: string;
  reportDateLabel: string;
  timezone: string;
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  organizationName: string | null;
  generatedAt: string;
  overall: ReportSection<OverallSummary>;
  campaignActivity: ReportSection<CampaignActivityRow[]>;
  currentStatus: ReportSection<CurrentCampaignStatus>;
  channelPerformance: ReportSection<ChannelPerformanceRow[]>;
  contactActivity: ReportSection<ContactActivitySummary>;
  whatsappTemplates: ReportSection<WhatsAppTemplateActivity>;
  scheduledCampaigns: ReportSection<ScheduledCampaignRow[]>;
  attentionRequired: ReportSection<AttentionItem[]>;
  upcomingActivity: ReportSection<UpcomingActivity>;
  comparison: ReportSection<DayComparison | null>;
};

export type DailyReportRecipient = {
  userId: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

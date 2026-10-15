/** Dashboard metric helpers + data load (campaign-native). */
import {
  configChannelToUiId,
  isChannelParked,
  isConfigChannelHidden,
  toAgentChannelId,
} from "@/lib/campaign-channels";
import {
  fetchCampaignById,
  fetchCampaigns,
  type CampaignChannelMetric,
  type CampaignDetail,
  type CampaignListItem,
} from "@/services/campaigns.service";
import {
  fetchConfigChannels,
  type ConfigChannel,
} from "@/services/configuration.service";

const PAUSE_ALERT_DAYS = 10;
const MS_DAY = 24 * 60 * 60 * 1000;

export type PerformanceRange =
  | "today"
  | "weekly"
  | "monthly"
  | "all"
  | "custom";

export type PerformanceCustomRange = { from: string; to: string };

export type PausedAlert = {
  campaignId: string;
  campaignName: string;
  channel: string;
  reason: string | null;
  pausedAt: string | null;
};

export type ChannelRollup = {
  key: string;
  label: string;
  sent: number;
  opens: number;
  clicks: number;
  failed: number;
  stubSent: number;
  impressions: number;
  spend: number;
  conversions: number;
  currency: string | null;
  campaigns: number;
};

/** One day of messaging volume for Overview trend charts. */
export type DashboardDailyPoint = {
  date: string; // YYYY-MM-DD
  label: string;
  /** All messaging channels delivered. */
  sent: number;
  failed: number;
  /**
   * Email unique opens and clicks only (not WhatsApp / web / app push).
   */
  opens: number;
  clicks: number;
};

const CHANNEL_ROLLUP_ORDER = ["email", "sms", "whatsapp", "web", "push"];

function isPpcKey(key: string | null | undefined): boolean {
  return key === "ppc";
}

export function isPpcOnlyCampaign(row: {
  channels?: string[];
  channelMetrics?: { channel: string }[];
  hasPpc?: boolean;
}): boolean {
  const raw = [
    ...(row.channels || []),
    ...(row.channelMetrics || []).map((c) => c.channel),
  ];
  const keys = [
    ...new Set(
      raw
        .map((c) => rollupKey(String(c)))
        .filter((k): k is string => Boolean(k)),
    ),
  ];
  if (keys.length === 0) return Boolean(row.hasPpc);
  return keys.every(isPpcKey);
}

function emptyChannelRollup(key: string): ChannelRollup {
  return {
    key,
    label: formatChannel(key),
    sent: 0,
    opens: 0,
    clicks: 0,
    failed: 0,
    stubSent: 0,
    impressions: 0,
    spend: 0,
    conversions: 0,
    currency: null,
    campaigns: 0,
  };
}

export function rollupKey(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  return toAgentChannelId(trimmed) || trimmed.toLowerCase();
}

/** Ready Configuration channels as agent ids. WhatsApp is always included. */
export function configuredAgentChannelSet(
  configChannels: ConfigChannel[] | undefined,
): Set<string> | null {
  if (!configChannels?.length) return null;
  const ready = new Set<string>(["whatsapp"]);
  for (const row of configChannels) {
    if (isConfigChannelHidden(row.channel)) continue;
    const uiId = configChannelToUiId(row.channel);
    if (!uiId || isChannelParked(uiId)) continue;
    if (row.status !== "ready" && uiId !== "whatsapp") continue;
    const agent = toAgentChannelId(uiId);
    if (agent && !isPpcKey(agent)) ready.add(agent);
  }
  return ready;
}

export function channelAllowed(
  key: string | null | undefined,
  allowed: Set<string> | null,
): boolean {
  if (!key || isPpcKey(key)) return false;
  if (!allowed) return true;
  return allowed.has(key);
}

/** Same timezone the campaign API uses for relative=last_7_days / last_month. */
const LAUNCH_TZ = "Asia/Kolkata";

function toLocalYmd(
  iso: string | Date | null | undefined,
  timeZone = LAUNCH_TZ,
): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function istTodayYmd(): string {
  return toLocalYmd(new Date(), LAUNCH_TZ) || "";
}

/** Shift a YYYY-MM-DD calendar date by N days (matches backend shiftLocalDate). */
function shiftLocalDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + days);
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function previousCalendarMonthBounds(today = istTodayYmd()): {
  from: string;
  to: string;
  label: string;
} {
  const [y, m] = today.split("-").map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
  const from = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  const to = `${prevY}-${String(prevM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const label = new Date(Date.UTC(prevY, prevM - 1, 15)).toLocaleString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
  return { from, to, label };
}

export function normalizeYmdRange(
  from: string,
  to: string,
): PerformanceCustomRange {
  return from <= to ? { from, to } : { from: to, to: from };
}

export function formatCustomRangeLabel(custom: PerformanceCustomRange): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  };
  if (custom.from === custom.to) return fmt(custom.from);
  return `${fmt(custom.from)} – ${fmt(custom.to)}`;
}

/** Inclusive launch-local-date bounds — identical to backend listCampaignsByBucketDao. */
function launchDateBounds(
  range: PerformanceRange,
  custom?: PerformanceCustomRange | null,
): { from: string; to: string } | null {
  if (range === "all") return null;
  if (range === "custom") {
    if (!custom?.from || !custom?.to) return null;
    return normalizeYmdRange(custom.from, custom.to);
  }
  const today = istTodayYmd();
  if (range === "today") {
    return { from: today, to: today };
  }
  if (range === "weekly") {
    return { from: shiftLocalDate(today, -6), to: today };
  }
  if (range === "monthly") {
    const { from, to } = previousCalendarMonthBounds(today);
    return { from, to };
  }
  return null;
}

export function rangeLabel(
  range: PerformanceRange,
  custom?: PerformanceCustomRange | null,
): string {
  if (range === "today") return "Today";
  if (range === "weekly") return "Last week";
  if (range === "monthly") return "Last month";
  if (range === "custom" && custom?.from && custom?.to) {
    return formatCustomRangeLabel(normalizeYmdRange(custom.from, custom.to));
  }
  return "All";
}

export function rangeHint(
  range: PerformanceRange,
  custom?: PerformanceCustomRange | null,
): string {
  if (range === "today") return "Launched today (IST)";
  if (range === "weekly") return "Launched in last 7 days (IST)";
  if (range === "monthly") {
    return `Launched in ${previousCalendarMonthBounds().label}`;
  }
  if (range === "custom" && custom?.from && custom?.to) {
    const bounds = normalizeYmdRange(custom.from, custom.to);
    return `Launched ${formatCustomRangeLabel(bounds)} (IST)`;
  }
  return "All ran campaigns · chart = event activity since first launch (IST)";
}

export function campaignLaunchLocalDate(item: {
  timezone?: string;
  startsAt?: string | null;
  createdAt?: string | null;
  launchLocalDate?: string | null;
}): string | null {
  if (item.launchLocalDate) return item.launchLocalDate;
  const tz = item.timezone || LAUNCH_TZ;
  return toLocalYmd(item.startsAt, tz) || toLocalYmd(item.createdAt, tz);
}

/**
 * Same filter as API relative=last_7_days / last_month:
 * include campaigns whose launch local date falls in the window (not overlap).
 */
export function campaignInPerformanceRange(
  item: {
    timezone?: string;
    startsAt?: string | null;
    createdAt?: string | null;
    launchLocalDate?: string | null;
  },
  range: PerformanceRange,
  custom?: PerformanceCustomRange | null,
): boolean {
  const bounds = launchDateBounds(range, custom);
  if (!bounds) return true;
  const local = campaignLaunchLocalDate(item);
  if (!local) return false;
  if (local < bounds.from) return false;
  if (local > bounds.to) return false;
  return true;
}

/** Messaging KPIs for configured channels only. */
export function sumListMetrics(
  rows: CampaignListItem[],
  allowed: Set<string> | null = null,
) {
  let sent = 0;
  let opens = 0;
  let clicks = 0;
  let totalOpens = 0;
  let totalClicks = 0;
  let failed = 0;
  let stubSent = 0;
  let usedChannelMetrics = false;
  for (const row of rows) {
    if (!row.channelMetrics?.length) continue;
    usedChannelMetrics = true;
    for (const ch of row.channelMetrics) {
      const key = rollupKey(String(ch.channel || ""));
      if (!channelAllowed(key, allowed)) continue;
      sent += ch.sent || 0;
      opens += ch.opens || 0;
      clicks += ch.clicks || 0;
      totalOpens += ch.totalOpens ?? ch.opens ?? 0;
      totalClicks += ch.totalClicks ?? ch.clicks ?? 0;
      failed += ("failed" in ch ? ch.failed : 0) || 0;
      stubSent += ch.stubSent || 0;
    }
  }
  if (!usedChannelMetrics) {
    for (const row of rows) {
      sent += row.sent || 0;
      opens += row.opens || 0;
      clicks += row.clicks || 0;
      totalOpens += row.totalOpens ?? row.opens ?? 0;
      totalClicks += row.totalClicks ?? row.clicks ?? 0;
      failed += row.failed || 0;
      stubSent += row.stubSent || 0;
    }
  }
  return {
    sent,
    opens,
    clicks,
    totalOpens,
    totalClicks,
    failed,
    stubSent,
    ...engagementRates({ delivered: sent, opens, clicks }),
  };
}

/**
 * Unique numerator over delivered — matches ESP reporting and can never
 * exceed 100%, unlike raw hit counts which include repeat opens.
 */
export function engagementRates(input: {
  delivered: number;
  opens: number;
  clicks: number;
}): { openRate: number | null; clickRate: number | null; ctor: number | null } {
  const delivered = Math.max(0, input.delivered);
  const opens = Math.max(0, input.opens);
  const clicks = Math.max(0, input.clicks);
  const rate = (num: number, den: number) =>
    den > 0 ? Math.min(1, num / den) : null;
  return {
    openRate: rate(opens, delivered),
    clickRate: rate(clicks, delivered),
    ctor: rate(clicks, opens),
  };
}

export function formatChannel(raw: string) {
  const c = raw.trim().toLowerCase();
  if (!c) return "Channel";
  if (c === "email") return "Email";
  if (c === "sms") return "SMS";
  if (c === "whatsapp" || c === "wa") return "WhatsApp";
  if (c === "web_push" || c === "webpush" || c === "web") return "Web Push";
  if (c === "app_push" || c === "apppush" || c === "push") return "App Push";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function formatPct(rate: number | null | undefined) {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/** Channels that record opens in Campaign Overview (email pixel only). */
const OPEN_TRACKED_CHANNELS = new Set(["email"]);

/** Channels that record clicks — matches backend isClickTrackedAgentChannel. */
const CLICK_TRACKED_CHANNELS = new Set(["email", "push", "web"]);

export function isOpenTrackedChannel(channelKey: string | null | undefined): boolean {
  const key = String(channelKey || "").trim().toLowerCase();
  if (!key) return false;
  return OPEN_TRACKED_CHANNELS.has(key);
}

export function isClickTrackedChannel(channelKey: string | null | undefined): boolean {
  const key = String(channelKey || "").trim().toLowerCase();
  if (!key) return false;
  return CLICK_TRACKED_CHANNELS.has(key);
}

export function isRanCampaignStatus(status: string): boolean {
  const s = String(status || "").toLowerCase();
  return s === "live" || s === "completed" || s === "cancelled";
}

export function formatOpenCount(channelKey: string, opens: number): string {
  if (!isOpenTrackedChannel(channelKey)) return "—";
  return opens.toLocaleString();
}

export function channelOpenRate(ch: {
  sent?: number;
  delivered?: number;
  opens?: number;
  openRate?: number | null;
}) {
  if (ch.openRate != null && !Number.isNaN(ch.openRate)) return ch.openRate;
  return engagementRates({
    delivered: ch.delivered ?? ch.sent ?? 0,
    opens: ch.opens || 0,
    clicks: 0,
  }).openRate;
}

export function channelClickRate(ch: {
  sent?: number;
  delivered?: number;
  clicks?: number;
  clickRate?: number | null;
}) {
  if (ch.clickRate != null && !Number.isNaN(ch.clickRate)) return ch.clickRate;
  return engagementRates({
    delivered: ch.delivered ?? ch.sent ?? 0,
    opens: 0,
    clicks: ch.clicks || 0,
  }).clickRate;
}

/** Open rate for Overview display — null when channel does not track opens. */
export function channelOpenRateForDisplay(
  channelKey: string,
  ch: { sent?: number; opens?: number; openRate?: number | null },
): number | null {
  if (!isOpenTrackedChannel(channelKey)) return null;
  return channelOpenRate(ch);
}

/** Click rate for Overview display — null when channel does not track clicks. */
export function channelClickRateForDisplay(
  channelKey: string,
  ch: { sent?: number; clicks?: number; clickRate?: number | null },
): number | null {
  if (!isClickTrackedChannel(channelKey)) return null;
  return channelClickRate(ch);
}

/**
 * Messaging KPIs: open rate and click rate from email only
 * (WhatsApp / web / app push show delivery, not open/click engagement).
 */
export function sumListMetricsTrackedEngagement(
  rows: CampaignListItem[],
  allowed: Set<string> | null = null,
) {
  const all = sumListMetrics(rows, allowed);
  let openTrackedSent = 0;
  let clickTrackedSent = 0;
  let opens = 0;
  let clicks = 0;
  let emailClicks = 0;
  let totalOpens = 0;
  let totalClicks = 0;
  let usedChannelMetrics = false;
  for (const row of rows) {
    if (!row.channelMetrics?.length) continue;
    usedChannelMetrics = true;
    for (const ch of row.channelMetrics) {
      const key = rollupKey(String(ch.channel || ""));
      if (!channelAllowed(key, allowed)) continue;
      const delivered = ch.delivered ?? ch.sent ?? 0;
      if (isOpenTrackedChannel(key)) {
        openTrackedSent += delivered;
        opens += ch.opens || 0;
        emailClicks += ch.clicks || 0;
        totalOpens += ch.totalOpens ?? ch.opens ?? 0;
      }
      if (isClickTrackedChannel(key)) {
        clickTrackedSent += delivered;
        clicks += ch.clicks || 0;
        totalClicks += ch.totalClicks ?? ch.clicks ?? 0;
      }
    }
  }
  if (!usedChannelMetrics) {
    opens = all.opens;
    clicks = all.clicks;
    emailClicks = all.clicks;
    totalOpens = all.totalOpens;
    totalClicks = all.totalClicks;
    openTrackedSent = all.sent;
    clickTrackedSent = all.sent;
  }
  const openRates = engagementRates({
    delivered: openTrackedSent,
    opens,
    clicks: emailClicks,
  });
  const clickRates = engagementRates({
    delivered: clickTrackedSent,
    opens: 0,
    clicks,
  });
  return {
    ...all,
    opens,
    clicks,
    totalOpens,
    totalClicks,
    openRate: openRates.openRate,
    clickRate: clickRates.clickRate,
    ctor: openRates.ctor,
    trackedSent: openTrackedSent,
    clickTrackedSent,
  };
}

function withinLastDays(iso: string | null | undefined, days: number) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= days * MS_DAY;
}

export function shouldShowPausedAlert(
  camp: CampaignDetail,
  ch: CampaignDetail["channels"][number],
) {
  if (!ch.paused) return false;
  if (camp.status === "live" || camp.status === "scheduled") return true;
  if (withinLastDays(ch.pausedAt, PAUSE_ALERT_DAYS)) return true;
  if (withinLastDays(camp.endsAt, PAUSE_ALERT_DAYS)) return true;
  if (!ch.pausedAt && withinLastDays(camp.createdAt, PAUSE_ALERT_DAYS)) {
    return true;
  }
  return false;
}

function sortChannelRollup(rows: ChannelRollup[]): ChannelRollup[] {
  return [...rows].sort((a, b) => {
    const ai = CHANNEL_ROLLUP_ORDER.indexOf(a.key);
    const bi = CHANNEL_ROLLUP_ORDER.indexOf(b.key);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

export function rollupChannelsFromList(rows: CampaignListItem[]): ChannelRollup[] {
  const map = new Map<string, ChannelRollup>();
  for (const camp of rows) {
    if (isPpcOnlyCampaign(camp)) continue;
    if (!isRanCampaignStatus(camp.status)) continue;
    const metrics =
      camp.channelMetrics && camp.channelMetrics.length
        ? camp.channelMetrics
        : (camp.channels || []).map((channel) => ({
            channel,
            sent: 0,
            failed: 0,
            opens: 0,
            clicks: 0,
            stubSent: 0,
            impressions: 0,
            spend: 0,
            conversions: 0,
            currency: null as string | null,
          }));
    const seen = new Set<string>();
    for (const ch of metrics) {
      const key = rollupKey(String(ch.channel || ""));
      if (!key || isPpcKey(key)) continue;
      const row = map.get(key) || emptyChannelRollup(key);
      row.sent += ch.sent || 0;
      row.opens += ch.opens || 0;
      row.clicks += ch.clicks || 0;
      row.failed += ("failed" in ch ? ch.failed : 0) || 0;
      row.stubSent += ch.stubSent || 0;
      row.impressions += ch.impressions || 0;
      row.spend += ch.spend || 0;
      row.conversions += ch.conversions || 0;
      if (!row.currency && ch.currency) row.currency = ch.currency;
      if (!seen.has(key)) {
        seen.add(key);
        row.campaigns += 1;
      }
      map.set(key, row);
    }
  }
  return sortChannelRollup([...map.values()]);
}

export function rollupChannels(details: CampaignDetail[]): ChannelRollup[] {
  const map = new Map<string, ChannelRollup>();
  for (const camp of details) {
    const seen = new Set<string>();
    for (const ch of camp.channels ?? []) {
      const key = rollupKey(ch.channel);
      if (!key || isPpcKey(key)) continue;
      const row = map.get(key) || emptyChannelRollup(key);
      row.sent += ch.sent || 0;
      row.opens += ch.opens || 0;
      row.clicks += ch.clicks || 0;
      row.failed += ch.failed || 0;
      row.stubSent += ch.stubSent || 0;
      row.impressions += ch.impressions || 0;
      row.spend += ch.spend || 0;
      row.conversions += ch.conversions || 0;
      if (!row.currency && ch.currency) row.currency = ch.currency;
      if (!seen.has(key)) {
        seen.add(key);
        row.campaigns += 1;
      }
      map.set(key, row);
    }
  }
  return sortChannelRollup([...map.values()]);
}

export function pickTopCampaign(
  details: CampaignDetail[],
  allowed: Set<string> | null = null,
): {
  id: string;
  name: string;
  channelLabel: string;
  headline: string;
  detail: string;
} | null {
  let best: {
    id: string;
    name: string;
    channelLabel: string;
    headline: string;
    detail: string;
    score: number;
  } | null = null;

  for (const camp of details) {
    if (camp.status !== "live" && camp.status !== "completed") continue;
    for (const ch of camp.channels ?? []) {
      if (!channelAllowed(rollupKey(ch.channel), allowed)) continue;
      const sent = ch.sent || 0;
      const openRate = channelOpenRateForDisplay(ch.channel, ch);
      const clickRate = channelClickRateForDisplay(ch.channel, ch);
      const score =
        (openRate || 0) * 100 +
        (clickRate || 0) * 50 +
        sent * 0.01 +
        (ch.clicks || 0) * 0.1;
      const headline =
        openRate != null
          ? `${formatPct(openRate)} open rate`
          : clickRate != null
            ? `${formatPct(clickRate)} click rate`
            : `${sent.toLocaleString()} delivered`;
      const detail = [
        formatChannel(ch.channel),
        `${sent.toLocaleString()} delivered`,
        `${(ch.failed || 0).toLocaleString()} failed`,
        openRate != null ? `${formatPct(openRate)} open` : null,
        clickRate != null ? `${formatPct(clickRate)} click` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (!best || score > best.score) {
        best = {
          id: camp.id,
          name: camp.name,
          channelLabel: formatChannel(ch.channel),
          headline,
          detail,
          score,
        };
      }
    }
  }
  return best;
}

function daysAgoIso(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Mid-month of the previous calendar month (matches Dashboard “Last month” filter). */
function previousMonthMidYmd(): string {
  const today = ymdDaysAgo(0);
  const [y, m] = today.split("-").map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return `${prevY}-${String(prevM).padStart(2, "0")}-15`;
}

function previousMonthMidIso(hour = 10): string {
  const [y, m, d] = previousMonthMidYmd().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 5, 30, 0)).toISOString();
}

function metric(
  channel: string,
  sent: number,
  opens: number,
  clicks: number,
  failed = 0,
  stubSent = 0,
  selected?: number,
  bounced = 0,
): CampaignChannelMetric {
  const openTracked = isOpenTrackedChannel(channel);
  const clickTracked = isClickTrackedChannel(channel);
  const openVal = openTracked ? opens : 0;
  const clickVal = clickTracked ? clicks : 0;
  const isEmail = channel.toLowerCase() === "email";
  const emailFailed = isEmail ? Math.max(0, failed - bounced) : failed;
  const sel = selected ?? sent + failed + bounced + stubSent;
  return {
    channel,
    selected: sel,
    sent,
    failed: emailFailed,
    bounced: isEmail ? bounced : 0,
    stubSent,
    opens: openVal,
    clicks: clickVal,
    impressions: 0,
    spend: 0,
    conversions: 0,
    currency: null,
    openRate: openTracked && sent > 0 ? openVal / sent : null,
    clickRate: clickTracked && sent > 0 ? clickVal / sent : null,
    fromLiveSends: true,
  };
}

/** Fictional daily delivery curve for Overview area chart. */
export function syntheticDailyTrend(days = 30): DashboardDailyPoint[] {
  const points: DashboardDailyPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = ymdDaysAgo(i);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const weekendSoft = weekday === 0 || weekday === 6 ? 0.72 : 1;
    const wave = 1 + 0.18 * Math.sin((days - i) / 4.2);
    const sent = Math.round((420 + ((days - i) % 7) * 38) * wave * weekendSoft);
    // ~55% of volume is open-tracked (email/push); rest SMS/WA has no opens.
    const trackedSent = Math.round(sent * 0.55);
    const opens = Math.round(
      trackedSent * (0.36 + 0.05 * Math.sin((days - i) / 3.1)),
    );
    const clicks = Math.round(
      opens * (0.14 + 0.04 * Math.cos((days - i) / 4.7)),
    );
    const failed = Math.round(sent * 0.012);
    points.push({
      date,
      label: new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(new Date(`${date}T12:00:00`)),
      sent,
      opens,
      clicks,
      failed,
    });
  }
  return points;
}

/** Map Overview period to agent LIST_MONITOR_CAMPAIGNS filters (IST launch date). */
export function dashboardPeriodToAgentFilter(
  range: PerformanceRange,
  custom?: PerformanceCustomRange | null,
): { relative?: string; from_date?: string; to_date?: string } {
  if (range === "today") return { relative: "today" };
  if (range === "weekly") return { relative: "last_7_days" };
  if (range === "monthly") return { relative: "last_month" };
  if (range === "custom" && custom?.from && custom?.to) {
    const bounds = normalizeYmdRange(custom.from, custom.to);
    return { from_date: bounds.from, to_date: bounds.to };
  }
  return {};
}

/** Activity chart bounds — for All, span earliest launch → today (not default 7d). */
export function dashboardActivitySeriesFilter(
  range: PerformanceRange,
  custom: PerformanceCustomRange | null | undefined,
  campaigns: Array<{
    launchLocalDate?: string | null;
    startsAt?: string | null;
    createdAt?: string | null;
    timezone?: string;
  }>,
): { relative?: string; activity_from?: string; activity_to?: string } {
  const launch = dashboardPeriodToAgentFilter(range, custom);
  if (range !== "all") {
    return {
      relative: launch.relative,
      activity_from: launch.from_date,
      activity_to: launch.to_date,
    };
  }
  const today = istTodayYmd();
  let earliest: string | null = null;
  for (const row of campaigns) {
    const ymd = campaignLaunchLocalDate(row);
    if (!ymd) continue;
    if (!earliest || ymd < earliest) earliest = ymd;
  }
  const from = earliest ?? shiftLocalDate(today, -29);
  return { activity_from: from, activity_to: today };
}

/** Socket / agent payload — launch filter + activity chart bounds (Overview parity). */
export function buildDashboardPeriodPayload(
  range: PerformanceRange,
  customRange: PerformanceCustomRange | null,
  campaigns: Array<{
    launchLocalDate?: string | null;
    startsAt?: string | null;
    createdAt?: string | null;
    timezone?: string;
    status?: string;
    channels?: string[];
  }> = [],
) {
  const launch = dashboardPeriodToAgentFilter(range, customRange);
  const messaging = campaigns.filter(
    (r) => !isPpcOnlyCampaign(r as Parameters<typeof isPpcOnlyCampaign>[0]),
  );
  const activity = dashboardActivitySeriesFilter(range, customRange, messaging);
  return {
    range,
    from: customRange?.from ?? null,
    to: customRange?.to ?? null,
    label: rangeLabel(range, customRange),
    relative: launch.relative ?? null,
    from_date: launch.from_date ?? null,
    to_date: launch.to_date ?? null,
    activity_from: activity.activity_from ?? null,
    activity_to: activity.activity_to ?? null,
  };
}

/** Build delivery trend from campaign list rows (grouped by launch local date). */
export function buildDailyTrendFromCampaigns(
  rows: CampaignListItem[],
  allowed: Set<string> | null = null,
): DashboardDailyPoint[] {
  const byDate = new Map<string, DashboardDailyPoint>();
  for (const row of rows) {
    if (isPpcOnlyCampaign(row)) continue;
    const date = campaignLaunchLocalDate(row);
    if (!date) continue;
    const metrics = sumListMetricsTrackedEngagement([row], allowed);
    const prev = byDate.get(date) || {
      date,
      label: new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(new Date(`${date}T12:00:00`)),
      sent: 0,
      failed: 0,
      opens: 0,
      clicks: 0,
    };
    prev.sent += metrics.sent;
    prev.failed += metrics.failed;
    prev.opens += metrics.opens;
    prev.clicks += metrics.clicks;
    byDate.set(date, prev);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Slice daily series to match Overview period control. */
export function dailyTrendForRange(
  daily: DashboardDailyPoint[] | undefined,
  range: PerformanceRange,
  custom?: PerformanceCustomRange | null,
): DashboardDailyPoint[] {
  const rows = daily || [];
  if (!rows.length) return [];
  const bounds = launchDateBounds(range, custom);
  if (!bounds) return rows;
  return rows.filter(
    (row) => row.date >= bounds.from && row.date <= bounds.to,
  );
}

/**
 * Demo Overview payload when the account has no campaigns yet.
 * Numbers are fictional — UI only.
 */
export function syntheticDashboardBundle(): {
  live: CampaignListItem[];
  scheduled: CampaignListItem[];
  past: CampaignListItem[];
  draft: CampaignListItem[];
  allList: CampaignListItem[];
  details: CampaignDetail[];
  configChannels: ConfigChannel[];
  daily: DashboardDailyPoint[];
  synthetic: true;
} {
  const liveA: CampaignListItem = {
    id: "synth-live-spring",
    name: "Spring reactivation",
    description: "Win-back for quiet subscribers",
    status: "live",
    startsAt: daysAgoIso(2),
    endsAt: null,
    timezone: "Asia/Kolkata",
    launchLocalDate: ymdDaysAgo(2),
    sourceChannel: "email",
    createdAt: daysAgoIso(4),
    audienceCount: 4200,
    sent: 3180,
    failed: 42,
    stubSent: 12,
    // Engagement = email only (WhatsApp not open-tracked).
    opens: 980,
    clicks: 210,
    openRate: 980 / 2400,
    clickRate: 210 / 2400,
    channels: ["email", "whatsapp"],
    channelMetrics: [
      metric("email", 2400, 980, 210, 28, 8, 2500, 8),
      metric("whatsapp", 780, 0, 0, 14, 4, 900),
    ],
  };

  const liveB: CampaignListItem = {
    id: "synth-live-flash",
    name: "Weekend flash sale",
    description: "48h promo blast",
    status: "live",
    startsAt: daysAgoIso(1),
    endsAt: null,
    timezone: "Asia/Kolkata",
    launchLocalDate: ymdDaysAgo(1),
    sourceChannel: "sms",
    createdAt: daysAgoIso(2),
    audienceCount: 1800,
    sent: 1650,
    failed: 18,
    stubSent: 0,
    opens: 310,
    clicks: 32,
    openRate: 310 / 550,
    clickRate: 32 / 550,
    channels: ["sms", "web"],
    channelMetrics: [
      metric("sms", 1100, 0, 0, 12, 0, 1200),
      metric("web", 550, 310, 32, 6, 0, 600),
    ],
  };

  const scheduled: CampaignListItem = {
    id: "synth-sched-nurture",
    name: "Onboarding nurture",
    description: "Day-3 welcome sequence",
    status: "scheduled",
    startsAt: daysAgoIso(-3),
    endsAt: null,
    timezone: "Asia/Kolkata",
    launchLocalDate: ymdDaysAgo(-3),
    sourceChannel: "email",
    createdAt: daysAgoIso(1),
    audienceCount: 900,
    sent: 0,
    failed: 0,
    channels: ["email", "push"],
    channelMetrics: [
      metric("email", 0, 0, 0, 0, 0, 900),
      metric("push", 0, 0, 0, 0, 0, 900),
    ],
  };

  const past: CampaignListItem = {
    id: "synth-past-festive",
    name: "Festive greeting",
    description: "Holiday thank-you send",
    status: "completed",
    startsAt: previousMonthMidIso(11),
    endsAt: previousMonthMidIso(18),
    timezone: "Asia/Kolkata",
    launchLocalDate: previousMonthMidYmd(),
    sourceChannel: "email",
    createdAt: previousMonthMidIso(9),
    audienceCount: 5600,
    sent: 5420,
    failed: 64,
    stubSent: 20,
    // Email opens only; push clicks stay on the push channel row.
    opens: 1680,
    clicks: 290 + 32,
    openRate: 1680 / 3600,
    clickRate: (290 + 32) / (3600 + 620),
    channels: ["email", "whatsapp", "push"],
    channelMetrics: [
      metric("email", 3600, 1680, 290, 40, 12, 3800, 15),
      metric("whatsapp", 1200, 0, 0, 16, 5, 1300),
      metric("push", 620, 150, 32, 8, 3, 700),
    ],
  };

  const live = [liveA, liveB];
  const pastList = [past];
  const scheduledList = [scheduled];
  const draft: CampaignListItem[] = [];
  const allList = [...live, ...scheduledList, ...pastList];

  const details: CampaignDetail[] = allList.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    goal: "Engagement",
    objective: null,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    audienceCount: row.audienceCount || 0,
    audienceSummary: null,
    stubSent: row.stubSent,
    launchPlan: null,
    sourceChannel: row.sourceChannel,
    createdAt: row.createdAt,
    sent: row.sent,
    failed: row.failed,
    opens: row.opens,
    clicks: row.clicks,
    openRate: row.openRate ?? null,
    clickRate: row.clickRate ?? null,
    channels: (row.channelMetrics || []).map((ch, i) => ({
      id: `${row.id}-ch-${i}`,
      channel: ch.channel,
      howItWorks: null,
      plannedLaunchAt: row.startsAt,
      status: row.status === "live" ? "live" : row.status,
      templateId: null,
      totalToSend: ch.selected,
      selected: ch.selected,
      sent: ch.sent,
      failed: ch.failed,
      bounced: ch.bounced,
      stubSent: ch.stubSent,
      opens: ch.opens,
      clicks: ch.clicks,
      openRate: ch.openRate,
      clickRate: ch.clickRate,
      paused:
        row.id === "synth-live-flash" && ch.channel === "sms" ? true : false,
      pauseReason:
        row.id === "synth-live-flash" && ch.channel === "sms"
          ? "Delivery rate dipped — review copy"
          : null,
      pausedAt:
        row.id === "synth-live-flash" && ch.channel === "sms"
          ? daysAgoIso(0, 8)
          : null,
      impressions: 0,
      spend: 0,
      currency: null,
      conversions: 0,
      fromLiveSends: true,
    })),
  }));

  const configChannels: ConfigChannel[] = [
    {
      channel: "email",
      label: "Email",
      group: "messaging",
      status: "ready",
    },
    {
      channel: "sms",
      label: "SMS",
      group: "messaging",
      status: "ready",
    },
    {
      channel: "whatsapp",
      label: "WhatsApp",
      group: "messaging",
      status: "ready",
    },
    {
      channel: "web_push",
      label: "Web Push",
      group: "messaging",
      status: "ready",
    },
    {
      channel: "app_push",
      label: "App Push",
      group: "messaging",
      status: "ready",
    },
  ];

  return {
    live,
    scheduled: scheduledList,
    past: pastList,
    draft,
    allList,
    details,
    configChannels,
    daily: syntheticDailyTrend(30),
    synthetic: true,
  };
}

/** Demo Overview for UI rebuild / screenshots only. */
export const DASHBOARD_FORCE_SYNTHETIC = false;

/** Cap parallel detail fetches so Overview does not stall the API. */
const DETAIL_FETCH_CONCURRENCY = 4;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      try {
        const row = await fn(item);
        if (row != null) out.push(row);
      } catch {
        /* skip */
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export async function loadDashboardBundle(opts?: {
  /** When true, empty accounts get demo Overview numbers. Default false. */
  allowSynthetic?: boolean;
  /** Force demo Overview (UI rebuild / screenshots). */
  forceSynthetic?: boolean;
}) {
  if (opts?.forceSynthetic === true || DASHBOARD_FORCE_SYNTHETIC) {
    return syntheticDashboardBundle();
  }

  const allowSynthetic = opts?.allowSynthetic === true;
  // Include draft so period totals match Reports LIST_MONITOR_CAMPAIGNS bucket=all.
  const [live, scheduled, past, draft, configChannels] = await Promise.all([
    fetchCampaigns("live"),
    fetchCampaigns("scheduled"),
    fetchCampaigns("past"),
    fetchCampaigns("draft"),
    fetchConfigChannels().catch(() => [] as ConfigChannel[]),
  ]);

  const byId = new Map<string, CampaignListItem>();
  for (const row of [...live, ...scheduled, ...past, ...draft]) {
    byId.set(row.id, row);
  }
  const allList = [...byId.values()];

  if (allowSynthetic && allList.length === 0) {
    return syntheticDashboardBundle();
  }

  // KPIs / channel rollup / trend come from list metrics. Only fetch details for
  // live campaigns (pause alerts) — never N+1 every campaign or Overview stays
  // on skeleton while the API is flooded.
  const liveIds = [...new Set(live.map((c) => c.id))];
  const details = await mapPool(liveIds, DETAIL_FETCH_CONCURRENCY, async (id) => {
    const detail = await fetchCampaignById(id);
    return {
      ...detail,
      channels: detail.channels ?? [],
    } as CampaignDetail;
  });

  const configured = configuredAgentChannelSet(configChannels);
  return {
    live,
    scheduled,
    past,
    draft,
    allList,
    details,
    configChannels,
    daily: buildDailyTrendFromCampaigns(allList, configured),
    synthetic: false as const,
  };
}



import type { DraftTemplateMoment } from "@/lib/campaign-drafts";
import { flattenTimelineCards } from "@/lib/campaign-template-timeline";

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  web: "Web push",
  web_push: "Web push",
  push: "App push",
  app_push: "App push",
};

/** Agent cards use web/push; session UI may use web_push/app_push. */
function normalizeChannelCountKey(id: string): string {
  const key = String(id || "").trim().toLowerCase();
  if (key === "web_push") return "web";
  if (key === "app_push") return "push";
  return key;
}

function channelLabel(id: string): string {
  const key = String(id || "").trim().toLowerCase();
  return CHANNEL_LABEL[key] || key;
}

function countForConfiguredChannel(
  counts: Record<string, number>,
  configuredId: string,
): number {
  const uiKey = String(configuredId || "").trim().toLowerCase();
  const agentKey = normalizeChannelCountKey(uiKey);
  return counts[agentKey] ?? counts[uiKey] ?? 0;
}

/** Count chat-visible template cards per channel (timeline only — not raw agent list). */
export function templateCountsByChannelFromTimeline(
  moments: DraftTemplateMoment[] | undefined | null,
): Record<string, number> {
  const cards = flattenTimelineCards(moments);
  const out: Record<string, number> = {};
  for (const card of cards) {
    const ch = String(card.channel || "").trim().toLowerCase();
    if (!ch) continue;
    out[ch] = (out[ch] || 0) + 1;
  }
  return out;
}

export function formatChannelTemplateSummary(
  counts: Record<string, number>,
  configuredChannelIds: string[],
): string {
  const ids = configuredChannelIds.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(ids.length ? ids : Object.keys(counts))];
  if (!unique.length) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return total > 0 ? `${total} card${total === 1 ? "" : "s"}` : "";
  }
  return unique
    .map((id) => {
      const n = countForConfiguredChannel(counts, id);
      return `${channelLabel(id)}: ${n}`;
    })
    .join(" · ");
}

export function totalTimelineTemplateCount(
  moments: DraftTemplateMoment[] | undefined | null,
): number {
  return flattenTimelineCards(moments).length;
}

export function formatLaunchPlanByChannel(input: {
  launchConfirmed?: boolean;
  scheduleMode?: string;
  launchChannels?: string[];
  launchLocalDate?: string;
  launchLocalTime?: string;
  timezone?: string;
  sendTimeLabel?: string;
}): string {
  const channels = (input.launchChannels || [])
    .map((c) => String(c).trim().toLowerCase())
    .filter(Boolean);
  if (!channels.length) return input.sendTimeLabel || "";

  const mode = String(input.scheduleMode || "").toLowerCase();
  const when =
    mode === "now" || mode === "immediate"
      ? "Immediate"
      : [input.launchLocalDate, input.launchLocalTime].filter(Boolean).join(" ") ||
        input.sendTimeLabel ||
        "Scheduled";

  if (!input.launchConfirmed && when === "Scheduled" && !input.launchLocalDate) {
    return channels.map((ch) => `${channelLabel(ch)}: planned`).join("\n");
  }

  return channels.map((ch) => `${channelLabel(ch)}: ${when}`).join("\n");
}

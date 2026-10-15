/**
 * Campaign activity notification helpers.
 * Lifecycle / progress / failures are emitted server-side into /api/notifications.
 * Pause/resume still pushes an optimistic local row (matching server sourceKey).
 */

import { pushNotification } from "@/lib/notifications-store";

function campaignHref(id: string) {
  return `/campaigns/${id}`;
}

/** Notify when a channel is paused/resumed from the monitor UI (optimistic). */
export function notifyCampaignChannelRunState(opts: {
  campaignId: string;
  campaignName: string;
  channel: string;
  paused: boolean;
  reason?: string | null;
}): void {
  const ch = (opts.channel.trim() || "channel").toLowerCase();
  const label = ch.charAt(0).toUpperCase() + ch.slice(1);
  if (opts.paused) {
    pushNotification({
      kind: "campaign_channel_paused",
      title: `${label} paused`,
      body: opts.reason?.trim()
        ? `“${opts.campaignName}” — ${opts.reason.trim()}`
        : `“${opts.campaignName}” — ${label} channel was paused.`,
      href: campaignHref(opts.campaignId),
      sourceKey: `campaign:paused:${opts.campaignId}:${ch}`,
    });
  } else {
    pushNotification({
      kind: "campaign_channel_resumed",
      title: `${label} resumed`,
      body: `“${opts.campaignName}” — ${label} channel is running again.`,
      href: campaignHref(opts.campaignId),
      sourceKey: `campaign:resumed:${opts.campaignId}:${ch}:${Date.now()}`,
    });
  }
}

/**
 * @deprecated Campaign activity is emitted server-side into /api/notifications.
 */
export async function syncCampaignActivityNotifications(): Promise<void> {
  return;
}

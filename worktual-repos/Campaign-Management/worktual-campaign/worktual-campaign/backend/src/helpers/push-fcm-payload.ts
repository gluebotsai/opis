/** Tracking extras on FCM `data` — never duplicate title/body (OS + app would show twice). */

export type PushCampaignTrack = {
  recipient_id: string;
  campaign_id: string;
  channel: "push" | "web";
  click_url?: string;
};

export function trackingData(track?: PushCampaignTrack): Record<string, string> {
  if (!track?.recipient_id || !track.campaign_id || !track.channel) {
    return {};
  }
  const data: Record<string, string> = {
    recipient_id: String(track.recipient_id),
    campaign_id: String(track.campaign_id),
    channel: String(track.channel),
  };
  if (track.click_url) data.click_url = String(track.click_url);
  return data;
}

export function fcmDataPayload(args: {
  cta?: string;
  track?: PushCampaignTrack;
}): Record<string, string> {
  return {
    ...(args.cta ? { cta_label: args.cta } : {}),
    ...trackingData(args.track),
  };
}

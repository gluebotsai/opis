// @ts-nocheck
/** Ready campaign channels for Template Gallery generation (send-ready in Setup). */

import type { CampaignSessionUser } from "../types/auth.js";
import { env } from "../config/env.js";
import { listChannelProfilesDao } from "./configuration.js";
import {
  getCampaignEmailStatusDao,
} from "./email-config.js";
import { getCampaignPushStatusDao } from "./push-config.js";
import { resolveWhatsAppChannelConfigId } from "./whatsapp-channel-config.js";
import { activeGalleryChannels } from "../helpers/gallery-template-specs.js";

export const GALLERY_CHANNEL_IDS = [
  "email",
  "whatsapp",
  "web_push",
  "app_push",
] as const;

export type GalleryChannelId = (typeof GALLERY_CHANNEL_IDS)[number];

export function normalizeGalleryChannelId(raw: string): GalleryChannelId | null {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "email") return "email";
  if (t === "whatsapp" || t === "meta_whatsapp") return "whatsapp";
  if (t === "web_push" || t === "web") return "web_push";
  if (t === "app_push" || t === "push") return "app_push";
  return null;
}

function channelReadyStatus(
  row: { channel: string; status: string },
  overrides: {
    emailStatus: string;
    webPushStatus: string;
    appPushStatus: string;
    whatsappReady: boolean;
  },
): string {
  if (row.channel === "email") return overrides.emailStatus;
  if (row.channel === "web_push") return overrides.webPushStatus;
  if (row.channel === "app_push") return overrides.appPushStatus;
  if (row.channel === "meta_whatsapp" && overrides.whatsappReady) return "ready";
  return row.status;
}

/** Channels send-ready in Setup — mirrors Configuration channel merge logic. */
export async function listReadyGalleryChannels(
  session: CampaignSessionUser,
): Promise<GalleryChannelId[]> {
  const profiles = await listChannelProfilesDao(session);
  const orgId = session.organizationId;

  const [emailStatus, webPushStatus, appPushStatus] = await Promise.all([
    getCampaignEmailStatusDao(orgId),
    getCampaignPushStatusDao(orgId, "web_push"),
    getCampaignPushStatusDao(orgId, "app_push"),
  ]);

  let whatsappReady = Boolean(env.social.whatsappChannelConfigId?.trim());
  if (!whatsappReady) {
    try {
      await resolveWhatsAppChannelConfigId(orgId);
      whatsappReady = true;
    } catch {
      whatsappReady = false;
    }
  }

  const ready = new Set<GalleryChannelId>();
  for (const row of profiles) {
    const status = channelReadyStatus(row, {
      emailStatus,
      webPushStatus,
      appPushStatus,
      whatsappReady,
    });
    if (status !== "ready") continue;
    const ch = normalizeGalleryChannelId(row.channel);
    if (ch) ready.add(ch);
  }
  return GALLERY_CHANNEL_IDS.filter((id) => ready.has(id));
}

/**
 * Channels eligible for Template Gallery generation.
 * Email requires send-ready config; web push only needs the channel enabled in Setup
 * (gallery templates are content — VAPID keys are not required to generate previews).
 */
export async function listGalleryGenerationChannels(
  session: CampaignSessionUser,
): Promise<GalleryChannelId[]> {
  const profiles = await listChannelProfilesDao(session);
  const sendReady = new Set(await listReadyGalleryChannels(session));

  let webPushEnabled = false;
  for (const row of profiles) {
    const ch = normalizeGalleryChannelId(row.channel);
    if (ch !== "web_push") continue;
    if (String(row.status || "").toLowerCase() === "blocked") continue;
    webPushEnabled = true;
    break;
  }

  const merged: GalleryChannelId[] = [];
  if (sendReady.has("email")) merged.push("email");
  if (webPushEnabled) merged.push("web_push");
  for (const ch of GALLERY_CHANNEL_IDS) {
    if (ch === "email" || ch === "web_push") continue;
    if (sendReady.has(ch)) merged.push(ch);
  }
  return activeGalleryChannels(merged);
}

export function channelsSnapshotHash(channels: string[]): string {
  return [...channels].sort().join(",");
}

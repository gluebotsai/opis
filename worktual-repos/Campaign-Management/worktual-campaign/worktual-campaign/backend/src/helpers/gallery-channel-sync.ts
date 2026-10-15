/** Sync Template Gallery when Configuration channel readiness changes. */

import type { CampaignSessionUser } from "../types/auth.js";
import { listReadyGalleryChannels } from "../dao/gallery-channels.js";
import { applyGalleryChannelDelta } from "../services/gallery-bootstrap-worker.js";

export async function syncGalleryChannelsAfterConfigChange(
  session: CampaignSessionUser,
  previousReadyChannels: string[],
) {
  const next = await listReadyGalleryChannels(session);
  const prevSorted = [...previousReadyChannels].sort().join(",");
  const nextSorted = [...next].sort().join(",");
  if (prevSorted === nextSorted) return;
  await applyGalleryChannelDelta(session, previousReadyChannels, next);
}

export async function snapshotReadyGalleryChannels(
  session: CampaignSessionUser,
): Promise<string[]> {
  return listReadyGalleryChannels(session);
}

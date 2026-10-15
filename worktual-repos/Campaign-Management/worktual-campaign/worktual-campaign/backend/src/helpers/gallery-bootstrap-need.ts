/**
 * Decide whether an org needs a new gallery bootstrap job (login idempotency).
 */

import {
  countActiveGalleryIdeas,
  listGalleryIdeasDao,
} from "../dao/gallery-idea.js";
import {
  getActiveGalleryJob,
  getLatestGalleryJob,
  type GalleryJobType,
} from "../dao/gallery-job.js";
import { listLibraryTemplatesDao } from "../dao/library-template.js";
import { listGalleryGenerationChannels } from "../dao/gallery-channels.js";
import { GALLERY_MIN_IDEAS } from "./gallery-metadata.js";
import {
  countMissingTemplateSpecs,
  isCurrentGalleryTemplateKey,
  activeGalleryChannels,
} from "./gallery-template-specs.js";
import { countEmailGalleryTemplatesNeedingRegen } from "./gallery-template-regen.js";
import { countGalleryImageWorkPending } from "./gallery-template-images.js";
import type { CampaignSessionUser } from "../types/auth.js";

export type GalleryBootstrapAssessment = {
  needed: boolean;
  reason: string;
  ideaCount: number;
  templateCount: number;
  missingTemplates: number;
  readyChannels: string[];
  galleryComplete: boolean;
};

export async function assessGalleryBootstrapNeed(
  session: CampaignSessionUser,
  jobType: GalleryJobType = "bootstrap",
): Promise<GalleryBootstrapAssessment> {
  const orgId = session.organizationId;
  const readyChannels = await listGalleryGenerationChannels(session);
  const galleryChannels = activeGalleryChannels(readyChannels);
  const ideaCount = await countActiveGalleryIdeas(orgId);
  const templates = await listLibraryTemplatesDao(orgId);
  const templateCount = templates.length;
  const existingKeys = new Set(
    templates
      .map((r) => String(r.seedSlug || r.galleryKey || "").trim())
      .filter((key) => key && isCurrentGalleryTemplateKey(key)),
  );
  const ideas = await listGalleryIdeasDao(orgId);
  const missingTemplates = galleryChannels.length
    ? countMissingTemplateSpecs(ideas, galleryChannels, existingKeys)
    : 0;
  const regenNeeded = countEmailGalleryTemplatesNeedingRegen(templates);
  const rowsByKey = new Map(
    templates
      .map((row) => [
        String(row.seedSlug || row.galleryKey || "").trim(),
        row,
      ] as const)
      .filter(([key]) => Boolean(key)),
  );
  const imageWorkNeeded = countGalleryImageWorkPending(
    ideas,
    galleryChannels,
    rowsByKey,
  );
  const templatesPending = missingTemplates + regenNeeded + imageWorkNeeded;

  const base = {
    ideaCount,
    templateCount,
    missingTemplates: templatesPending,
    readyChannels: galleryChannels,
    galleryComplete: false,
  };

  const active = await getActiveGalleryJob(orgId);
  if (active) {
    return { ...base, needed: false, reason: "job_active" };
  }

  if (jobType === "industry_append") {
    return { ...base, needed: true, reason: "industry_append" };
  }

  if (jobType === "channel_delta") {
    return { ...base, needed: templatesPending > 0, reason: "channel_delta" };
  }

  if (ideaCount < GALLERY_MIN_IDEAS) {
    return { ...base, needed: true, reason: "ideas_needed" };
  }

  if (!galleryChannels.length) {
    return {
      ...base,
      needed: false,
      reason: "no_ready_channels",
      galleryComplete: ideaCount >= GALLERY_MIN_IDEAS,
    };
  }

  if (templatesPending > 0) {
    const latest = await getLatestGalleryJob(orgId);
    const reason =
      latest?.status === "failed" ? "retry_after_failed" : "templates_needed";
    return { ...base, needed: true, reason };
  }

  return {
    ...base,
    needed: false,
    reason: "gallery_complete",
    galleryComplete: true,
  };
}

// @ts-nocheck
/**
 * Template Gallery bootstrap worker — thin Prisma shell.
 * Decision + generation live in Python (`/gallery/worker/process-job-chunk`).
 */

import { env } from "../config/env.js";
import {
  countActiveGalleryIdeas,
  listGalleryIdeasDao,
  upsertGalleryIdeaDao,
} from "../dao/gallery-idea.js";
import {
  claimNextQueuedGalleryJob,
  getActiveGalleryJob,
  getLatestGalleryJob,
  listRunningGalleryJobs,
  updateGalleryJobProgress,
  type PublicGalleryJob,
} from "../dao/gallery-job.js";
import { loadGalleryOrgContext, orgPayloadForAgents } from "../dao/gallery-org-context.js";
import {
  hideLegacyStaticLibraryTemplates,
  purgeObsoleteLibraryTemplates,
  listLibraryTemplatesDao,
  upsertGeneratedLibraryTemplateDao,
  setLibraryTemplatesChannelLock,
} from "../dao/library-template.js";
import { GALLERY_MIN_IDEAS } from "../helpers/gallery-metadata.js";
import {
  expectedGalleryTemplateCount,
  activeGalleryChannels,
} from "../helpers/gallery-template-specs.js";
import {
  processGalleryJobChunkViaAgents,
  type GalleryWorkerMutation,
} from "./gallery-agents.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { listGalleryGenerationChannels } from "../dao/gallery-channels.js";
import {
  enqueueGalleryJob,
  hasPendingGalleryJobs,
} from "../dao/gallery-job.js";
import { assessGalleryBootstrapNeed } from "../helpers/gallery-bootstrap-need.js";
import { resolveGalleryAuthToken } from "../helpers/gallery-auth-token.js";

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

let workerLog: Logger | undefined;
let workerTimer: ReturnType<typeof setTimeout> | null = null;
let workerActive = false;

export async function enqueueGalleryBootstrapForSession(
  session: CampaignSessionUser,
  jobType: "bootstrap" | "channel_delta" | "industry_append" = "bootstrap",
) {
  if (!env.gallery.enabled) {
    return { enqueued: false, reason: "disabled" };
  }

  const assessment = await assessGalleryBootstrapNeed(session, jobType);
  if (!assessment.needed) {
    const latest = await getLatestGalleryJob(session.organizationId);
    return {
      enqueued: false,
      reason: assessment.reason,
      assessment,
      job: latest,
    };
  }

  const channels = assessment.readyChannels;
  const galleryChannels = activeGalleryChannels(channels);
  const ideaCount = assessment.ideaCount;
  let ideasTarget = GALLERY_MIN_IDEAS;
  if (jobType === "industry_append") {
    ideasTarget = ideaCount + GALLERY_MIN_IDEAS;
  } else if (jobType === "bootstrap" && ideaCount >= GALLERY_MIN_IDEAS) {
    ideasTarget = ideaCount;
  }

  const job = await enqueueGalleryJob({
    organizationId: session.organizationId,
    jobType,
    channelsSnapshot: galleryChannels,
    progress: {
      phase: "queued",
      ideasTarget,
      ideasDone: ideaCount,
      templatesTarget: expectedGalleryTemplateCount(galleryChannels),
    },
  });
  wakeGalleryBootstrapWorker();
  return { enqueued: true, reason: assessment.reason, assessment, job };
}

export async function enqueueGalleryIndustryAppend(
  session: CampaignSessionUser,
) {
  return enqueueGalleryBootstrapForSession(session, "industry_append");
}

export async function getGalleryStatusForOrg(organizationId: string) {
  const job = await getLatestGalleryJob(organizationId);
  const ideaCount = await countActiveGalleryIdeas(organizationId);
  const templates = await listLibraryTemplatesDao(organizationId);
  return {
    enabled: env.gallery.enabled,
    job,
    ideaCount,
    templateCount: templates.length,
    minIdeas: GALLERY_MIN_IDEAS,
  };
}

async function applyGalleryMutations(
  mutations: GalleryWorkerMutation[],
  log?: Logger,
) {
  for (const m of mutations) {
    if (m.op === "purge_legacy") {
      const hidden = await hideLegacyStaticLibraryTemplates(m.organization_id);
      const purged = await purgeObsoleteLibraryTemplates(m.organization_id);
      log?.info(
        { orgId: m.organization_id, hidden, purged },
        "Gallery: legacy static templates hidden/purged",
      );
      continue;
    }
    if (m.op === "upsert_idea") {
      await upsertGalleryIdeaDao({
        organizationId: m.organization_id,
        ideaKey: m.idea_key,
        title: m.title,
        summary: m.summary || "",
        industry: m.industry,
        industryType: m.industry_type,
        packId: m.pack_id,
        sortOrder: m.sort_order,
      });
      continue;
    }
    if (m.op === "upsert_template") {
      await upsertGeneratedLibraryTemplateDao({
        organizationId: m.organization_id,
        galleryKey: m.gallery_key,
        name: m.name,
        description: m.description,
        goal: m.goal,
        primaryChannel: m.primary_channel,
        channels: m.channels,
        bodyPreview: m.body_preview,
        contentBody: m.content_body,
        previewImage: m.preview_image ?? null,
        preview: m.preview ?? null,
        fields: m.fields ?? null,
        metadata: m.metadata || {},
      });
      continue;
    }
    if (m.op === "update_job") {
      await updateGalleryJobProgress(m.job_id, {
        progress: m.progress,
        status: m.status as
          | "queued"
          | "running"
          | "completed"
          | "failed"
          | undefined,
        errorMessage: m.error_message,
      });
    }
  }
}

async function processJobChunk(job: PublicGalleryJob, log?: Logger) {
  const orgId = job.organizationId;
  const orgCtx = await loadGalleryOrgContext(orgId);
  const orgPayload = orgPayloadForAgents(orgCtx);
  const authToken = await resolveGalleryAuthToken(orgId);
  const ideas = await listGalleryIdeasDao(orgId);
  const templates = await listLibraryTemplatesDao(orgId, { includeLocked: true });

  const result = await processGalleryJobChunkViaAgents({
    job: {
      id: job.id,
      organizationId: job.organizationId,
      jobType: job.jobType,
      status: job.status,
      channelsSnapshot: job.channelsSnapshot,
      progress: job.progress || {},
    },
    org: orgPayload,
    orgCtx: {
      organizationId: orgCtx.organizationId,
      companyName: orgCtx.companyName,
      industryType: orgCtx.industryType,
      packId: orgCtx.packId,
      mode: orgCtx.mode,
      industry: orgCtx.industry,
    },
    ideas,
    templates,
    authToken,
    templatesPerTick: env.gallery.templatesPerTick,
  });

  if (!result.ok) {
    await updateGalleryJobProgress(job.id, {
      progress: {
        ...(job.progress || {}),
        phase: "worker_error",
        lastImageError: result.error,
        lastTemplateError: result.error,
      },
    });
    log?.warn(
      { orgId, error: result.error },
      "Gallery: Python worker chunk failed — will retry",
    );
    return;
  }

  await applyGalleryMutations(result.mutations || [], log);
  for (const row of result.logs || []) {
    const level = String(row.level || "info");
    const msg = String(row.msg || "Gallery worker");
    if (level === "warn") log?.warn(row.data || {}, msg);
    else if (level === "error") log?.error(row.data || {}, msg);
    else log?.info(row.data || {}, msg);
  }
}

export async function runGalleryBootstrapTick(log?: Logger) {
  if (!env.gallery.enabled) {
    return { processed: 0 };
  }

  let processed = 0;
  const running = await listRunningGalleryJobs();
  const job = running[0] || (await claimNextQueuedGalleryJob());

  if (!job) return { processed: 0 };

  try {
    await processJobChunk(job, log);
    processed = 1;
  } catch (err) {
    log?.error({ err, jobId: job.id }, "Gallery bootstrap chunk failed");
    await updateGalleryJobProgress(job.id, {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
  return { processed };
}

export async function applyGalleryChannelDelta(
  session: CampaignSessionUser,
  previousChannels: string[],
  nextChannels: string[],
) {
  const orgId = session.organizationId;
  const prev = new Set(previousChannels);
  const next = new Set(nextChannels);
  for (const ch of prev) {
    if (!next.has(ch)) {
      await setLibraryTemplatesChannelLock(orgId, ch, true);
    }
  }
  for (const ch of next) {
    if (!prev.has(ch)) {
      await setLibraryTemplatesChannelLock(orgId, ch, false);
    }
  }
  const active = await getActiveGalleryJob(orgId);
  if (!active) {
    await enqueueGalleryBootstrapForSession(session, "channel_delta");
  }
}

/** Nudge the worker when a new job is enqueued (avoids waiting on idle interval). */
export function wakeGalleryBootstrapWorker() {
  if (!workerActive || !workerLog) return;
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = setTimeout(() => {
    void runGalleryWorkerCycle().catch((err) => {
      workerLog?.error({ err }, "Gallery bootstrap worker cycle failed");
    });
  }, 0);
}

async function runGalleryWorkerCycle() {
  if (!env.gallery.enabled || !workerLog) return;

  let delayMs = env.gallery.workerIdleIntervalMs;
  try {
    const pending = await hasPendingGalleryJobs();
    if (pending) {
      await runGalleryBootstrapTick(workerLog);
      const stillPending = await hasPendingGalleryJobs();
      delayMs = stillPending
        ? env.gallery.workerIntervalMs
        : env.gallery.workerIdleIntervalMs;
    }
  } catch (err) {
    workerLog.error({ err }, "Gallery bootstrap worker tick failed");
    delayMs = env.gallery.workerIntervalMs;
  }

  workerTimer = setTimeout(() => {
    void runGalleryWorkerCycle();
  }, delayMs);
}

export function startGalleryBootstrapWorker(log: Logger) {
  workerLog = log;
  workerActive = true;
  log.info(
    {
      activeIntervalMs: env.gallery.workerIntervalMs,
      idleIntervalMs: env.gallery.workerIdleIntervalMs,
      orchestration: "python",
    },
    "Template Gallery bootstrap worker started (Python decisions)",
  );
  void runGalleryWorkerCycle();
}

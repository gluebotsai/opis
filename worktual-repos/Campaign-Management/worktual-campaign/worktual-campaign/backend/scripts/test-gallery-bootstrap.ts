/**
 * Real-time Template Gallery bootstrap smoke test.
 * Run: tsx scripts/test-gallery-bootstrap.ts [--org-id=123] [--ticks=15]
 */
import { prisma } from "../src/plugins/prisma.js";
import {
  countActiveGalleryIdeas,
  listGalleryIdeasDao,
} from "../src/dao/gallery-idea.js";
import {
  enqueueGalleryJob,
  getLatestGalleryJob,
} from "../src/dao/gallery-job.js";
import { listLibraryTemplatesDao } from "../src/dao/library-template.js";
import { listGalleryGenerationChannels } from "../src/dao/gallery-channels.js";
import { getSessionUserById } from "../src/dao/auth.js";
import { accountQuery } from "../src/plugins/account-pool.js";
import type { CampaignSessionUser } from "../src/types/auth.js";
import { runGalleryBootstrapTick } from "../src/services/gallery-bootstrap-worker.js";
import { GALLERY_MIN_IDEAS } from "../src/helpers/gallery-metadata.js";
import { expectedGalleryTemplateCount } from "../src/helpers/gallery-template-specs.js";

const log = {
  info: (obj: unknown, msg?: string) =>
    console.log(msg || "", typeof obj === "object" ? JSON.stringify(obj) : obj),
  warn: (obj: unknown, msg?: string) =>
    console.warn(msg || "", typeof obj === "object" ? JSON.stringify(obj) : obj),
  error: (obj: unknown, msg?: string) =>
    console.error(msg || "", typeof obj === "object" ? JSON.stringify(obj) : obj),
};

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

async function resolveOrgId(): Promise<string> {
  const fromArg = arg("org-id", "").trim();
  if (fromArg) return fromArg;

  const userId = arg("user-id", "").trim();
  if (userId) {
    const session = await getSessionUserById(userId);
    if (session?.organizationId) return session.organizationId;
  }

  const row = await prisma.campaignGalleryJob.findFirst({
    orderBy: { createdAt: "desc" },
    select: { organizationId: true },
  });
  if (row) return String(row.organizationId);

  throw new Error(
    "Could not resolve org — pass --org-id= or --user-id= with an active setup user",
  );
}

async function resolveSessionForOrg(orgId: string): Promise<CampaignSessionUser> {
  const userId = arg("user-id", "").trim();
  if (userId) {
    const session = await getSessionUserById(userId);
    if (!session) {
      throw new Error(`No active session for user-id=${userId}`);
    }
    return session;
  }

  const { rows } = await accountQuery<{ id: string }>(
    `SELECT id::text AS id
     FROM accounts.setup_users
     WHERE organization_id::text = $1
       AND lower(status) = 'active'
     ORDER BY id ASC
     LIMIT 1`,
    [orgId],
  );
  const activeUserId = rows[0]?.id?.trim();
  if (!activeUserId) {
    throw new Error(`No active setup user for org-id=${orgId}`);
  }
  const session = await getSessionUserById(activeUserId);
  if (!session) {
    throw new Error(`Could not build session for user-id=${activeUserId}`);
  }
  return session;
}

async function main() {
  const ticks = Math.max(1, Number(arg("ticks", "15")) || 15);
  const orgId = await resolveOrgId();
  const session = await resolveSessionForOrg(orgId);

  const channels = await listGalleryGenerationChannels(session);
  const templatesTarget = expectedGalleryTemplateCount(channels);
  console.log("orgId:", orgId);
  console.log("ready channels:", channels.join(", ") || "(none)");
  console.log("templates target:", templatesTarget);

  const beforeIdeas = await countActiveGalleryIdeas(orgId);
  const beforeTemplates = (await listLibraryTemplatesDao(orgId)).length;
  console.log("before:", { ideas: beforeIdeas, templates: beforeTemplates });

  const prior = await getLatestGalleryJob(orgId);
  if (prior && (prior.status === "queued" || prior.status === "running")) {
    console.log("using existing job:", prior.id, prior.status, prior.progress);
  } else {
    const job = await enqueueGalleryJob({
      organizationId: orgId,
      jobType: "bootstrap",
      channelsSnapshot: channels,
      progress: {
        phase: "queued",
        ideasTarget: GALLERY_MIN_IDEAS,
        templatesTarget,
      },
    });
    console.log("enqueued job:", job.id, job.status);
  }

  for (let i = 0; i < ticks; i += 1) {
    const tick = await runGalleryBootstrapTick(log);
    const job = await getLatestGalleryJob(orgId);
    const ideas = await countActiveGalleryIdeas(orgId);
    const templates = (await listLibraryTemplatesDao(orgId)).length;
    console.log(
      `tick ${i + 1}/${ticks} processed=${tick.processed} job=${job?.status} phase=${job?.progress?.phase} ideas=${ideas}/${GALLERY_MIN_IDEAS} templates=${templates}`,
    );
    if (job?.status === "failed") {
      console.error("job failed:", job.errorMessage);
      process.exit(1);
    }
    if (job?.status === "completed") {
      console.log("job completed:", job.progress);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const finalJob = await getLatestGalleryJob(orgId);
  const finalIdeas = await listGalleryIdeasDao(orgId);
  const finalTemplates = await listLibraryTemplatesDao(orgId);
  console.log("\n=== RESULT ===");
  console.log("job:", finalJob?.status, finalJob?.progress, finalJob?.errorMessage);
  console.log("ideas:", finalIdeas.length, finalIdeas.slice(0, 3).map((i) => i.title));
  console.log("templates:", finalTemplates.length);
  if (finalTemplates.length > 0) {
    console.log(
      "sample keys:",
      finalTemplates.slice(0, 3).map((t) => t.seedSlug || t.galleryKey),
    );
  }

  if (finalIdeas.length < GALLERY_MIN_IDEAS && finalJob?.status !== "completed") {
    console.warn(
      `Incomplete after ${ticks} ticks — increase --ticks= or check agents/backend logs`,
    );
    process.exit(2);
  }
  console.log("gallery bootstrap smoke test passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

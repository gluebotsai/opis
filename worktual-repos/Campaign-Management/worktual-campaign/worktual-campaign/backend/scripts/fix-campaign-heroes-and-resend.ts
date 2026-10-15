/**
 * Publish local hero bytes to rebuild, patch templates, send new email batches.
 *
 *   npx tsx scripts/fix-campaign-heroes-and-resend.ts --campaign 1394 --campaign 1395
 */
import { createSigner } from "fast-jwt";
import { prisma } from "../src/plugins/prisma.js";
import { env } from "../src/config/env.js";
import { getSessionUserById } from "../src/dao/auth.js";
import { accountQuery, accountPool } from "../src/plugins/account-pool.js";
import { processBatch } from "../src/services/email-send-worker.js";

const CAMPAIGN_HERO: Record<
  string,
  { templateId: string; localMediaId: string; publicUrl?: string }
> = {
  "1394": {
    templateId: "1123572986436446624",
    localMediaId: "41649a98-7e2f-451d-bc39-f55e26d29d5f",
    publicUrl:
      "https://rebuild-campaign-api.worktual.com/api/media/df7615c5-4162-40ba-ad5a-9849d7245dd0",
  },
  "1395": {
    templateId: "404781077931229984",
    localMediaId: "92305b65-5888-4bc4-afc1-ddea19370635",
    publicUrl:
      "https://rebuild-campaign-api.worktual.com/api/media/99dc42e5-c1a9-4295-91cd-fa80ddebb0bf",
  },
};

function campaignIds(): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--campaign" && process.argv[i + 1]) {
      out.push(String(process.argv[i + 1]).trim());
    }
  }
  return out;
}

async function bearerForOrg(orgId: string): Promise<string> {
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT id::text AS id FROM accounts.setup_users
     WHERE organization_id::text = $1 AND lower(work_email) = $2 AND lower(status) = 'active'
     LIMIT 1`,
    [orgId, "yaswanthmg1@gmail.com"],
  );
  let userId = rows[0]?.id?.trim();
  if (!userId) {
    const fallback = await accountQuery<{ id: string }>(
      `SELECT id::text AS id FROM accounts.setup_users
       WHERE organization_id::text = $1 AND lower(status) = 'active' ORDER BY id ASC LIMIT 1`,
      [orgId],
    );
    userId = fallback.rows[0]?.id?.trim();
  }
  if (!userId) throw new Error(`No user for org ${orgId}`);
  const session = await getSessionUserById(userId);
  if (!session) throw new Error(`No session for ${userId}`);
  const sign = createSigner({ key: env.jwtSecret, expiresIn: 60 * 60 * 1000 });
  return sign({
    sub: session.id,
    email: session.email,
    role: session.role,
    organizationId: session.organizationId,
    branchId: session.branchId,
    mode: session.mode,
    industry: session.industry,
  });
}

async function resolvePublicUrl(
  meta: { localMediaId: string; publicUrl?: string },
  token: string,
): Promise<string> {
  if (meta.publicUrl) {
    const check = await fetch(meta.publicUrl);
    if (check.ok) return meta.publicUrl;
  }
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    "npx",
    ["tsx", "scripts/upload-media-rebuild-direct.ts", "--id", meta.localMediaId],
    { stdio: "inherit", cwd: process.cwd() },
  );
  throw new Error("Re-run after upload-media-rebuild-direct (set publicUrl in CAMPAIGN_HERO)");
}

function patchHtmlMedia(html: string, oldId: string, newUrl: string): string {
  let out = html;
  const patterns = [
    new RegExp(`https://rebuild-campaign-api\\.worktual\\.com/api/media/${oldId}`, "gi"),
    new RegExp(`/api/media/${oldId}`, "gi"),
    new RegExp(`http://192\\.168\\.[^/]+:3001/api/media/${oldId}`, "gi"),
  ];
  for (const re of patterns) {
    out = out.replace(re, newUrl);
  }
  return out;
}

async function patchTemplate(
  templateId: bigint,
  oldLocalId: string,
  publicUrl: string,
): Promise<void> {
  const row = await prisma.campaignChannelTemplate.findUnique({
    where: { id: templateId },
  });
  if (!row) throw new Error(`Template ${templateId} missing`);
  const fields = { ...(row.fields as Record<string, unknown>) };
  const htmlKeys = ["compiled_html", "html"] as const;
  for (const key of htmlKeys) {
    const raw = String(fields[key] ?? "").trim();
    if (raw) fields[key] = patchHtmlMedia(raw, oldLocalId, publicUrl);
  }
  for (const key of [
    "header_image",
    "image_url",
    "header_media_url",
    "media_url",
    "image",
  ]) {
    const v = String(fields[key] ?? "").trim();
    if (v.includes(oldLocalId)) fields[key] = publicUrl;
  }
  await prisma.campaignChannelTemplate.update({
    where: { id: templateId },
    data: { fields: fields as object },
  });
}

const log = {
  info: (obj: unknown, msg?: string) =>
    console.log(JSON.stringify({ level: "info", msg, ...(typeof obj === "object" && obj ? obj : {}) })),
  error: (obj: unknown, msg?: string) =>
    console.error(JSON.stringify({ level: "error", msg, ...(typeof obj === "object" && obj ? obj : {}) })),
};

async function resendCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const last = await prisma.campaignSendBatch.findFirst({
    where: { campaignId, channel: "email" },
    orderBy: { seq: "desc" },
  });
  const seq = (last?.seq ?? 0) + 1;
  const prevRec = await prisma.campaignSendRecipient.findFirst({
    where: { campaignId },
    orderBy: { id: "desc" },
  });
  const email =
    prevRec?.email?.trim() ||
    prevRec?.destination?.trim() ||
    "pujithapaleti1234@gmail.com";
  const batch = await prisma.campaignSendBatch.create({
    data: {
      organizationId: campaign.organizationId,
      campaignId,
      seq,
      scheduledFor: new Date(),
      status: "queued_accounts",
      size: 1,
      channel: "email",
      recipients: {
        create: {
          organizationId: campaign.organizationId,
          campaignId,
          contactId: prevRec?.contactId ?? undefined,
          email,
          destination: email,
          status: "pending",
        },
      },
    },
  });
  log.info({ campaignId, batchId: String(batch.id), seq, email }, "processing resend batch");
  await processBatch(String(batch.id), log);
}

async function main() {
  const ids = campaignIds().length ? campaignIds() : Object.keys(CAMPAIGN_HERO);
  const token = await bearerForOrg("1000");

  for (const cid of ids) {
    const meta = CAMPAIGN_HERO[cid];
    if (!meta) {
      console.warn(`Skip unknown campaign ${cid}`);
      continue;
    }
    log.info({ campaignId: cid, localMediaId: meta.localMediaId }, "resolve public hero URL");
    const publicUrl = await resolvePublicUrl(meta, token);
    log.info({ campaignId: cid, publicUrl }, "rebuild media OK");
    await patchTemplate(BigInt(meta.templateId), meta.localMediaId, publicUrl);
    log.info({ campaignId: cid, templateId: meta.templateId }, "template patched");
    await resendCampaign(cid);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    await accountPool.end().catch(() => undefined);
  });

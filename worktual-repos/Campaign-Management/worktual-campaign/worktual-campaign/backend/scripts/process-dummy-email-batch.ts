/**
 * Insert a future-dated queued email batch and process it in THIS process
 * (live worker will not pick it — scheduled_for is 2099).
 *
 *   npx tsx scripts/process-dummy-email-batch.ts --campaign 1334 --to you@example.com
 */
import { prisma } from "../src/plugins/prisma.js";
import { processBatch } from "../src/services/email-send-worker.js";
import { accountPool } from "../src/plugins/account-pool.js";

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  return fallback;
}

const log = {
  info: (obj: unknown, msg?: string) =>
    console.log(JSON.stringify({ level: "info", msg, ...(typeof obj === "object" && obj ? obj : { obj }) })),
  warn: (obj: unknown, msg?: string) =>
    console.warn(JSON.stringify({ level: "warn", msg, ...(typeof obj === "object" && obj ? obj : { obj }) })),
  error: (obj: unknown, msg?: string) =>
    console.error(JSON.stringify({ level: "error", msg, ...(typeof obj === "object" && obj ? obj : { obj }) })),
};

async function main() {
  const campaignId = arg("campaign", "1334");
  const to = arg("to", "aravindhselvaraj6235@gmail.com").toLowerCase();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);

  const last = await prisma.campaignSendBatch.findFirst({
    where: { campaignId, channel: "email" },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  const scheduledFor = new Date("2099-01-01T00:00:00.000Z");

  const batch = await prisma.campaignSendBatch.create({
    data: {
      organizationId: campaign.organizationId,
      campaignId,
      seq,
      scheduledFor,
      status: "queued_accounts",
      size: 1,
      channel: "email",
      recipients: {
        create: {
          organizationId: campaign.organizationId,
          campaignId,
          email: to,
          destination: to,
          status: "pending",
        },
      },
    },
    include: { recipients: true },
  });

  console.log(
    JSON.stringify({
      inserted: true,
      batchId: String(batch.id),
      seq,
      campaignId: String(campaignId),
      to,
      scheduledFor: scheduledFor.toISOString(),
    }),
  );

  await processBatch(String(batch.id), log);

  const after = await prisma.campaignSendBatch.findUnique({
    where: { id: batch.id },
    include: { recipients: true },
  });
  console.log(
    JSON.stringify(
      after,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
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

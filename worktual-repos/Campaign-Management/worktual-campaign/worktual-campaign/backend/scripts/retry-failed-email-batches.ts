/**
 * Reset failed email batches and process them in-process (for QA / recovery).
 *
 *   npx tsx scripts/retry-failed-email-batches.ts --campaign 1394 --campaign 1395
 */
import { prisma } from "../src/plugins/prisma.js";
import { processBatch } from "../src/services/email-send-worker.js";
import { accountPool } from "../src/plugins/account-pool.js";

function campaignIds(): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--campaign" && process.argv[i + 1]) {
      out.push(String(process.argv[i + 1]).trim());
    }
  }
  return out;
}

const log = {
  info: (obj: unknown, msg?: string) =>
    console.log(
      JSON.stringify({
        level: "info",
        msg,
        ...(typeof obj === "object" && obj ? obj : { obj }),
      }),
    ),
  error: (obj: unknown, msg?: string) =>
    console.error(
      JSON.stringify({
        level: "error",
        msg,
        ...(typeof obj === "object" && obj ? obj : { obj }),
      }),
    ),
};

async function main() {
  const ids = campaignIds();
  if (ids.length === 0) {
    throw new Error("Pass --campaign <id> (repeatable)");
  }

  for (const campaignId of ids) {
    const batches = await prisma.campaignSendBatch.findMany({
      where: { campaignId, channel: "email", status: "failed" },
      include: { recipients: true },
      orderBy: { seq: "asc" },
    });
    if (batches.length === 0) {
      console.log(JSON.stringify({ campaignId, note: "no failed email batches" }));
      continue;
    }
    for (const batch of batches) {
      await prisma.campaignSendRecipient.updateMany({
        where: { batchId: batch.id, status: "failed" },
        data: {
          status: "pending",
          attemptCount: 0,
          skipFailReason: null,
        },
      });
      await prisma.campaignSendBatch.update({
        where: { id: batch.id },
        data: { status: "queued_accounts" },
      });
      log.info(
        { campaignId, batchId: String(batch.id) },
        "retrying failed email batch",
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

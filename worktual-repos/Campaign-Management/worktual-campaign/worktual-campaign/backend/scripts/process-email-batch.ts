/**
 * Run email send worker for one batch (recovery / QA).
 *   npx tsx scripts/process-email-batch.ts --batch 1348
 */
import "dotenv/config";
import { prisma } from "../src/plugins/prisma.js";
import { processBatch } from "../src/services/email-send-worker.js";
import { EMAIL_BATCH_QUEUED } from "../src/helpers/email-send-constants.js";
import { accountPool } from "../src/plugins/account-pool.js";

function batchId(): string {
  const i = process.argv.indexOf("--batch");
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  throw new Error("Pass --batch <id>");
}

const log = {
  info: (obj: unknown, msg?: string) =>
    console.log(JSON.stringify({ level: "info", msg, ...(typeof obj === "object" && obj ? obj : {}) })),
  warn: (obj: unknown, msg?: string) =>
    console.warn(JSON.stringify({ level: "warn", msg, ...(typeof obj === "object" && obj ? obj : {}) })),
  error: (obj: unknown, msg?: string) =>
    console.error(JSON.stringify({ level: "error", msg, ...(typeof obj === "object" && obj ? obj : {}) })),
};

async function main() {
  const id = batchId();
  const row = await prisma.campaignSendBatch.findUnique({ where: { id } });
  if (!row) throw new Error(`Batch ${id} not found`);
  if (row.status === "sending") {
    await prisma.campaignSendBatch.update({
      where: { id },
      data: { status: EMAIL_BATCH_QUEUED },
    });
  }
  await processBatch(id, log);
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

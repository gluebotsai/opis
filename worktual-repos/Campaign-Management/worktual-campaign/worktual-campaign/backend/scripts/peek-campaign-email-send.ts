import "dotenv/config";
import { prisma } from "../src/plugins/prisma.js";

const campaignId = process.argv[2];
if (!campaignId) throw new Error("Pass campaign id");

async function main() {
  const batches = await prisma.campaignSendBatch.findMany({
    where: { campaignId, channel: "email" },
    include: { recipients: true },
    orderBy: { seq: "asc" },
  });
  console.log(
    JSON.stringify(
      batches.map((b) => ({
        batchId: String(b.id),
        status: b.status,
        recipients: b.recipients.map((r) => ({
          email: r.email,
          status: r.status,
          skipFailReason: r.skipFailReason,
        })),
      })),
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

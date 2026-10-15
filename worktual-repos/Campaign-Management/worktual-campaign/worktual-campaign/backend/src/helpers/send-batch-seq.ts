// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";

/**
 * Drop replannable batches, then return the next unused seq for this
 * campaign + channel (unique on campaignId+channel+seq).
 */
export async function nextCampaignSendSeq(args: {
  campaignId: string;
  organizationId: string;
  channel: string;
}): Promise<number> {
  await prisma.campaignSendBatch.deleteMany({
    where: {
      campaignId: args.campaignId,
      organizationId: args.organizationId,
      channel: args.channel,
      status: { in: ["queued", "queued_accounts", "failed"] },
    },
  });
  const agg = await prisma.campaignSendBatch.aggregate({
    where: {
      campaignId: args.campaignId,
      organizationId: args.organizationId,
      channel: args.channel,
    },
    _max: { seq: true },
  });
  return (agg._max.seq ?? -1) + 1;
}

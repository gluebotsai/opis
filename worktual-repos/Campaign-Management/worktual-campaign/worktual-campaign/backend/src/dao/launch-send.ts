// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import { readSendPlannedAt } from "../helpers/launch-send-plan.js";

/** Stamp after every selected channel has been planned or skipped. */
export async function markCampaignSendPlannedDao(campaignId: string) {
  const row = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { launchPlan: true },
  });
  if (!row) return;
  const prev =
    row.launchPlan && typeof row.launchPlan === "object"
      ? ({ ...(row.launchPlan as object) } as Record<string, unknown>)
      : {};
  if (readSendPlannedAt(prev)) return;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      launchPlan: {
        ...prev,
        send_planned_at: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
}

// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * Poll Meta approval status for:
 * 1) Campaign launch WhatsApp templates (launchPlan.whatsapp)
 * 2) Template Library regulated WhatsApp templates (pending → approved/rejected)
 */

import { prisma } from "../plugins/prisma.js";
import { env } from "../config/env.js";
import {
  getCampaignWhatsAppMeta,
  refreshCampaignWhatsAppStatus,
} from "../dao/whatsapp-launch.js";
import {
  listPendingRegulatedWhatsAppTemplates,
  refreshRegulatedWhatsAppStatus,
} from "./regulated-whatsapp-status.js";

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export async function pollPendingWhatsAppApprovals(log: Logger) {
  const campaigns = await prisma.campaign.findMany({
    where: {
      status: { in: ["scheduled", "live"] },
      channels: { some: { channel: "whatsapp" } },
    },
    select: {
      id: true,
      name: true,
      launchPlan: true,
    },
    take: 100,
  });

  let checked = 0;
  let approved = 0;

  for (const campaign of campaigns) {
    const meta = getCampaignWhatsAppMeta(campaign.launchPlan);
    if (!meta || meta.status !== "pending") continue;

    try {
      const next = await refreshCampaignWhatsAppStatus(campaign.id, meta);
      checked += 1;
      if (next.status === "approved") {
        approved += 1;
        log.info(
          {
            campaignId: campaign.id,
            campaignName: campaign.name,
            template: next.template_name,
            providerTemplateId: next.provider_template_id,
            approvedAt: next.approved_at,
          },
          "WhatsApp template approved — in-app notification available",
        );
      } else {
        log.info(
          {
            campaignId: campaign.id,
            template: next.template_name,
            status: next.status,
          },
          "WhatsApp template status refreshed",
        );
      }
    } catch (err) {
      log.warn(
        { err, campaignId: campaign.id },
        "WhatsApp status poll failed",
      );
    }
  }

  return { checked, approved };
}

/** Move Template Library Waiting → Approved / Rejected from Meta. */
export async function pollPendingRegulatedWhatsAppApprovals(log: Logger) {
  const rows = await listPendingRegulatedWhatsAppTemplates(80);
  let checked = 0;
  let moved = 0;

  for (const row of rows) {
    try {
      const result = await refreshRegulatedWhatsAppStatus({
        organizationId: row.organizationId,
        templateId: row.id,
        row,
      });
      checked += 1;
      if (result.changed) {
        moved += 1;
        log.info(
          {
            templateId: row.id,
            name: row.name,
            from: result.meta.previousStatus,
            to: result.template.status,
          },
          "Regulated WhatsApp template moved library section",
        );
      }
    } catch (err) {
      log.warn(
        { err, templateId: row.id, name: row.name },
        "Regulated WhatsApp status poll failed",
      );
    }
  }

  return { checked, moved };
}

export function startWhatsAppStatusWorker(log: Logger) {
  const interval = Math.max(60_000, env.social.statusPollIntervalMs);
  log.info(
    { intervalMs: interval },
    "WhatsApp template status worker started (approval-status poll; pending only)",
  );

  const tick = async () => {
    try {
      const campaignResult = await pollPendingWhatsAppApprovals(log);
      if (campaignResult.checked > 0) {
        log.info(campaignResult, "WhatsApp campaign status poll tick");
      }
    } catch (err) {
      log.error({ err }, "WhatsApp campaign status worker tick failed");
    }

    try {
      const libraryResult = await pollPendingRegulatedWhatsAppApprovals(log);
      if (libraryResult.checked > 0) {
        log.info(libraryResult, "WhatsApp library status poll tick");
      }
    } catch (err) {
      log.error({ err }, "WhatsApp library status worker tick failed");
    }
  };

  void tick();
  return setInterval(() => void tick(), interval);
}

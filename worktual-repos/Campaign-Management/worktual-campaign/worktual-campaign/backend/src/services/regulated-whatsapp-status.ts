// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * Refresh Meta approval status for a regulated WhatsApp library template.
 * Shared by HTTP refresh handler and the status poll worker.
 */

import type { RegulatedChannelTemplate } from "@prisma/client";
import { AppError } from "../helpers/response-builders.js";
import {
  applyMetaStatusDao,
  getRegulatedTemplateDao,
  publicRegulatedTemplate,
} from "../dao/regulated-template.js";
import { resolveWhatsAppChannelConfigId } from "../dao/whatsapp-channel-config.js";
import {
  mapMetaStatusToLocal,
  socialGetTemplateApprovalStatus,
} from "./social-whatsapp.js";
import { prisma } from "../plugins/prisma.js";

export async function refreshRegulatedWhatsAppStatus(args: {
  organizationId: string;
  templateId: string;
  /** Preloaded row — skips re-fetch when polling. */
  row?: RegulatedChannelTemplate;
}): Promise<{
  template: ReturnType<typeof publicRegulatedTemplate>;
  meta: { found: boolean; status?: string; previousStatus?: string };
  changed: boolean;
}> {
  const row =
    args.row ||
    (await getRegulatedTemplateDao(args.organizationId, args.templateId));

  if (row.channel !== "whatsapp") {
    throw new AppError("Only WhatsApp templates sync status from Meta.", 400);
  }
  if (row.status === "draft") {
    throw new AppError("Submit the template for approval first.", 400);
  }

  const previousStatus = row.status;
  const channelConfigId =
    row.channelConfigId ||
    (await resolveWhatsAppChannelConfigId(args.organizationId));

  const result = await socialGetTemplateApprovalStatus({
    channelConfigId,
    templateId: row.providerTemplateId || undefined,
    templateName: row.providerTemplateId ? undefined : row.name,
    language: row.language || undefined,
  });

  const match =
    (result.templates || []).find(
      (t) =>
        (row.providerTemplateId && t.id === row.providerTemplateId) ||
        t.name === row.name,
    ) || result.templates?.[0];

  if (!match) {
    // Still bump last checked so UI / workers know we polled.
    await prisma.regulatedChannelTemplate.update({
      where: { id: row.id },
      data: { lastStatusCheckedAt: new Date() },
    });
    const latest = await getRegulatedTemplateDao(args.organizationId, row.id);
    return {
      template: publicRegulatedTemplate(latest),
      meta: { found: false, previousStatus },
      changed: false,
    };
  }

  const nextStatus = mapMetaStatusToLocal(match.status);
  const updated = await applyMetaStatusDao(row.id, {
    status: nextStatus,
    providerTemplateId: match.id || row.providerTemplateId,
    rejectedReason: match.rejectedReason || null,
    category: match.category || row.category,
  });

  const changed = previousStatus !== nextStatus;
  if (
    changed &&
    (nextStatus === "approved" || nextStatus === "rejected")
  ) {
    try {
      const { notifyRegulatedWhatsAppDecision } = await import(
        "./app-notifications.js"
      );
      await notifyRegulatedWhatsAppDecision({
        organizationId: String(row.organizationId),
        userId: row.createdByUserId ? String(row.createdByUserId) : null,
        templateId: String(row.id),
        templateName: row.name,
        status: nextStatus,
        rejectedReason: match.rejectedReason || updated.rejectedReason,
      });
    } catch {
      /* never block status sync on notifications */
    }
  }

  return {
    template: publicRegulatedTemplate(updated),
    meta: {
      found: true,
      status: match.status,
      previousStatus,
    },
    changed,
  };
}

/** Pending WhatsApp library templates across tenants (worker). */
export async function listPendingRegulatedWhatsAppTemplates(take = 100) {
  return prisma.regulatedChannelTemplate.findMany({
    where: {
      channel: "whatsapp",
      status: "pending",
    },
    orderBy: { updatedAt: "asc" },
    take,
  });
}

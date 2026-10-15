/**
 * Sync Meta WhatsApp catalog → Template Library (Pending / Approved / Rejected).
 */

import { upsertRegulatedWhatsAppFromCampaignDao } from "../dao/regulated-template.js";
import { resolveWhatsAppChannelConfigId } from "../dao/whatsapp-channel-config.js";
import {
  mapMetaStatusToLocal,
  metaComponentsToFields,
  socialListWhatsAppTemplates,
  type MetaWhatsAppTemplateRow,
} from "./social-whatsapp.js";

export type SyncMetaWhatsAppResult = {
  channelConfigId: string;
  fetched: number;
  upserted: number;
  skipped: number;
  byStatus: {
    pending: number;
    approved: number;
    rejected: number;
    other: number;
  };
};

function rejectReason(row: MetaWhatsAppTemplateRow): string | null {
  const raw = row.rejectedReason;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.toUpperCase() === "NONE") return null;
  return s;
}

export async function syncMetaWhatsAppTemplatesToLibrary(args: {
  organizationId: string;
  userId?: string | null;
}): Promise<SyncMetaWhatsAppResult> {
  const channelConfigId = await resolveWhatsAppChannelConfigId(args.organizationId);
  const listed = await socialListWhatsAppTemplates({
    channelConfigId,
    returnTemplate: true,
  });
  const templates = Array.isArray(listed.templates) ? listed.templates : [];

  const byStatus = {
    pending: 0,
    approved: 0,
    rejected: 0,
    other: 0,
  };
  let upserted = 0;
  let skipped = 0;

  for (const row of templates) {
    const name = String(row.name || "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const localStatus = mapMetaStatusToLocal(row.status);
    if (
      localStatus !== "pending" &&
      localStatus !== "approved" &&
      localStatus !== "rejected"
    ) {
      byStatus.other += 1;
      skipped += 1;
      continue;
    }
    byStatus[localStatus] += 1;

    const fields = metaComponentsToFields(row.components);
    const body =
      fields.body ||
      fields.header ||
      `(Meta template “${name}” — open to view details)`;

    await upsertRegulatedWhatsAppFromCampaignDao({
      organizationId: args.organizationId,
      userId: args.userId,
      name,
      language: row.language || "en",
      category: row.category || "UTILITY",
      header: fields.header,
      body,
      footer: fields.footer,
      buttons: fields.buttons,
      status: localStatus,
      providerTemplateId: row.id ? String(row.id) : null,
      channelConfigId,
      rejectedReason: rejectReason(row),
      submittedAt: new Date().toISOString(),
    });
    upserted += 1;
  }

  return {
    channelConfigId,
    fetched: templates.length,
    upserted,
    skipped,
    byStatus,
  };
}

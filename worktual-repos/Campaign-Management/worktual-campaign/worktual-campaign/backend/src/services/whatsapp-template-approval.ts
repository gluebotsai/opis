// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * Submit an agent-generated WhatsApp CampaignChannelTemplate to Meta
 * via social-service, and persist approval metadata on template.fields.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import { AppError } from "../helpers/response-builders.js";
import {
  buildSubmitComponentsFromAgentFields,
  metaNameFromTemplateId,
  sanitizeWhatsAppTemplateName,
} from "../helpers/whatsapp-template-map.js";
import { resolveWhatsAppChannelConfigId } from "../dao/whatsapp-channel-config.js";
import {
  mapMetaStatusToLocal,
  socialSubmitTemplateApproval,
} from "./social-whatsapp.js";

export type WhatsAppFieldApproval = {
  submitted: boolean;
  status: string;
  provider_template_id: string | null;
  submitted_at: string | null;
  error: string | null;
  message: string;
};

function approvalMessage(args: {
  submitted: boolean;
  name: string;
  status?: string;
  error?: string | null;
}): string {
  if (args.submitted) {
    return `WhatsApp template "${args.name}" was sent for Meta approval (status: ${args.status || "PENDING"}).`;
  }
  return `WhatsApp template "${args.name}" was not sent for approval: ${args.error || "unknown reason"}.`;
}

export function readApprovalFromFields(
  fields: Record<string, unknown>,
): WhatsAppFieldApproval | null {
  const raw = fields.approval;
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return {
    submitted: Boolean(a.submitted),
    status: String(a.status || ""),
    provider_template_id: a.provider_template_id
      ? String(a.provider_template_id)
      : null,
    submitted_at: a.submitted_at ? String(a.submitted_at) : null,
    error: a.error != null ? String(a.error) : null,
    message: String(a.message || ""),
  };
}

export function resolveAgentWhatsAppTemplateName(
  fields: Record<string, unknown>,
  templateId: string,
): string {
  const fromAgent = sanitizeWhatsAppTemplateName(String(fields.name || ""));
  if (fromAgent && fromAgent !== "wa_template") return fromAgent;
  return metaNameFromTemplateId(templateId);
}

/**
 * Submit WhatsApp template for Meta approval and merge `approval` (+ sanitized name)
 * into the stored fields. Never throws — failures are recorded on fields.approval.
 */
export async function submitAgentWhatsAppTemplateApproval(args: {
  organizationId: string;
  templateId: string;
  fields: Record<string, unknown>;
}): Promise<{
  fields: Record<string, unknown>;
  approval: WhatsAppFieldApproval;
}> {
  const baseFields = { ...args.fields };
  const name = resolveAgentWhatsAppTemplateName(baseFields, args.templateId);
  baseFields.name = name;

  if (!String(baseFields.body || "").trim()) {
    const approval: WhatsAppFieldApproval = {
      submitted: false,
      status: "draft",
      provider_template_id: null,
      submitted_at: null,
      error: "Template body is empty",
      message: approvalMessage({
        submitted: false,
        name,
        error: "Template body is empty",
      }),
    };
    return { fields: { ...baseFields, approval }, approval };
  }

  let channelConfigId: string;
  try {
    channelConfigId = await resolveWhatsAppChannelConfigId(args.organizationId);
  } catch (err) {
    const error =
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "WhatsApp channel is not configured";
    const approval: WhatsAppFieldApproval = {
      submitted: false,
      status: "draft",
      provider_template_id: null,
      submitted_at: null,
      error,
      message: approvalMessage({ submitted: false, name, error }),
    };
    return { fields: { ...baseFields, approval }, approval };
  }

  let mapped;
  try {
    mapped = buildSubmitComponentsFromAgentFields(baseFields);
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Invalid WhatsApp template fields";
    const approval: WhatsAppFieldApproval = {
      submitted: false,
      status: "draft",
      provider_template_id: null,
      submitted_at: null,
      error,
      message: approvalMessage({ submitted: false, name, error }),
    };
    return { fields: { ...baseFields, approval }, approval };
  }

  try {
    const result = await socialSubmitTemplateApproval({
      channelConfigId,
      name,
      language: mapped.language,
      category: mapped.category,
      allowCategoryChange: false,
      components: mapped.components,
    });

    const status = mapMetaStatusToLocal(result.status);
    const approval: WhatsAppFieldApproval = {
      submitted: true,
      status,
      provider_template_id: result.templateId || null,
      submitted_at: new Date().toISOString(),
      error: null,
      message: approvalMessage({
        submitted: true,
        name: result.templateName || name,
        status: result.status || status.toUpperCase(),
      }),
    };

    const fields = {
      ...baseFields,
      name: result.templateName || name,
      language: mapped.language,
      category: mapped.category,
      components: mapped.components,
      body_placeholders: mapped.bodyPlaceholders,
      approval,
    };

    await prisma.campaignChannelTemplate.update({
      where: { id: args.templateId },
      data: { fields: fields as Prisma.InputJsonValue },
    });

    return { fields, approval };
  } catch (err) {
    const error =
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to submit template to Meta";
    const approval: WhatsAppFieldApproval = {
      submitted: false,
      status: "draft",
      provider_template_id: null,
      submitted_at: null,
      error,
      message: approvalMessage({ submitted: false, name, error }),
    };
    const fields = { ...baseFields, approval };
    try {
      await prisma.campaignChannelTemplate.update({
        where: { id: args.templateId },
        data: { fields: fields as Prisma.InputJsonValue },
      });
    } catch {
      // keep returning approval even if persist of error fails
    }
    return { fields, approval };
  }
}

export function humanApprovalLine(approval: WhatsAppFieldApproval): string {
  return approval.message;
}

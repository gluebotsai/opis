// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * WA/SMS template compliance — rejected, paused/disabled, near-expiry, stuck pending.
 */

import { prisma } from "../plugins/prisma.js";
import { getCampaignWhatsAppMeta } from "./whatsapp-launch.js";

const PENDING_STUCK_MS = 7 * 24 * 60 * 60 * 1000;
const SMS_IMPLICIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const NEAR_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;
const WA_STALE_CHECK_MS = 21 * 24 * 60 * 60 * 1000;

export type TemplateComplianceIssue = {
  kind: "template_rejected" | "template_expiring" | "template_paused";
  sourceKey: string;
  organizationId: string;
  userId: string | null;
  title: string;
  body: string;
  href: string;
  channel: "whatsapp" | "sms";
  templateId?: string;
  campaignId?: string;
};

function hrefForRegulated(
  channel: string,
  status: string,
  id: string,
): string {
  if (channel === "whatsapp" && status === "rejected") {
    return `/campaigns/create/whatsapp/rejected/${id}`;
  }
  if (channel === "whatsapp") {
    return `/campaigns/create/whatsapp/approved/${id}`;
  }
  return "/campaigns/create/templates";
}

export async function listTemplateComplianceIssuesDao(): Promise<
  TemplateComplianceIssue[]
> {
  const now = Date.now();
  const rows = await prisma.regulatedChannelTemplate.findMany({
    where: {
      channel: { in: ["whatsapp", "sms"] },
      status: { in: ["rejected", "paused", "disabled", "pending", "approved"] },
    },
    select: {
      id: true,
      organizationId: true,
      createdByUserId: true,
      channel: true,
      name: true,
      status: true,
      rejectedReason: true,
      submittedAt: true,
      lastStatusCheckedAt: true,
      createdAt: true,
      updatedAt: true,
      sourceCampaignId: true,
    },
    take: 400,
  });

  const issues: TemplateComplianceIssue[] = [];

  for (const row of rows) {
    const channel = row.channel === "sms" ? "sms" : "whatsapp";
    const name = row.name?.trim() || "Template";
    const label = channel === "sms" ? "SMS" : "WhatsApp";
    const userId = row.createdByUserId;
    const href = hrefForRegulated(channel, row.status, row.id);

    if (row.status === "rejected") {
      const reason = (row.rejectedReason || "").trim();
      issues.push({
        kind: "template_rejected",
        sourceKey: `template:rejected:${row.id}`,
        organizationId: row.organizationId,
        userId,
        title: `${label} template rejected`,
        body: reason
          ? `"${name}" was rejected: ${reason}`
          : `"${name}" was rejected. Open the rejected agent to fix and resubmit.`,
        href,
        channel,
        templateId: row.id,
      });
      continue;
    }

    if (row.status === "paused" || row.status === "disabled") {
      issues.push({
        kind: "template_paused",
        sourceKey: `template:paused:${row.id}:${row.status}`,
        organizationId: row.organizationId,
        userId,
        title: `${label} template ${row.status}`,
        body: `"${name}" is ${row.status}. Refresh status or resubmit before sending.`,
        href,
        channel,
        templateId: row.id,
      });
      continue;
    }

    if (row.status === "pending") {
      const submitted = (row.submittedAt || row.createdAt).getTime();
      if (now - submitted >= PENDING_STUCK_MS) {
        issues.push({
          kind: "template_expiring",
          sourceKey: `template:pending-stuck:${row.id}`,
          organizationId: row.organizationId,
          userId,
          title: `${label} approval still pending`,
          body: `"${name}" has been pending for 7+ days. Check Template Approvals.`,
          href: channel === "whatsapp"
            ? `/campaigns/create/templates`
            : "/campaigns/create/templates",
          channel,
          templateId: row.id,
        });
      }
      continue;
    }

    // approved
    if (channel === "sms") {
      const start = (row.submittedAt || row.createdAt).getTime();
      const expiresAt = start + SMS_IMPLICIT_TTL_MS;
      const remaining = expiresAt - now;
      if (remaining <= 0) {
        issues.push({
          kind: "template_expiring",
          sourceKey: `template:expired:${row.id}`,
          organizationId: row.organizationId,
          userId,
          title: "SMS DLT template may have expired",
          body: `"${name}" is past the typical 12-month DLT window. Re-register if still in use.`,
          href,
          channel,
          templateId: row.id,
        });
      } else if (remaining <= NEAR_EXPIRY_MS) {
        issues.push({
          kind: "template_expiring",
          sourceKey: `template:expiring:${row.id}`,
          organizationId: row.organizationId,
          userId,
          title: "SMS DLT template near expiry",
          body: `"${name}" is within ~14 days of the typical 12-month DLT window.`,
          href,
          channel,
          templateId: row.id,
        });
      }
      continue;
    }

    const staleFrom =
      row.lastStatusCheckedAt?.getTime() ?? row.updatedAt.getTime();
    if (now - staleFrom >= WA_STALE_CHECK_MS) {
      issues.push({
        kind: "template_expiring",
        sourceKey: `template:stale:${row.id}`,
        organizationId: row.organizationId,
        userId,
        title: "WhatsApp template status may be stale",
        body: `"${name}" has not been re-checked in 21+ days. Meta can pause unused templates — refresh status.`,
        href,
        channel,
        templateId: row.id,
      });
    }
  }

  const campaigns = await prisma.campaign.findMany({
    where: {
      status: { in: ["draft", "scheduled", "live"] },
      channels: { some: { channel: "whatsapp" } },
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
      createdByUserId: true,
      launchPlan: true,
    },
    take: 200,
  });

  for (const c of campaigns) {
    const meta = getCampaignWhatsAppMeta(c.launchPlan);
    if (!meta) continue;
    const camp = c.name?.trim() || "Campaign";
    if (meta.status === "rejected") {
      const reason = (meta.rejected_reason || "").trim();
      issues.push({
        kind: "template_rejected",
        sourceKey: `campaign-wa:rejected:${c.id}`,
        organizationId: c.organizationId,
        userId: c.createdByUserId,
        title: "Campaign WhatsApp template rejected",
        body: reason
          ? `"${meta.template_name}" for "${camp}" was rejected: ${reason}`
          : `"${meta.template_name}" for "${camp}" was rejected by Meta.`,
        href: `/campaigns/${c.id}`,
        channel: "whatsapp",
        campaignId: c.id,
      });
    } else if (meta.status === "paused" || meta.status === "disabled") {
      issues.push({
        kind: "template_paused",
        sourceKey: `campaign-wa:${meta.status}:${c.id}`,
        organizationId: c.organizationId,
        userId: c.createdByUserId,
        title: `Campaign WhatsApp template ${meta.status}`,
        body: `"${meta.template_name}" for "${camp}" is ${meta.status}. Fix before send.`,
        href: `/campaigns/${c.id}`,
        channel: "whatsapp",
        campaignId: c.id,
      });
    }
  }

  return issues;
}

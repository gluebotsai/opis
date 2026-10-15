// @ts-nocheck
/**
 * Live send pipeline status — batches + recipient counts for real-time ops.
 */
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import {
  campaignTenantWhere,
  resolveCampaignDataScope,
  scopeAppliedLabel,
} from "../helpers/campaign-visibility.js";
import { toAgentChannel } from "../helpers/channel-ids.js";
import { EMAIL_BATCH_QUEUED } from "../helpers/email-send-constants.js";

/** Pure helper — group Prisma groupBy rows into pending/sent/failed/skipped totals. */
export function countByStatus(
  rows: Array<{ status: string; _count: { _all: number } }>,
): Record<string, number> {
  const out: Record<string, number> = {
    pending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of rows) {
    const st = String(row.status || "").toLowerCase();
    const n = row._count?._all ?? 0;
    if (st in out) out[st] = n;
    else out[st] = n;
  }
  return out;
}

export async function getCampaignLiveStatusDao(
  session: CampaignSessionUser,
  campaignId: string,
): Promise<Record<string, unknown>> {
  const camp = await prisma.campaign.findFirst({
    where: { id: campaignId, ...campaignTenantWhere(session) },
    select: {
      id: true,
      name: true,
      status: true,
      organizationId: true,
    },
  });
  if (!camp) {
    throw new AppError("Campaign not found.", 404);
  }

  const batches = await prisma.campaignSendBatch.findMany({
    where: {
      campaignId,
      organizationId: session.organizationId,
    },
    orderBy: [{ channel: "asc" }, { seq: "asc" }],
  });

  const batchIds = batches.map((b) => b.id);
  const recipientGroups =
    batchIds.length > 0
      ? await prisma.campaignSendRecipient.groupBy({
          by: ["batchId", "status"],
          where: { batchId: { in: batchIds } },
          _count: { _all: true },
        })
      : [];

  const countsByBatch = new Map<string, Record<string, number>>();
  for (const row of recipientGroups) {
    const bid = String(row.batchId);
    const prev = countsByBatch.get(bid) || {
      pending: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
    const st = String(row.status || "").toLowerCase();
    const n = row._count?._all ?? 0;
    if (st === "pending") prev.pending += n;
    else if (st === "sent") prev.sent += n;
    else if (st === "failed") prev.failed += n;
    else if (st === "skipped") prev.skipped += n;
    else prev[st] = (prev[st] || 0) + n;
    countsByBatch.set(bid, prev);
  }

  const byChannel = new Map<
    string,
    {
      channel: string;
      batches: Array<Record<string, unknown>>;
      recipients: Record<string, number>;
    }
  >();

  let queuedBatches = 0;
  let sendingBatches = 0;

  for (const batch of batches) {
    const ch = toAgentChannel(batch.channel) || batch.channel;
    const st = String(batch.status || "").toLowerCase();
    if (st === "queued" || st === EMAIL_BATCH_QUEUED) queuedBatches += 1;
    if (st === "sending") sendingBatches += 1;

    const rc = countsByBatch.get(String(batch.id)) || {
      pending: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
    const entry = byChannel.get(ch) || {
      channel: ch,
      batches: [],
      recipients: { pending: 0, sent: 0, failed: 0, skipped: 0 },
    };
    entry.batches.push({
      batch_id: String(batch.id),
      seq: batch.seq,
      status: st === EMAIL_BATCH_QUEUED ? "queued" : batch.status,
      scheduled_for: batch.scheduledFor?.toISOString?.() ?? batch.scheduledFor,
      size: batch.size,
      recipients: rc,
    });
    for (const k of ["pending", "sent", "failed", "skipped"] as const) {
      entry.recipients[k] += rc[k] || 0;
    }
    byChannel.set(ch, entry);
  }

  const scope = resolveCampaignDataScope(session);
  return {
    as_of: new Date().toISOString(),
    campaign_id: String(camp.id),
    campaign_name: camp.name,
    campaign_status: camp.status,
    queued_batches: queuedBatches,
    sending_batches: sendingBatches,
    channels: [...byChannel.values()],
    scope_applied: scope,
    scope_label: scopeAppliedLabel(scope),
  };
}

export async function listRecentSendFailuresDao(
  session: CampaignSessionUser,
  opts: {
    campaignId?: string | null;
    channel?: string | null;
    limit?: number;
  },
): Promise<Record<string, unknown>> {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50);
  const tenant = campaignTenantWhere(session);

  const where: Record<string, unknown> = {
    organizationId: session.organizationId,
    OR: [
      { status: "failed" },
      { skipFailReason: { not: null } },
    ],
  };

  if (opts.campaignId) {
    const camp = await prisma.campaign.findFirst({
      where: { id: opts.campaignId, ...tenant },
      select: { id: true },
    });
    if (!camp) {
      throw new AppError("Campaign not found.", 404);
    }
    where.campaignId = opts.campaignId;
  } else {
    const allowed = await prisma.campaign.findMany({
      where: tenant,
      select: { id: true },
    });
    const ids = allowed.map((c) => c.id);
    if (!ids.length) {
      return {
        as_of: new Date().toISOString(),
        failures: [],
        count: 0,
        scope_applied: resolveCampaignDataScope(session),
        scope_label: scopeAppliedLabel(resolveCampaignDataScope(session)),
      };
    }
    where.campaignId = { in: ids };
  }

  if (opts.channel) {
    const ch = toAgentChannel(opts.channel) || String(opts.channel).trim();
    const batchIds = await prisma.campaignSendBatch.findMany({
      where: {
        organizationId: session.organizationId,
        channel: ch,
        ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
      },
      select: { id: true },
    });
    where.batchId = { in: batchIds.map((b) => b.id) };
  }

  const rows = await prisma.campaignSendRecipient.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      campaignId: true,
      batchId: true,
      status: true,
      skipFailReason: true,
      email: true,
      destination: true,
      platform: true,
      attemptCount: true,
      updatedAt: true,
      batch: { select: { channel: true, status: true } },
    },
  });

  const scope = resolveCampaignDataScope(session);
  return {
    as_of: new Date().toISOString(),
    count: rows.length,
    failures: rows.map((r) => ({
      recipient_id: String(r.id),
      campaign_id: String(r.campaignId),
      batch_id: String(r.batchId),
      channel: toAgentChannel(r.batch?.channel || "") || r.batch?.channel,
      batch_status:
        String(r.batch?.status || "") === EMAIL_BATCH_QUEUED
          ? "queued"
          : r.batch?.status,
      status: r.status,
      skip_fail_reason: r.skipFailReason,
      email: r.email,
      destination: r.destination
        ? String(r.destination).slice(0, 120)
        : null,
      platform: r.platform,
      attempt_count: r.attemptCount,
      updated_at: r.updatedAt?.toISOString?.() ?? r.updatedAt,
    })),
    scope_applied: scope,
    scope_label: scopeAppliedLabel(scope),
  };
}

export async function listActiveLiveSendsDao(
  session: CampaignSessionUser,
  limit = 10,
): Promise<Record<string, unknown>> {
  const tenant = campaignTenantWhere(session);
  const cap = Math.min(Math.max(limit, 1), 20);

  const batches = await prisma.campaignSendBatch.findMany({
    where: {
      organizationId: session.organizationId,
      status: { in: ["queued", EMAIL_BATCH_QUEUED, "sending"] },
      campaign: { is: tenant },
    },
    orderBy: { scheduledFor: "asc" },
    take: cap * 3,
    include: {
      campaign: { select: { id: true, name: true, status: true } },
    },
  });

  const seen = new Set<string>();
  const active: Array<Record<string, unknown>> = [];

  for (const batch of batches) {
    const cid = String(batch.campaignId);
    if (seen.has(cid)) continue;
    seen.add(cid);
    const pending = await prisma.campaignSendRecipient.count({
      where: { batchId: batch.id, status: "pending" },
    });
    const sent = await prisma.campaignSendRecipient.count({
      where: { batchId: batch.id, status: "sent" },
    });
    const failed = await prisma.campaignSendRecipient.count({
      where: { batchId: batch.id, status: "failed" },
    });
    active.push({
      campaign_id: cid,
      campaign_name: batch.campaign?.name,
      campaign_status: batch.campaign?.status,
      channel: toAgentChannel(batch.channel) || batch.channel,
      batch_id: String(batch.id),
      batch_status:
        batch.status === EMAIL_BATCH_QUEUED ? "queued" : batch.status,
      scheduled_for: batch.scheduledFor?.toISOString?.() ?? batch.scheduledFor,
      pending,
      sent,
      failed,
    });
    if (active.length >= cap) break;
  }

  return {
    as_of: new Date().toISOString(),
    active_sends: active,
    scope_applied: resolveCampaignDataScope(session),
    scope_label: scopeAppliedLabel(resolveCampaignDataScope(session)),
  };
}

// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { toAgentChannel } from "../helpers/channel-ids.js";
import { recipientDeliveryOutcome } from "../helpers/send-status.js";
import { listContactSummariesByIdsDao } from "./contact.js";

export type RecipientOutcome =
  | "sent"
  | "stub"
  | "failed"
  | "skipped"
  | "pending"
  | "not_sent";

export type CampaignRecipientChannelRow = {
  channel: string;
  outcome: RecipientOutcome;
  status: string;
  skip_fail_reason: string | null;
  provider_message_id: string | null;
  stub: boolean;
  opened: boolean;
  clicked: boolean;
  destination: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
};

export type CampaignRecipientRow = {
  contact_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  selected: boolean;
  outcome: RecipientOutcome;
  channels: CampaignRecipientChannelRow[];
};

export type CampaignRecipientsReport = {
  campaign_id: string;
  name: string;
  audience_count: number;
  audience_summary: string | null;
  totals: {
    selected: number;
    sent: number;
    stub: number;
    failed: number;
    skipped: number;
    pending: number;
    not_sent: number;
    opened: number;
    clicked: number;
  };
  recipients: CampaignRecipientRow[];
  note: string;
};

function rollupOutcome(
  channels: CampaignRecipientChannelRow[],
): RecipientOutcome {
  if (!channels.length) return "not_sent";
  if (channels.some((c) => c.outcome === "failed")) return "failed";
  if (channels.some((c) => c.outcome === "skipped")) return "skipped";
  if (channels.some((c) => c.outcome === "stub")) return "stub";
  if (channels.some((c) => c.outcome === "sent")) return "sent";
  if (channels.some((c) => c.outcome === "pending")) return "pending";
  return "not_sent";
}

export async function getCampaignRecipientsDao(
  session: CampaignSessionUser,
  campaignId: string,
  opts?: { channel?: string | null; limit?: number },
): Promise<CampaignRecipientsReport> {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
    select: {
      id: true,
      name: true,
      audienceCount: true,
      audienceSummary: true,
    },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const channelFilter = opts?.channel
    ? toAgentChannel(opts.channel) || opts.channel.trim().toLowerCase()
    : null;
  const limit = Math.max(1, Math.min(opts?.limit ?? 200, 500));

  const [audience, sendRows] = await Promise.all([
    prisma.campaignAudience.findMany({
      where: { campaignId: campaign.id },
      select: { contactId: true },
    }),
    prisma.campaignSendRecipient.findMany({
      where: { campaignId: campaign.id, organizationId: session.organizationId },
      include: { batch: { select: { channel: true, scheduledFor: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const selectedIds = audience.map((a) => a.contactId);
  const extraIds = sendRows
    .map((r) => r.contactId)
    .filter(
      (id): id is string =>
        typeof id === "string" && id.length > 0 && !selectedIds.includes(id),
    );
  const allIds = [...selectedIds, ...extraIds];
  const profiles = await listContactSummariesByIdsDao(session, allIds);
  const profileById = new Map(profiles.map((p) => [p.contactId, p]));

  const channelRowsByContact = new Map<string, CampaignRecipientChannelRow[]>();
  const orphanRows: CampaignRecipientRow[] = [];

  for (const row of sendRows) {
    const channel = toAgentChannel(row.batch?.channel || "") || row.batch?.channel || "email";
    if (channelFilter && channel !== channelFilter) continue;
    const outcome = recipientDeliveryOutcome({
      status: row.status,
      providerMessageId: row.providerMessageId,
    });
    const chRow: CampaignRecipientChannelRow = {
      channel,
      outcome,
      status: row.status,
      skip_fail_reason: row.skipFailReason,
      provider_message_id: row.providerMessageId,
      stub: outcome === "stub",
      opened: Boolean(row.openedAt),
      clicked: Boolean(row.clickedAt),
      destination: row.email || row.destination || null,
      scheduled_for: row.batch?.scheduledFor
        ? new Date(row.batch.scheduledFor).toISOString()
        : null,
      sent_at:
        outcome === "sent" || outcome === "stub"
          ? row.updatedAt
            ? new Date(row.updatedAt).toISOString()
            : null
          : null,
      opened_at: row.openedAt ? new Date(row.openedAt).toISOString() : null,
      clicked_at: row.clickedAt ? new Date(row.clickedAt).toISOString() : null,
    };
    const cid = row.contactId;
    if (!cid) {
      orphanRows.push({
        contact_id: null,
        name: row.email || row.destination || "Unknown",
        email: row.email,
        phone: null,
        company: null,
        selected: false,
        outcome,
        channels: [chRow],
      });
      continue;
    }
    const list = channelRowsByContact.get(cid) || [];
    list.push(chRow);
    channelRowsByContact.set(cid, list);
  }

  const recipients: CampaignRecipientRow[] = [];

  for (const contactId of selectedIds) {
    const profile = profileById.get(contactId);
    let channels = channelRowsByContact.get(contactId) || [];
    if (channelFilter) {
      channels = channels.filter((c) => c.channel === channelFilter);
    }
    if (!channels.length) {
      channels = channelFilter
        ? [
            {
              channel: channelFilter,
              outcome: "not_sent",
              status: "not_sent",
              skip_fail_reason: "not_in_send_batch",
              provider_message_id: null,
              stub: false,
              opened: false,
              clicked: false,
              destination: profile?.email || null,
              scheduled_for: null,
              sent_at: null,
              opened_at: null,
              clicked_at: null,
            },
          ]
        : [];
    }
    recipients.push({
      contact_id: contactId,
      name: profile?.name || "Unknown",
      email: profile?.email || channels[0]?.destination || null,
      phone: profile?.phone || null,
      company: profile?.company || null,
      selected: true,
      outcome: rollupOutcome(channels),
      channels,
    });
  }

  for (const contactId of extraIds) {
    const profile = profileById.get(contactId);
    let channels = channelRowsByContact.get(contactId) || [];
    if (channelFilter) {
      channels = channels.filter((c) => c.channel === channelFilter);
    }
    if (!channels.length) continue;
    recipients.push({
      contact_id: contactId,
      name: profile?.name || "Unknown",
      email: profile?.email || channels[0]?.destination || null,
      phone: profile?.phone || null,
      company: profile?.company || null,
      selected: false,
      outcome: rollupOutcome(channels),
      channels,
    });
  }

  recipients.push(...orphanRows);

  const totals = {
    selected: selectedIds.length,
    sent: 0,
    stub: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    not_sent: 0,
    opened: 0,
    clicked: 0,
  };
  for (const r of recipients) {
    if (r.outcome === "sent") totals.sent += 1;
    else if (r.outcome === "stub") totals.stub += 1;
    else if (r.outcome === "failed") totals.failed += 1;
    else if (r.outcome === "skipped") totals.skipped += 1;
    else if (r.outcome === "pending") totals.pending += 1;
    else totals.not_sent += 1;
    if (r.channels.some((c) => c.opened)) totals.opened += 1;
    if (r.channels.some((c) => c.clicked)) totals.clicked += 1;
  }

  return {
    campaign_id: campaign.id,
    name: campaign.name,
    audience_count: campaign.audienceCount,
    audience_summary: campaign.audienceSummary,
    totals,
    recipients: recipients.slice(0, limit),
    note:
      totals.stub > 0
        ? "stub means the worker recorded a local stub id — the contact did not receive a live ESP send."
        : "outcome sent = live provider accept; failed/skipped/pending/not_sent = missed or not run.",
  };
}

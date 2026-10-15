import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { SQL_CONVERSATION_ALIAS_TO_CDP_CONTACT } from "../lib/sql-uuid.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";
import { isCallChannel } from "../lib/channels.js";
import { listContactInteractions } from "./contact-interactions.js";

const CALL_DIALOGUE_LIMIT = 2000;

export function formatCallDialogue(
  lines: Array<{ senderType: string; body: string }>,
): string {
  const parts: string[] = [];
  let used = 0;
  for (const line of lines) {
    const body = line.body.replace(/\s+/g, " ").trim();
    if (!body) continue;
    const label =
      line.senderType === "bot" ? "Bot" : line.senderType === "agent" ? "Agent" : "Customer";
    const row = `${label}: ${body}`;
    if (parts.length > 0 && used + row.length + 1 > CALL_DIALOGUE_LIMIT) break;
    parts.push(row);
    used += row.length + 1;
  }
  return parts.join("\n");
}

const NLP_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

export type ContactChannelSummary = {
  channel: string;
  conversationId: string;
  summary: string;
  occurredAt: string;
  sentiment: {
    customerLabel: string;
    customerRationale: string | null;
    summary: string | null;
  } | null;
};

export const upsertOmniChannelSummarySchema = z.object({
  omniChannelSummary: z.string().trim().min(1).max(2000),
});

export async function listContactChannelSummaries(
  db: DbClient,
  organizationId: string,
  contactId: string,
  limit = 50,
): Promise<ContactChannelSummary[]> {
  const page = await listContactInteractions(db, organizationId, contactId, {
    limit,
    offset: 0,
  });
  const callIds = page.interactions
    .filter(
      (interaction) =>
        isCallChannel(interaction.channel) && !interaction.botMemory?.rollingSummary?.trim(),
    )
    .map((interaction) => interaction.conversationId);
  const callDialogue = await loadCallDialogue(db, organizationId, callIds);
  return page.interactions
    .map((interaction) => ({
      channel: interaction.channel,
      conversationId: interaction.conversationId,
      summary: (
        callDialogue.get(interaction.conversationId) ||
        interaction.botMemory?.rollingSummary ||
        interaction.summary
      ).trim(),
      occurredAt: interaction.occurredAt,
      sentiment: interaction.sentiment,
    }))
    .filter((entry) => entry.summary.length > 0);
}

async function loadCallDialogue(
  db: DbClient,
  organizationId: string,
  conversationIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(conversationIds.filter(Boolean))];
  const dialogue = new Map<string, string>();
  if (unique.length === 0) return dialogue;
  const rows = await db.$queryRaw<
    Array<{ conversation_id: string; sender_type: string; body: string | null }>
  >`
    SELECT conversation_id::text AS conversation_id, sender_type, body
    FROM ccass.conversation_messages
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ANY(${unique.map((id) => BigInt(id))}::bigint[])
      AND sender_type IN ('customer', 'bot', 'agent')
      AND visibility = 'customer'
    ORDER BY conversation_id, created_at ASC
  `;
  const grouped = new Map<string, Array<{ senderType: string; body: string }>>();
  for (const row of rows) {
    const lines = grouped.get(row.conversation_id) ?? [];
    lines.push({ senderType: row.sender_type, body: row.body ?? "" });
    grouped.set(row.conversation_id, lines);
  }
  for (const [conversationId, lines] of grouped) {
    const text = formatCallDialogue(lines);
    if (text) dialogue.set(conversationId, text);
  }
  return dialogue;
}

function parseCustomFields(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function upsertOmniChannelSummary(
  db: DbClient,
  organizationId: string,
  contactId: string,
  summary: string,
): Promise<void> {
  const trimmed = summary.trim();
  if (!trimmed) return;
  const patch = JSON.stringify({
    omniChannelSummary: trimmed,
    omniChannelSummaryUpdatedAt: new Date().toISOString(),
  });
  const updated = await db.$executeRaw`
    UPDATE cdp.customer_profile
    SET
      custom_fields = COALESCE(custom_fields, '{}'::jsonb) || ${patch}::jsonb,
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${contactId}::text
  `;
  if (Number(updated) < 1) {
    throw new Error(`omni-channel summary was not stored for contact ${contactId}`);
  }
}

export async function getContactOmniChannelSummary(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<{ omniChannelSummary: string | null; updatedAt: string | null }> {
  const rows = await db.$queryRaw<
    Array<{
      custom_fields: Record<string, unknown> | string | null;
    }>
  >`
    SELECT custom_fields
    FROM cdp.customer_profile
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${contactId}::text
    LIMIT 1
  `;
  const customFields = parseCustomFields(rows[0]?.custom_fields);
  const summary =
    typeof customFields.omniChannelSummary === "string"
      ? customFields.omniChannelSummary.trim()
      : "";
  const updatedAtRaw = customFields.omniChannelSummaryUpdatedAt;
  const updatedAt =
    typeof updatedAtRaw === "string"
      ? updatedAtRaw
      : updatedAtRaw instanceof Date
        ? updatedAtRaw.toISOString()
        : null;
  return {
    omniChannelSummary: summary || null,
    updatedAt,
  };
}

export async function refreshOmniChannelSummary(
  organizationId: string,
  contactId: string,
): Promise<{
  omniChannelSummary: string | null;
  channelCount: number;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }
  const response = await fetch(`${NLP_URL}/api/v1/omnichannel/summary/refresh`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      organization_id: organizationId,
      contact_id: contactId,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Omni-channel summary refresh failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const body = (await response.json()) as {
    omni_channel_summary?: string | null;
    channel_count?: number;
  };
  return {
    omniChannelSummary: body.omni_channel_summary?.trim() || null,
    channelCount: body.channel_count ?? 0,
  };
}

export function scheduleOmniChannelSummaryRefresh(
  organizationId: string,
  contactId: string | null | undefined,
): void {
  if (!contactId) return;
  void refreshOmniChannelSummary(organizationId, contactId).catch((error) => {
    console.warn("[omni-channel-summary] refresh failed", {
      organizationId,
      contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function ensureOmniChannelSummarySchema(_db: DbClient): Promise<void> {
  // Omni-channel summary is stored in `cdp.customer_profile.custom_fields`.
}

export async function listContactsNeedingOmniChannelSummary(
  db: DbClient,
  options: {
    organizationId?: string;
    contactId?: string;
    missingOnly?: boolean;
  } = {},
): Promise<Array<{ organizationId: string; contactId: string }>> {
  const { organizationId, contactId, missingOnly = true } = options;
  const rows = await db.$queryRaw<
    Array<{ organization_id: string; contact_id: string }>
  >`
    SELECT DISTINCT conv.organization_id, conv.contact_id
    FROM ccass.conversations conv
    INNER JOIN cdp.customer_profile cp
      ON ${SQL_CONVERSATION_ALIAS_TO_CDP_CONTACT}
     AND cp.organization_id = conv.organization_id
    WHERE conv.contact_id IS NOT NULL
      AND (${organizationId ?? null}::bigint IS NULL OR conv.organization_id = ${organizationId ?? null}::bigint)
      AND (${contactId ?? null}::text IS NULL OR conv.contact_id = ${contactId ?? null})
      AND (
        ${missingOnly}::boolean = false
        OR COALESCE(cp.custom_fields->>'omniChannelSummary', '') = ''
      )
    ORDER BY conv.organization_id, conv.contact_id
  `;
  return rows.map((row) => ({
    organizationId: serializeEntityIdOptional(row.organization_id)!,
    contactId: serializeEntityIdOptional(row.contact_id)!,
  }));
}

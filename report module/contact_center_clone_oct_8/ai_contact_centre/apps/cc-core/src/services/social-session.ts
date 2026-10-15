import type { DbClient } from "../lib/rls.js";
import { projectInteractionEvent } from "./cdp-projection.js";
import { upsertConversationMemory } from "./conversation-memory.js";
import { endNlpConversation, listNlpTurns, type NlpTurnRecord } from "./nlp-conversations.js";

export const DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS = 24;

export const SOCIAL_SESSION_CHANNELS = ["whatsapp", "instagram", "facebook"] as const;

export type SocialSessionChannel = (typeof SOCIAL_SESSION_CHANNELS)[number];

export type SocialSessionCloseReason = "session_expired" | "bot_resolved_inactivity";

export function isSocialSessionChannel(channel: string): channel is SocialSessionChannel {
  return (SOCIAL_SESSION_CHANNELS as readonly string[]).includes(channel);
}

export function isSessionIdleExpired(
  updatedAt: Date | string,
  inactivityCloseHours: number,
  nowMs = Date.now(),
): boolean {
  const updatedMs = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(String(updatedAt));
  if (!Number.isFinite(updatedMs)) return false;
  return nowMs - updatedMs >= inactivityCloseHours * 60 * 60 * 1000;
}

export function buildBotSessionSummaryFromTurns(
  turns: NlpTurnRecord[],
): { rollingSummary: string; extractedFacts: string[] } {
  const snippets = turns.slice(-6).map((turn, index) => {
    const customer = turn.customerText.trim();
    const bot = turn.botReply?.trim();
    return `${index + 1}. Customer: ${customer}${bot ? ` | Bot: ${bot}` : ""}`;
  });
  const facts = turns
    .flatMap((turn) => (turn.intent ? [turn.intent] : []))
    .filter(Boolean)
    .slice(0, 5);
  return {
    rollingSummary: snippets.join("\n").slice(0, 800),
    extractedFacts: facts,
  };
}

export async function getSocialInactivityCloseHours(
  db: DbClient,
  organizationId: string,
  channel: SocialSessionChannel,
  channelConfigId: string | null,
): Promise<number> {
  if (!channelConfigId) {
    return DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS;
  }

  if (channel === "whatsapp") {
    const rows = await db.$queryRaw<{ inactivity_close_hours: number }[]>`
      SELECT COALESCE(inactivity_close_hours, ${DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS}) AS inactivity_close_hours
      FROM ccass.whatsapp_channel_policies
      WHERE organization_id = ${organizationId}::bigint
        AND channel_config_id = ${channelConfigId}::bigint
        AND status = 'active'
      LIMIT 1
    `;
    return rows[0]?.inactivity_close_hours ?? DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS;
  }

  const rows = await db.$queryRaw<{ inactivity_close_hours: number }[]>`
    SELECT COALESCE(
      CEIL(inactivity_close_seconds / 3600.0)::int,
      ${DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS}
    ) AS inactivity_close_hours
    FROM ccass.channel_automation_policies
    WHERE organization_id = ${organizationId}::bigint
      AND channel_config_id = ${channelConfigId}::bigint
      AND status = 'active'
    LIMIT 1
  `;
  return rows[0]?.inactivity_close_hours ?? DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS;
}

export async function closeSocialBotSession(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  reason: SocialSessionCloseReason,
): Promise<boolean> {
  const turns = await listNlpTurns(db, organizationId, conversationId);
  if (turns.length > 0) {
    const summary = buildBotSessionSummaryFromTurns(turns);
    await upsertConversationMemory(db, organizationId, conversationId, {
      rollingSummary: summary.rollingSummary,
      extractedFacts: summary.extractedFacts,
      modelName: reason === "session_expired" ? "social-session-expired" : "session-sweeper",
    });
  }

  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE ccass.conversations
    SET
      status = 'resolved',
      lifecycle_state = 'ended',
      bot_active = FALSE,
      resolved_at = COALESCE(resolved_at, NOW()),
      ended_at = NOW(),
      end_reason = ${reason},
      end_actor = 'session',
      handoff_reason = CASE
        WHEN ${reason} = 'bot_resolved_inactivity' THEN 'bot_resolved_inactivity'
        ELSE handoff_reason
      END,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND bot_active = TRUE
      AND status = 'bot_active'
      AND channel IN ('whatsapp', 'instagram', 'facebook')
    RETURNING id
  `;
  if (!rows[0]) return false;

  await endNlpConversation(db, organizationId, conversationId, reason);
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "conversation.ended",
    metadata: { actor: "session", reason },
  });
  return true;
}

export async function expireIdleSocialBotSessionIfNeeded(
  db: DbClient,
  organizationId: string,
  conversation: {
    id: string;
    channel: string;
    status: string;
    botActive: boolean;
    updatedAt: Date | string;
    channelConfigId: string | null;
  },
): Promise<boolean> {
  if (
    !isSocialSessionChannel(conversation.channel) ||
    conversation.status !== "bot_active" ||
    !conversation.botActive
  ) {
    return false;
  }

  const inactivityHours = await getSocialInactivityCloseHours(
    db,
    organizationId,
    conversation.channel,
    conversation.channelConfigId,
  );
  if (!isSessionIdleExpired(conversation.updatedAt, inactivityHours)) {
    return false;
  }

  return closeSocialBotSession(db, organizationId, conversation.id, "session_expired");
}

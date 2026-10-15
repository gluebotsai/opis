import type { DbClient } from "../lib/rls.js";
import { upsertConversationMemory } from "./conversation-memory.js";
import { listNlpTurns } from "./nlp-conversations.js";
import { sweepSlaBreaches } from "./conversation-sla.js";
import {
  buildBotSessionSummaryFromTurns,
  closeSocialBotSession,
  DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS,
} from "./social-session.js";

type IdleConversationRow = {
  id: string;
  organization_id: string;
  channel: string;
  inactivity_close_hours: number;
};

export async function closeIdleBotConversations(db: DbClient): Promise<number> {
  const rows = await db.$queryRaw<IdleConversationRow[]>`
    SELECT
      c.id,
      c.organization_id,
      c.channel,
      CASE
        WHEN c.channel = 'whatsapp' THEN COALESCE(wa.inactivity_close_hours, ${DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS})
        WHEN c.channel IN ('instagram', 'facebook', 'webchat') THEN COALESCE(
          CEIL(cap.inactivity_close_seconds / 3600.0)::int,
          ${DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS}
        )
        WHEN c.channel = 'email' THEN COALESCE(em.inactivity_close_hours, 48)
        ELSE 72
      END AS inactivity_close_hours
    FROM ccass.conversations c
    LEFT JOIN ccass.whatsapp_channel_policies wa
      ON wa.organization_id = c.organization_id
      AND wa.channel_config_id = c.channel_config_id
      AND wa.status = 'active'
    LEFT JOIN ccass.channel_automation_policies cap
      ON cap.organization_id = c.organization_id
      AND cap.channel_config_id = c.channel_config_id
      AND cap.status = 'active'
    LEFT JOIN ccass.email_mailbox_policies em
      ON em.organization_id = c.organization_id
      AND em.connection_id = c.mailbox_connection_id
      AND em.status = 'active'
    WHERE c.bot_active = TRUE
      AND c.status = 'bot_active'
      AND c.channel IN ('whatsapp', 'instagram', 'facebook', 'email', 'webchat')
      AND c.updated_at < NOW() - (
        CASE
          WHEN c.channel = 'whatsapp' THEN COALESCE(wa.inactivity_close_hours, ${DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS})
          WHEN c.channel IN ('instagram', 'facebook', 'webchat') THEN COALESCE(
            CEIL(cap.inactivity_close_seconds / 3600.0)::int,
            ${DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS}
          )
          WHEN c.channel = 'email' THEN COALESCE(em.inactivity_close_hours, 48)
          ELSE 72
        END * INTERVAL '1 hour'
      )
    LIMIT 100
  `;

  let closed = 0;
  for (const row of rows) {
    if (row.channel === "whatsapp" || row.channel === "instagram" || row.channel === "facebook") {
      const didClose = await closeSocialBotSession(
        db,
        row.organization_id,
        row.id,
        "bot_resolved_inactivity",
      );
      if (didClose) closed += 1;
      continue;
    }

    const turns = await listNlpTurns(db, row.organization_id, row.id);
    const summary = buildBotSessionSummaryFromTurns(turns);
    await upsertConversationMemory(db, row.organization_id, row.id, {
      rollingSummary: summary.rollingSummary,
      extractedFacts: summary.extractedFacts,
      modelName: "session-sweeper",
    });
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET
        status = 'resolved',
        lifecycle_state = 'ended',
        bot_active = FALSE,
        handoff_reason = 'bot_resolved_inactivity',
        resolved_at = NOW(),
        ended_at = NOW(),
        end_reason = 'bot_resolved_inactivity',
        updated_at = NOW()
      WHERE id = ${row.id}::bigint
        AND organization_id = ${row.organization_id}::bigint
        AND bot_active = TRUE
    `;
    closed += 1;
  }
  return closed;
}

export function startSessionSweeper(
  dbFactory: () => DbClient,
  intervalMs = 15 * 60 * 1000,
): () => void {
  const timer = setInterval(() => {
    const db = dbFactory();
    void closeIdleBotConversations(db).catch(() => undefined);
    void sweepSlaBreaches(db).catch(() => undefined);
  }, intervalMs);
  return () => clearInterval(timer);
}

import type { DbClient } from "../lib/rls.js";
import { jsonStringifyEntityPayload } from "../lib/id-schema.js";

/** Project operational ccass conversation events into cdp.interactions (customer-centric view). */
type InteractionEventInput = {
  conversationId: string;
  messageId?: string;
  eventType: string;
  metadata?: Record<string, unknown>;
};

export async function projectInteractionEvent(
  db: DbClient,
  organizationId: string,
  input: InteractionEventInput,
): Promise<void> {
  const conversationRows = await db.$queryRaw<
    {
      id: string;
      channel: string;
      visitor_id: string | null;
      contact_id: string | null;
      profile_id: string | null;
      queue_id: string | null;
      assigned_agent_id: string | null;
      status: string;
      ended_at: Date | null;
      end_reason: string | null;
      disposition_code: string | null;
      resolution_code: string | null;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    SELECT
      id, channel, visitor_id, contact_id, profile_id, queue_id,
      assigned_agent_id, status, ended_at, end_reason, disposition_code,
      resolution_code, created_at, updated_at
    FROM ccass.conversations
    WHERE id = ${input.conversationId}::bigint AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;

  const conversation = conversationRows[0];
  if (!conversation) return;

  const memoryRows = await db.$queryRaw<{ rolling_summary: string | null }[]>`
    SELECT rolling_summary
    FROM ccass.conversation_memory
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversation.id}::bigint
    LIMIT 1
  `;
  const interactionSummary = memoryRows[0]?.rolling_summary?.trim() || null;

  await db.$executeRaw`
    INSERT INTO cdp.interactions (
      organization_id, conversation_id, contact_id, profile_id, visitor_id,
      channel, queue_id, agent_id, status, started_at, ended_at, outcome,
      disposition_code, summary, last_activity_at, updated_at
    ) VALUES (
      ${organizationId}::bigint,
      ${conversation.id}::bigint,
      ${conversation.contact_id},
      ${conversation.profile_id}::bigint,
      ${conversation.visitor_id},
      ${conversation.channel},
      ${conversation.queue_id}::bigint,
      ${conversation.assigned_agent_id}::bigint,
      ${conversation.status},
      ${conversation.created_at},
      ${conversation.ended_at},
      ${conversation.resolution_code ?? conversation.end_reason},
      ${conversation.disposition_code},
      ${interactionSummary},
      NOW(),
      NOW()
    )
    ON CONFLICT (organization_id, conversation_id) DO UPDATE SET
      contact_id = EXCLUDED.contact_id,
      profile_id = EXCLUDED.profile_id,
      visitor_id = EXCLUDED.visitor_id,
      queue_id = EXCLUDED.queue_id,
      agent_id = EXCLUDED.agent_id,
      status = EXCLUDED.status,
      ended_at = EXCLUDED.ended_at,
      outcome = EXCLUDED.outcome,
      disposition_code = EXCLUDED.disposition_code,
      summary = COALESCE(EXCLUDED.summary, cdp.interactions.summary),
      last_activity_at = NOW(),
      updated_at = NOW()
  `;

  const interactionRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM cdp.interactions
    WHERE organization_id = ${organizationId}::bigint AND conversation_id = ${conversation.id}::bigint
    LIMIT 1
  `;
  const interactionId = interactionRows[0]?.id;
  if (!interactionId) return;

  await db.$executeRaw`
    INSERT INTO cdp.interaction_events (
      organization_id, interaction_id, conversation_id, message_id, event_type, metadata
    ) VALUES (
      ${organizationId}::bigint,
      ${interactionId}::bigint,
      ${conversation.id}::bigint,
      ${input.messageId ?? null}::bigint,
      ${input.eventType},
      ${jsonStringifyEntityPayload(input.metadata ?? {})}::jsonb
    )
  `;
}

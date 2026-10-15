-- Conversation IDs are treated as globally unique by the app, but LIST(channel)
-- partitions can mint the same identity. Reseed the shared sequence, remap
-- colliding newer rows (voice calls), and keep conversations_old in sync so
-- child FKs remain valid.

INSERT INTO ccass.dispositions (
  organization_id,
  code,
  label,
  description,
  category,
  outcome,
  requires_note,
  requires_resolution,
  sort_order
)
SELECT
  organization.id,
  disposition.code,
  disposition.label,
  disposition.description,
  disposition.category,
  disposition.outcome,
  FALSE,
  FALSE,
  disposition.sort_order
FROM accounts.organizations organization
CROSS JOIN (
  VALUES
    ('agent_declined', 'Agent declined', 'The agent declined the inbound call.', 'closure', 'unresolved', 41),
    ('browser_disconnected', 'Browser disconnected', 'The agent browser disconnected during the call.', 'closure', 'unresolved', 42)
) AS disposition(code, label, description, category, outcome, sort_order)
WHERE organization.lifecycle_status = 'active'
ON CONFLICT (organization_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION ccass.sync_conversations_old()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ccass.conversations_old
  SELECT NEW.*
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    channel = EXCLUDED.channel,
    external_thread_id = EXCLUDED.external_thread_id,
    webchat_id = EXCLUDED.webchat_id,
    visitor_id = EXCLUDED.visitor_id,
    contact_id = EXCLUDED.contact_id,
    profile_id = EXCLUDED.profile_id,
    queue_id = EXCLUDED.queue_id,
    assigned_agent_id = EXCLUDED.assigned_agent_id,
    assigned_user_id = EXCLUDED.assigned_user_id,
    status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    subject = EXCLUDED.subject,
    handoff_reason = EXCLUDED.handoff_reason,
    bot_active = EXCLUDED.bot_active,
    nlp_enabled = EXCLUDED.nlp_enabled,
    live_agent_enabled = EXCLUDED.live_agent_enabled,
    version = EXCLUDED.version,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    queued_at = EXCLUDED.queued_at,
    assigned_at = EXCLUDED.assigned_at,
    first_response_at = EXCLUDED.first_response_at,
    resolved_at = EXCLUDED.resolved_at,
    closed_at = EXCLUDED.closed_at,
    lifecycle_state = EXCLUDED.lifecycle_state,
    lifecycle_version = EXCLUDED.lifecycle_version,
    ended_at = EXCLUDED.ended_at,
    end_reason = EXCLUDED.end_reason,
    end_actor = EXCLUDED.end_actor,
    transferred_at = EXCLUDED.transferred_at,
    disposition_code = EXCLUDED.disposition_code,
    disposition_note = EXCLUDED.disposition_note,
    resolution_code = EXCLUDED.resolution_code,
    resolution_summary = EXCLUDED.resolution_summary,
    resolution_data = EXCLUDED.resolution_data,
    mailbox_connection_id = EXCLUDED.mailbox_connection_id,
    automation_policy_version = EXCLUDED.automation_policy_version,
    first_response_due_at = EXCLUDED.first_response_due_at,
    resolution_due_at = EXCLUDED.resolution_due_at,
    first_agent_response_at = EXCLUDED.first_agent_response_at,
    sla_status = EXCLUDED.sla_status,
    provider_thread_id = EXCLUDED.provider_thread_id,
    previous_conversation_id = EXCLUDED.previous_conversation_id,
    channel_config_id = EXCLUDED.channel_config_id,
    event_sequence = EXCLUDED.event_sequence,
    visitor_session_token = EXCLUDED.visitor_session_token,
    direction = EXCLUDED.direction;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_sync_old ON ccass.conversations;
CREATE TRIGGER conversations_sync_old
AFTER INSERT OR UPDATE ON ccass.conversations
FOR EACH ROW
EXECUTE FUNCTION ccass.sync_conversations_old();

CREATE OR REPLACE FUNCTION ccass.remap_duplicate_conversation_ids()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  moved INTEGER := 0;
BEGIN
  PERFORM setval(
    'ccass.conversations_part_id_seq',
    GREATEST(
      (SELECT COALESCE(MAX(id), 1) FROM ccass.conversations),
      (SELECT last_value FROM ccass.conversations_id_seq)
    )
  );

  CREATE TEMP TABLE conversation_id_remap ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      id,
      channel,
      organization_id,
      created_at,
      ROW_NUMBER() OVER (PARTITION BY id ORDER BY created_at ASC, channel ASC) AS rn
    FROM ccass.conversations
    WHERE id IN (
      SELECT id FROM ccass.conversations GROUP BY id HAVING COUNT(*) > 1
    )
  )
  SELECT
    id AS old_id,
    channel,
    organization_id,
    created_at AS call_created_at,
    nextval('ccass.conversations_part_id_seq') AS new_id
  FROM ranked
  WHERE rn > 1;

  INSERT INTO ccass.conversations_old
  SELECT populated.*
  FROM conversation_id_remap remap
  INNER JOIN ccass.conversations conversation
    ON conversation.id = remap.old_id
   AND conversation.channel = remap.channel
  CROSS JOIN LATERAL jsonb_populate_record(
    NULL::ccass.conversations_old,
    to_jsonb(conversation) || jsonb_build_object('id', remap.new_id)
  ) AS populated
  ON CONFLICT (id) DO NOTHING;

  UPDATE ccass.conversation_assignments assignment
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE assignment.conversation_id = remap.old_id
    AND (
      assignment.reason = 'umn_call_connected'
      OR assignment.offered_at >= remap.call_created_at - INTERVAL '2 seconds'
    );

  UPDATE ccass.conversation_messages message
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE message.conversation_id = remap.old_id
    AND message.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.conversation_message_attachments attachment
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE attachment.conversation_id = remap.old_id
    AND (
      EXISTS (
        SELECT 1
        FROM ccass.conversation_messages message
        WHERE message.id = attachment.message_id
          AND message.conversation_id = remap.new_id
      )
      OR attachment.created_at >= remap.call_created_at - INTERVAL '2 seconds'
    );

  UPDATE ccass.conversation_participants participant
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE participant.conversation_id = remap.old_id
    AND participant.joined_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.conversation_dispositions disposition
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE disposition.conversation_id = remap.old_id
    AND disposition.applied_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.conversation_notes note
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE note.conversation_id = remap.old_id
    AND note.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.conversation_transfers transfer
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE transfer.conversation_id = remap.old_id
    AND transfer.requested_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.conversation_sentiment_turns turn
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE turn.conversation_id = remap.old_id
    AND turn.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.message_receipts receipt
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE receipt.conversation_id = remap.old_id
    AND receipt.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.copilot_turns turn
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE turn.conversation_id = remap.old_id
    AND turn.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.email_delivery_outbox outbox
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE outbox.conversation_id = remap.old_id
    AND outbox.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.agent_tasks task
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE task.conversation_id = remap.old_id
    AND task.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.agent_missed_contacts missed
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE missed.conversation_id = remap.old_id
    AND missed.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.routing_attempts attempt
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE attempt.conversation_id = remap.old_id
    AND attempt.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.proactive_callback_attempts attempt
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE attempt.conversation_id = remap.old_id
    AND attempt.created_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE cdp.interaction_events event
  SET conversation_id = remap.new_id
  FROM conversation_id_remap remap
  WHERE event.conversation_id = remap.old_id
    AND event.occurred_at >= remap.call_created_at - INTERVAL '2 seconds';

  UPDATE ccass.conversations conversation
  SET id = remap.new_id,
      updated_at = NOW()
  FROM conversation_id_remap remap
  WHERE conversation.id = remap.old_id
    AND conversation.channel = remap.channel;

  GET DIAGNOSTICS moved = ROW_COUNT;

  PERFORM setval(
    'ccass.conversations_id_seq',
    (SELECT last_value FROM ccass.conversations_part_id_seq)
  );
  PERFORM setval(
    'ccass.conversations_part_id_seq',
    GREATEST(
      (SELECT COALESCE(MAX(id), 1) FROM ccass.conversations),
      (SELECT last_value FROM ccass.conversations_id_seq)
    )
  );

  RETURN moved;
END;
$$;

SELECT ccass.remap_duplicate_conversation_ids();
DROP FUNCTION ccass.remap_duplicate_conversation_ids();

-- product/sql/offers_ringing.sql
-- Certified offers_ringing. Declared filter slots only. No open filters_sql hole.
SELECT
  {{dimension_select}}
  COUNT(*) AS offers_ringing
FROM rpt.assignments assignments
LEFT JOIN rpt.conversations conversations ON conversations.id = assignments.conversation_id
LEFT JOIN rpt.agents agents ON agents.id = assignments.agent_id
LEFT JOIN rpt.queues queues ON queues.id = assignments.queue_id
WHERE 1 = 1
  AND assignments.state = 'offered'
  AND (CAST(:channel AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.channel = CAST(:channel AS text)))
  AND (CAST(:conversation_direction AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.direction = CAST(:conversation_direction AS text)))
  AND (CAST(:disposition AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.disposition_label = CAST(:disposition AS text)))
  AND (CAST(:end_actor AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.end_actor = CAST(:end_actor AS text)))
  AND (CAST(:end_reason AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.end_reason = CAST(:end_reason AS text)))
  AND (CAST(:priority AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.priority = CAST(:priority AS integer)))
  AND (CAST(:resolution_code AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.resolution_code = CAST(:resolution_code AS text)))
  AND (CAST(:conversation_status AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.status = CAST(:conversation_status AS text)))
  AND (CAST(:miss_reason AS text) IS NULL OR assignments.reason = CAST(:miss_reason AS text))
  AND (CAST(:assignment_state AS text) IS NULL OR assignments.state = CAST(:assignment_state AS text))
  AND (CAST(:agent AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.agents ag WHERE ag.id = assignments.agent_id AND ag.display_name = CAST(:agent AS text)))
  AND (CAST(:queue AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.queues q WHERE q.id = assignments.queue_id AND q.name = CAST(:queue AS text)))
  AND (CAST(:is_reopened AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.is_reopened = CAST(:is_reopened AS boolean)))
  AND (CAST(:is_bot_only AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.is_bot_only = CAST(:is_bot_only AS boolean)))
  AND (CAST(:handler AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = assignments.conversation_id AND c.handler = CAST(:handler AS text)))
{{group_by_sql}}

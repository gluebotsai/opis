-- product/sql/bot_grounded_rate.sql
-- Certified bot_grounded_rate. Declared filter slots only. No open filters_sql hole.
SELECT
  {{dimension_select}}
  COUNT(*) FILTER (WHERE nlp_turns.grounded = true) AS grounded_n,
  COUNT(*) AS turns_n
FROM rpt.nlp_turns nlp_turns
LEFT JOIN rpt.conversations conversations ON conversations.id = nlp_turns.conversation_id
WHERE 1 = 1
  AND (CAST(:start AS timestamptz) IS NULL OR nlp_turns.created_at >= CAST(:start AS timestamptz))
  AND (CAST(:end AS timestamptz) IS NULL OR nlp_turns.created_at < CAST(:end AS timestamptz))
  AND (CAST(:channel AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.channel = CAST(:channel AS text)))
  AND (CAST(:conversation_direction AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.direction = CAST(:conversation_direction AS text)))
  AND (CAST(:disposition AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.disposition_label = CAST(:disposition AS text)))
  AND (CAST(:end_actor AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.end_actor = CAST(:end_actor AS text)))
  AND (CAST(:end_reason AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.end_reason = CAST(:end_reason AS text)))
  AND (CAST(:priority AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.priority = CAST(:priority AS integer)))
  AND (CAST(:resolution_code AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.resolution_code = CAST(:resolution_code AS text)))
  AND (CAST(:conversation_status AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.status = CAST(:conversation_status AS text)))
  AND (CAST(:grounded AS text) IS NULL OR nlp_turns.grounded = CAST(:grounded AS boolean))
  AND (CAST(:handoff_recommended AS text) IS NULL OR nlp_turns.handoff_recommended = CAST(:handoff_recommended AS boolean))
  AND (CAST(:intent AS text) IS NULL OR nlp_turns.intent = CAST(:intent AS text))
  AND (CAST(:is_reopened AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.is_reopened = CAST(:is_reopened AS boolean)))
  AND (CAST(:is_bot_only AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.is_bot_only = CAST(:is_bot_only AS boolean)))
  AND (CAST(:handler AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = nlp_turns.conversation_id AND c.handler = CAST(:handler AS text)))
{{group_by_sql}}

-- product/sql/avg_first_response.sql
-- Certified avg_first_response. Declared filter slots only. No open filters_sql hole.
SELECT
  {{dimension_select}}
  ROUND(
    AVG(EXTRACT(EPOCH FROM (
      conversations.first_response_at
      - COALESCE(conversations.queued_at, conversations.created_at)
    ))) / 60.0,
    2
  ) AS avg_first_response
FROM rpt.conversations conversations
WHERE 1 = 1
  AND conversations.first_response_at IS NOT NULL
  AND COALESCE(conversations.queued_at, conversations.created_at) IS NOT NULL
  AND (CAST(:start AS timestamptz) IS NULL OR conversations.first_response_at >= CAST(:start AS timestamptz))
  AND (CAST(:end AS timestamptz) IS NULL OR conversations.first_response_at < CAST(:end AS timestamptz))
  AND (CAST(:team AS text) IS NULL OR conversations.team_name = CAST(:team AS text))
  AND (CAST(:channel_config AS text) IS NULL OR EXISTS (
      SELECT 1 FROM rpt.channel_configs cc
      WHERE cc.id = conversations.channel_config_id AND cc.name = CAST(:channel_config AS text)
    ))
  AND (CAST(:customer_blocked AS text) IS NULL OR conversations.customer_blocked = CAST(:customer_blocked AS boolean))
  AND (CAST(:customer_company AS text) IS NULL OR conversations.customer_company = CAST(:customer_company AS text))
  AND (CAST(:customer_name AS text) IS NULL OR conversations.customer_name ILIKE CAST(:customer_name AS text))
  AND (CAST(:customer_language AS text) IS NULL OR conversations.customer_language = CAST(:customer_language AS text))
  AND (CAST(:channel AS text) IS NULL OR conversations.channel = CAST(:channel AS text))
  AND (CAST(:conversation_direction AS text) IS NULL OR conversations.direction = CAST(:conversation_direction AS text))
  AND (CAST(:disposition AS text) IS NULL OR conversations.disposition_label = CAST(:disposition AS text))
  AND (CAST(:end_actor AS text) IS NULL OR conversations.end_actor = CAST(:end_actor AS text))
  AND (CAST(:end_reason AS text) IS NULL OR conversations.end_reason = CAST(:end_reason AS text))
  AND (CAST(:handoff_reason AS text) IS NULL OR conversations.handoff_reason = CAST(:handoff_reason AS text))
  AND (CAST(:priority AS text) IS NULL OR conversations.priority = CAST(:priority AS integer))
  AND (CAST(:resolution_code AS text) IS NULL OR conversations.resolution_code = CAST(:resolution_code AS text))
  AND (CAST(:conversation_status AS text) IS NULL OR conversations.status = CAST(:conversation_status AS text))
  AND (CAST(:transferred_to_agent AS text) IS NULL OR EXISTS (
      SELECT 1 FROM rpt.transfers tr
      WHERE tr.conversation_id = conversations.id
        AND tr.completed_at IS NOT NULL
        AND tr.to_agent_name = CAST(:transferred_to_agent AS text)
    ))
  AND (CAST(:transferred_to_queue AS text) IS NULL OR EXISTS (
      SELECT 1 FROM rpt.transfers tr
      WHERE tr.conversation_id = conversations.id
        AND tr.completed_at IS NOT NULL
        AND tr.to_queue_name = CAST(:transferred_to_queue AS text)
    ))
  AND (CAST(:agent AS text) IS NULL OR conversations.agent_name = CAST(:agent AS text))
  AND (CAST(:queue AS text) IS NULL OR conversations.queue_name = CAST(:queue AS text))
  AND (CAST(:is_reopened AS text) IS NULL OR conversations.is_reopened = CAST(:is_reopened AS boolean))
  AND (CAST(:is_bot_only AS text) IS NULL OR conversations.is_bot_only = CAST(:is_bot_only AS boolean))
  AND (CAST(:handler AS text) IS NULL OR conversations.handler = CAST(:handler AS text))
{{group_by_sql}}

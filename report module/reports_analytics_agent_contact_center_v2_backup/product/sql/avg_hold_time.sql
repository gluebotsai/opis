-- product/sql/avg_hold_time.sql
-- Certified avg_hold_time. Declared filter slots only. No open filters_sql hole.
SELECT
  {{dimension_select}}
  ROUND(AVG(call_cdr.hold_seconds) / 60.0, 2) AS avg_hold_time
FROM rpt.call_cdr call_cdr
WHERE 1 = 1
  AND (CAST(:start AS timestamptz) IS NULL OR call_cdr.created_at >= CAST(:start AS timestamptz))
  AND (CAST(:end AS timestamptz) IS NULL OR call_cdr.created_at < CAST(:end AS timestamptz))
  AND (CAST(:channel AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.channel = CAST(:channel AS text)))
  AND (CAST(:conversation_direction AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.direction = CAST(:conversation_direction AS text)))
  AND (CAST(:disposition AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.disposition_label = CAST(:disposition AS text)))
  AND (CAST(:end_actor AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.end_actor = CAST(:end_actor AS text)))
  AND (CAST(:end_reason AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.end_reason = CAST(:end_reason AS text)))
  AND (CAST(:priority AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.priority = CAST(:priority AS integer)))
  AND (CAST(:resolution_code AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.resolution_code = CAST(:resolution_code AS text)))
  AND (CAST(:conversation_status AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.status = CAST(:conversation_status AS text)))
  AND (CAST(:agent AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations conv WHERE conv.external_thread_id = call_cdr.session_id AND conv.channel = 'call' AND conv.agent_name = CAST(:agent AS text)))
  AND (CAST(:queue AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.queue_name = CAST(:queue AS text)))
  AND (CAST(:is_inbound AS text) IS NULL OR call_cdr.is_inbound = CAST(:is_inbound AS smallint))
  AND (CAST(:is_reopened AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.is_reopened = CAST(:is_reopened AS boolean)))
  AND (CAST(:is_bot_only AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.is_bot_only = CAST(:is_bot_only AS boolean)))
  AND (CAST(:handler AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.external_thread_id = call_cdr.session_id AND c.channel = 'call' AND c.handler = CAST(:handler AS text)))
{{group_by_sql}}

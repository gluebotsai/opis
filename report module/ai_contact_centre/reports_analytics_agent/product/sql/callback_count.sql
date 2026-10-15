-- product/sql/callback_count.sql
-- Certified callback_count. Clock is created_at. due_at / completed_at / task_status are filters.
-- Declared filter slots only. No open filters_sql hole.
SELECT
  {{dimension_select}}
  COUNT(*) AS callback_count
FROM rpt.tasks tasks
WHERE 1 = 1
  AND tasks.task_type = 'callback'
  AND (CAST(:start AS timestamptz) IS NULL OR tasks.created_at >= CAST(:start AS timestamptz))
  AND (CAST(:end AS timestamptz) IS NULL OR tasks.created_at < CAST(:end AS timestamptz))
  AND (CAST(:task_status AS text) IS NULL OR tasks.status = CAST(:task_status AS text))
  AND (CAST(:task_type AS text) IS NULL OR tasks.task_type = CAST(:task_type AS text))
  AND (CAST(:due_at AS timestamptz) IS NULL OR (
      tasks.due_at >= CAST(:due_at AS timestamptz)
      AND tasks.due_at < CAST(:due_at AS timestamptz) + interval '1 day'
    ))
  AND (CAST(:completed_at AS timestamptz) IS NULL OR (
      tasks.completed_at >= CAST(:completed_at AS timestamptz)
      AND tasks.completed_at < CAST(:completed_at AS timestamptz) + interval '1 day'
    ))
  AND (CAST(:customer_blocked AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.customer_blocked = CAST(:customer_blocked AS boolean)))
  AND (CAST(:customer_company AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.customer_company = CAST(:customer_company AS text)))
  AND (CAST(:customer_language AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.customer_language = CAST(:customer_language AS text)))
  AND (CAST(:channel AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.channel = CAST(:channel AS text)))
  AND (CAST(:conversation_direction AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.direction = CAST(:conversation_direction AS text)))
  AND (CAST(:disposition AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.disposition_label = CAST(:disposition AS text)))
  AND (CAST(:end_actor AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.end_actor = CAST(:end_actor AS text)))
  AND (CAST(:end_reason AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.end_reason = CAST(:end_reason AS text)))
  AND (CAST(:priority AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.priority = CAST(:priority AS integer)))
  AND (CAST(:resolution_code AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.resolution_code = CAST(:resolution_code AS text)))
  AND (CAST(:conversation_status AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.status = CAST(:conversation_status AS text)))
  AND (CAST(:is_reopened AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.is_reopened = CAST(:is_reopened AS boolean)))
  AND (CAST(:is_bot_only AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.is_bot_only = CAST(:is_bot_only AS boolean)))
  AND (CAST(:handler AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = tasks.conversation_id AND c.handler = CAST(:handler AS text)))
{{group_by_sql}}

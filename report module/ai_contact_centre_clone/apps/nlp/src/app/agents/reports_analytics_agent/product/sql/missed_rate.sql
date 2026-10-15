-- product/sql/missed_rate.sql
-- Certified missed_rate. Numerator = missed rows in window; denominator = conversations started in window.
-- Declared filter slots only. No open filters_sql hole.
SELECT
  {{dimension_select}}
  COUNT(*) FILTER (WHERE missed_rate_src._kind = 'missed') AS missed_n,
  COUNT(*) FILTER (WHERE missed_rate_src._kind = 'started') AS total_n
FROM (
  SELECT
    'missed'::text AS _kind,
    missed_contacts.missed_at AS clock_at,
    missed_contacts.queue_name,
    missed_contacts.agent_name,
    missed_contacts.reason_label,
    missed_contacts.channel,
    missed_contacts.conversation_id
  FROM rpt.missed_contacts missed_contacts
  WHERE 1 = 1
    AND (CAST(:start AS timestamptz) IS NULL OR missed_contacts.missed_at >= CAST(:start AS timestamptz))
    AND (CAST(:end AS timestamptz) IS NULL OR missed_contacts.missed_at < CAST(:end AS timestamptz))
    AND (CAST(:miss_reason AS text) IS NULL OR missed_contacts.reason_label = CAST(:miss_reason AS text))
    AND (CAST(:agent AS text) IS NULL OR missed_contacts.agent_name = CAST(:agent AS text))
    AND (CAST(:queue AS text) IS NULL OR missed_contacts.queue_name = CAST(:queue AS text))
    AND (
      CAST(:channel AS text) IS NULL
      OR missed_contacts.channel = CAST(:channel AS text)
      OR EXISTS (
        SELECT 1 FROM rpt.conversations c
        WHERE c.id = missed_contacts.conversation_id AND c.channel = CAST(:channel AS text)
      )
    )
    AND (CAST(:conversation_direction AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.direction = CAST(:conversation_direction AS text)))
    AND (CAST(:disposition AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.disposition_label = CAST(:disposition AS text)))
    AND (CAST(:end_actor AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.end_actor = CAST(:end_actor AS text)))
    AND (CAST(:end_reason AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.end_reason = CAST(:end_reason AS text)))
    AND (CAST(:priority AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.priority = CAST(:priority AS integer)))
    AND (CAST(:resolution_code AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.resolution_code = CAST(:resolution_code AS text)))
    AND (CAST(:conversation_status AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.status = CAST(:conversation_status AS text)))
    AND (CAST(:is_reopened AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.is_reopened = CAST(:is_reopened AS boolean)))
    AND (CAST(:is_bot_only AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.is_bot_only = CAST(:is_bot_only AS boolean)))
    AND (CAST(:handler AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.conversations c WHERE c.id = missed_contacts.conversation_id AND c.handler = CAST(:handler AS text)))

  UNION ALL

  SELECT
    'started'::text AS _kind,
    conversations.created_at AS clock_at,
    conversations.queue_name,
    conversations.agent_name,
    NULL::text AS reason_label,
    conversations.channel,
    conversations.id AS conversation_id
  FROM rpt.conversations conversations
  WHERE 1 = 1
    AND (CAST(:start AS timestamptz) IS NULL OR conversations.created_at >= CAST(:start AS timestamptz))
    AND (CAST(:end AS timestamptz) IS NULL OR conversations.created_at < CAST(:end AS timestamptz))
    AND (CAST(:channel AS text) IS NULL OR conversations.channel = CAST(:channel AS text))
    AND (CAST(:conversation_direction AS text) IS NULL OR conversations.direction = CAST(:conversation_direction AS text))
    AND (CAST(:disposition AS text) IS NULL OR conversations.disposition_label = CAST(:disposition AS text))
    AND (CAST(:end_actor AS text) IS NULL OR conversations.end_actor = CAST(:end_actor AS text))
    AND (CAST(:end_reason AS text) IS NULL OR conversations.end_reason = CAST(:end_reason AS text))
    AND (CAST(:priority AS text) IS NULL OR conversations.priority = CAST(:priority AS integer))
    AND (CAST(:resolution_code AS text) IS NULL OR conversations.resolution_code = CAST(:resolution_code AS text))
    AND (CAST(:conversation_status AS text) IS NULL OR conversations.status = CAST(:conversation_status AS text))
    AND (CAST(:agent AS text) IS NULL OR conversations.agent_name = CAST(:agent AS text))
    AND (CAST(:queue AS text) IS NULL OR conversations.queue_name = CAST(:queue AS text))
    AND (CAST(:is_reopened AS text) IS NULL OR conversations.is_reopened = CAST(:is_reopened AS boolean))
    AND (CAST(:is_bot_only AS text) IS NULL OR conversations.is_bot_only = CAST(:is_bot_only AS boolean))
    AND (CAST(:handler AS text) IS NULL OR conversations.handler = CAST(:handler AS text))
) missed_rate_src
WHERE 1 = 1
{{group_by_sql}}

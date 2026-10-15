SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS message_count
FROM ccass.conversation_messages m
LEFT JOIN ccass.conversations c ON c.id = m.conversation_id AND c.organization_id = m.organization_id
LEFT JOIN ccass.queues q ON q.id = c.queue_id
LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
WHERE m.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

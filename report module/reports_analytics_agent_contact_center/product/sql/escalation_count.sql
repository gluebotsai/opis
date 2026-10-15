SELECT
    {{dimension_select}}
    COUNT(DISTINCT t.conversation_id)::bigint AS escalation_count
FROM ccass.agent_tasks t
LEFT JOIN ccass.conversations c ON c.id = t.conversation_id AND c.organization_id = t.organization_id
LEFT JOIN ccass.queues q ON q.id = c.queue_id
LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
WHERE t.organization_id = {org_id}
  AND t.task_type = 'escalation'
  AND t.conversation_id IS NOT NULL
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

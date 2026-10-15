SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS missed_contact_count
FROM ccass.agent_missed_contacts m
LEFT JOIN ccass.queues q ON q.id = m.queue_id
LEFT JOIN ccass.agents a ON a.id = m.agent_id
WHERE m.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

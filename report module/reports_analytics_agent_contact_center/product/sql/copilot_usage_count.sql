SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS copilot_usage_count
FROM ccass.copilot_turns ct
LEFT JOIN ccass.conversations c ON c.id = ct.conversation_id AND c.organization_id = ct.organization_id
LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
WHERE ct.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE t.status = 'completed')::bigint AS completed_callbacks,
    COUNT(*)::bigint AS total_callbacks,
    ROUND(
        COUNT(*) FILTER (WHERE t.status = 'completed')::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS callback_completion_rate
FROM ccass.agent_tasks t
LEFT JOIN ccass.agents a ON a.setup_user_id = t.assigned_user_id AND a.organization_id = t.organization_id
WHERE t.organization_id = {org_id}
  AND t.task_type = 'callback'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

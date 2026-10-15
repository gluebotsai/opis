SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE e.outcome = 'success')::bigint AS success_count,
    COUNT(*)::bigint AS total_executions,
    ROUND(
        COUNT(*) FILTER (WHERE e.outcome = 'success')::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS copilot_tool_success_rate
FROM ccass.copilot_skill_executions e
WHERE e.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

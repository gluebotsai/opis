SELECT
    {{dimension_select}}
    SUM(active_count)::bigint AS total_active,
    SUM(max_concurrency)::bigint AS total_max_concurrency,
    ROUND(
        SUM(active_count)::numeric
        / NULLIF(SUM(max_concurrency), 0),
        4
    ) AS concurrency_utilization
FROM ccass.agent_capacity ac
LEFT JOIN ccass.agents a ON a.id = ac.agent_id
WHERE ac.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE outcome = 'assigned')::bigint AS successful_attempts,
    COUNT(*)::bigint AS total_attempts,
    ROUND(
        COUNT(*) FILTER (WHERE outcome = 'assigned')::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS routing_attempt_success_rate
FROM ccass.routing_attempts ra
LEFT JOIN ccass.queues q ON q.id = ra.queue_id
WHERE ra.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

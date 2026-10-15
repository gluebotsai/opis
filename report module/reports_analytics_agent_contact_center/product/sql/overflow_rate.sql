SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE ov.overflow_queue_id IS NOT NULL)::bigint AS overflow_attempts,
    COUNT(*)::bigint AS total_attempts,
    ROUND(
        COUNT(*) FILTER (WHERE ov.overflow_queue_id IS NOT NULL)::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS overflow_rate
FROM ccass.routing_attempts ra
LEFT JOIN ccass.routing_policies ov
    ON ov.organization_id = ra.organization_id
   AND ov.overflow_queue_id = ra.queue_id
LEFT JOIN ccass.queues q ON q.id = ra.queue_id
WHERE ra.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

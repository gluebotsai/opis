SELECT
    {{dimension_select}}
    ROUND(
        AVG(COALESCE(c.agent_hold_duration, 0) / 1000.0 / 60.0)::numeric,
        2
    ) AS avg_hold_time
FROM ccass.call_cdr c
LEFT JOIN ccass.queues q ON q.id = c.queue_id
WHERE c.domain_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

SELECT
    {{dimension_select}}
    ROUND(
        AVG((COALESCE(c.recording_duration, 0) / 1000.0 + COALESCE(rp.after_contact_work_seconds, 0)) / 60.0)::numeric,
        2
    ) AS avg_handle_time_voice
FROM ccass.call_cdr c
LEFT JOIN ccass.routing_policies rp ON rp.queue_id = c.queue_id AND rp.organization_id = c.domain_id
LEFT JOIN ccass.queues q ON q.id = c.queue_id
WHERE c.domain_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

SELECT
    {{dimension_select}}
    ROUND(AVG(t.latency_ms)::numeric, 1) AS bot_response_latency_avg
FROM ccass.nlp_turns t
LEFT JOIN ccass.conversations c ON c.id = t.conversation_id AND c.organization_id = t.organization_id
LEFT JOIN ccass.queues q ON q.id = c.queue_id
WHERE t.organization_id = {org_id}
  AND t.latency_ms IS NOT NULL
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

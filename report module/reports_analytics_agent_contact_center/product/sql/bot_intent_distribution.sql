SELECT
    {{dimension_select}}
    t.intent,
    COUNT(*)::bigint AS turn_count
FROM ccass.nlp_turns t
LEFT JOIN ccass.conversations c ON c.id = t.conversation_id AND c.organization_id = t.organization_id
LEFT JOIN ccass.queues q ON q.id = c.queue_id
WHERE t.organization_id = {org_id}
  AND t.intent IS NOT NULL
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
GROUP BY t.intent {{group_by_extra}}
ORDER BY turn_count DESC
{{limit_sql}}

SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE t.grounded = true)::bigint AS grounded_count,
    COUNT(*) FILTER (WHERE t.grounded IS NOT NULL)::bigint AS total_evaluated,
    ROUND(
        COUNT(*) FILTER (WHERE t.grounded = true)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE t.grounded IS NOT NULL), 0),
        4
    ) AS bot_grounded_rate
FROM ccass.nlp_turns t
LEFT JOIN ccass.conversations c ON c.id = t.conversation_id AND c.organization_id = t.organization_id
LEFT JOIN ccass.queues q ON q.id = c.queue_id
WHERE t.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

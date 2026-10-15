SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE st.customer_label IN ('negative', 'very_negative'))::bigint AS negative_count,
    COUNT(*) FILTER (WHERE st.customer_label IS NOT NULL)::bigint AS total_scored,
    ROUND(
        COUNT(*) FILTER (WHERE st.customer_label IN ('negative', 'very_negative'))::numeric
        / NULLIF(COUNT(*) FILTER (WHERE st.customer_label IS NOT NULL), 0),
        4
    ) AS negative_sentiment_rate
FROM ccass.conversation_sentiment_turns st
LEFT JOIN ccass.conversations c ON c.id = st.conversation_id AND c.organization_id = st.organization_id
LEFT JOIN ccass.queues q ON q.id = c.queue_id
LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
WHERE st.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

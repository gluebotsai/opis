SELECT
    {{dimension_select}}
    ROUND(AVG(st.customer_score)::numeric, 2) AS sentiment_trend
FROM ccass.conversation_sentiment_turns st
LEFT JOIN ccass.conversations c ON c.id = st.conversation_id AND c.organization_id = st.organization_id
LEFT JOIN ccass.queues q ON q.id = c.queue_id
LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
WHERE st.organization_id = {org_id}
  AND st.customer_score IS NOT NULL
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

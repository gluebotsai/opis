WITH base_conversation AS (
{{base_conversation}}
),
escalated AS (
    SELECT DISTINCT conversation_id
    FROM ccass.agent_tasks
    WHERE organization_id = {org_id}
      AND task_type = 'escalation'
)
SELECT
    {{dimension_select}}
    COUNT(e.conversation_id)::bigint AS escalated_count,
    COUNT(*)::bigint AS total_conversations,
    ROUND(
        COUNT(e.conversation_id)::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS escalation_rate
FROM base_conversation b
LEFT JOIN escalated e ON e.conversation_id = b.conversation_id
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

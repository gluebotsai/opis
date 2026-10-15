WITH base_conversation AS (
{{base_conversation}}
),
transferred AS (
    SELECT DISTINCT conversation_id
    FROM ccass.conversation_transfers
    WHERE organization_id = {org_id}
)
SELECT
    {{dimension_select}}
    COUNT(t.conversation_id)::bigint AS transferred_count,
    COUNT(*)::bigint AS total_conversations,
    ROUND(
        COUNT(t.conversation_id)::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS transfer_rate
FROM base_conversation b
LEFT JOIN transferred t ON t.conversation_id = b.conversation_id
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

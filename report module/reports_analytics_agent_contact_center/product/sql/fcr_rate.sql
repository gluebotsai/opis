WITH base_conversation AS (
{{base_conversation}}
),
resolved_convs AS (
    SELECT *
    FROM base_conversation
    WHERE {{scope_sql}}
      AND {{time_sql}}
      AND {{segment_sql}}
      AND {{filters_sql}}
      AND resolved_at IS NOT NULL
      AND disposition_category IS NOT NULL
      AND contact_id IS NOT NULL
),
recontacted AS (
    SELECT DISTINCT r.conversation_id
    FROM resolved_convs r
    JOIN ccass.conversations c2 ON c2.contact_id = r.contact_id
        AND c2.organization_id = r.organization_id
        AND c2.id != r.conversation_id
        AND c2.created_at > r.resolved_at
        AND c2.created_at <= r.resolved_at + (CASE WHEN r.channel = 'email' THEN INTERVAL '72 hours' ELSE INTERVAL '24 hours' END)
    JOIN ccass.dispositions d2 ON d2.code = c2.disposition_code
        AND d2.organization_id = c2.organization_id
        AND d2.category = r.disposition_category
)
SELECT
    {{dimension_select}}
    (COUNT(*) - COUNT(rc.conversation_id))::bigint AS fcr_met_count,
    COUNT(*)::bigint AS resolved_population,
    ROUND(
        (COUNT(*) - COUNT(rc.conversation_id))::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS fcr_rate
FROM resolved_convs r
LEFT JOIN recontacted rc ON rc.conversation_id = r.conversation_id
{{group_by_sql}}
{{limit_sql}}

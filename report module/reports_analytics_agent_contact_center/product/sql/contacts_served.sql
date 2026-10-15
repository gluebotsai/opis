WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    COUNT(DISTINCT contact_id)::bigint AS contacts_served
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND contact_id IS NOT NULL
{{group_by_sql}}
{{limit_sql}}

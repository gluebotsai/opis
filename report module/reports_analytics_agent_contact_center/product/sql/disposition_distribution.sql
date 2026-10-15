WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    COALESCE(disposition_category, 'uncategorized') AS disposition_category,
    disposition_code,
    COUNT(*)::bigint AS disposition_count
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND disposition_code IS NOT NULL
GROUP BY COALESCE(disposition_category, 'uncategorized'), disposition_code {{group_by_extra}}
{{limit_sql}}

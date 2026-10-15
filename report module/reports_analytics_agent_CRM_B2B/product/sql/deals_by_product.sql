SELECT
  {{dimension_select}}
  COALESCE(ql.product_name, 'Other Products') AS product_name,
  COUNT(DISTINCT q.deal_id)::bigint AS deal_count
FROM rpt.quote_lines ql
JOIN rpt.quotes q ON q.id = ql.quote_id
WHERE q.deal_id IS NOT NULL
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY COALESCE(ql.product_name, 'Other Products'){{extra_group_sql}}
ORDER BY deal_count DESC
{{limit_sql}}

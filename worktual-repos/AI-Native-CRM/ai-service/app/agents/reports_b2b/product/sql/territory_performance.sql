SELECT 
  COALESCE(cl.city, 'Unknown Region') AS city,
  COUNT(d.id)::bigint AS deal_count,
  COALESCE(SUM(d.amount), 0)::numeric(15,2) AS total_amount
FROM rpt.deals d
LEFT JOIN rpt.company_locations cl ON cl.id = d.location_id
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY cl.city
ORDER BY total_amount DESC

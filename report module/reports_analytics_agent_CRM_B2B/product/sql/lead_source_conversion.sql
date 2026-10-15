SELECT 
  COALESCE(lead_source, 'Unknown Source') AS lead_source,
  COUNT(*)::bigint AS total_leads,
  COUNT(*) FILTER (WHERE converted_deal_id IS NOT NULL)::bigint AS converted_leads,
  CASE 
    WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE converted_deal_id IS NOT NULL)::numeric / COUNT(*)::numeric) * 100.0, 2)
    ELSE 0.00
  END AS conversion_rate
FROM rpt.contacts
WHERE is_active = TRUE
  AND contact_type = 'lead'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY lead_source
ORDER BY total_leads DESC

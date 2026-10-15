SELECT
  {{dimension_select}}
  COUNT(*)::bigint AS scheduled_appointments,
  COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed_appointments,
  CASE
    WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE status = 'completed')::numeric / COUNT(*)::numeric) * 100.0, 2)
    ELSE 0.00
  END AS meeting_completion_rate
FROM rpt.appointments
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}

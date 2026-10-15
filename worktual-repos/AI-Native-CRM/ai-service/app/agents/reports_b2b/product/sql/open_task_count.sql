SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS open_task_count,
  COUNT(*) FILTER (WHERE due_at IS NOT NULL AND due_at < NOW())::bigint AS overdue_task_count
FROM rpt.activities
WHERE type = 'task'
  AND task_status IN ('open', 'in_progress')
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}

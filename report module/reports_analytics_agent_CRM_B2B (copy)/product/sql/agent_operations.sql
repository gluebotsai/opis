SELECT 
  job_type,
  status,
  COUNT(*)::bigint AS job_count
FROM rpt.agent_jobs
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY job_type, status
ORDER BY job_type, status

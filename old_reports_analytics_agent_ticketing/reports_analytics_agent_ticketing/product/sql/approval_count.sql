SELECT COUNT(*)::bigint AS approval_count
FROM ticketing.proactive_approvals
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}

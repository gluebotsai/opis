SELECT
    (COUNT(*) FILTER (WHERE status = 'approved')::float
        / NULLIF(COUNT(*) FILTER (WHERE status IN ('approved', 'rejected'))::float, 0)
    ) AS approval_rate
FROM ticketing.proactive_approvals
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
  AND {{filters_sql}}

SELECT
    (COUNT(*) FILTER (
        WHERE lower(status) IN ('approved', 'accepted')
    )::float
        / NULLIF(COUNT(*) FILTER (
            WHERE lower(status) IN ('approved', 'accepted', 'rejected', 'declined', 'denied')
        )::float, 0)
    ) AS approval_rate,
    COUNT(*) FILTER (WHERE lower(status) = 'pending')::bigint AS pending_count,
    COUNT(*)::bigint AS total_approvals
FROM ticketing.proactive_approvals
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
  AND {{filters_sql}}

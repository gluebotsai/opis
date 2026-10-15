-- Shared ticket grain. Python inlines this as the base_ticket CTE body.
-- No aggregations. Status rules use tickets.status only. Never is_terminal.
SELECT
    t.id AS ticket_id,
    t.organization_id,
    t.ticket_number,
    t.status,
    t.priority,
    t.channel,
    t.category,
    t.skill,
    t.customer_id,
    t.customer_name,
    t.assignee_id,
    t.assignee_name,
    t.resolver_id,
    t.resolver_name,
    t.queue_id,
    t.queue_name,
    t.created_by_id,
    t.created_by_name,
    t.due_at,
    t.first_response_at,
    t.resolved_at,
    t.csat_score,
    t.csat_rated_at,
    t.created_at,
    t.updated_at,
    sp.resolution_hours AS sla_resolution_hours,
    sp.first_response_hours AS sla_first_response_hours,
    EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0 AS resolution_hours,
    EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 3600.0 AS first_response_hours,
    EXTRACT(EPOCH FROM (t.resolved_at - t.due_at)) / 3600.0 AS resolution_variance_hours,
    EXTRACT(EPOCH FROM (COALESCE(t.resolved_at, NOW()) - t.due_at)) / 3600.0 AS overdue_hours_so_far,
    (t.status = 'Open') AS is_status_open,
    (t.status = 'Pending') AS is_status_pending_literal,
    (t.status = 'Reopened') AS is_status_reopened,
    (t.status = 'Overdue') AS is_status_overdue,
    (t.status = 'Resolved') AS is_status_resolved,
    (t.status = 'Closed') AS is_status_closed,
    (t.status NOT IN ('Closed', 'Resolved')) AS is_pending_generic,
    (t.assignee_id IS NULL) AS is_unassigned,
    (t.priority = 'high') AS is_high_priority,
    (t.due_at IS NOT NULL) AS has_resolution_due,
    (sp.first_response_hours IS NOT NULL) AS has_first_response_policy,
    (
        t.resolved_at IS NOT NULL
        AND t.due_at IS NOT NULL
        AND t.resolved_at <= t.due_at
    ) AS resolution_sla_met,
    (
        t.due_at IS NOT NULL
        AND (
            (t.resolved_at IS NOT NULL AND t.resolved_at > t.due_at)
            OR (
                t.status NOT IN ('Closed', 'Resolved')
                AND NOW() > t.due_at
            )
            OR (
                t.status IN ('Closed', 'Resolved')
                AND t.resolved_at IS NULL
                AND NOW() > t.due_at
            )
        )
    ) AS resolution_sla_missed,
    (
        t.due_at IS NOT NULL
        AND t.status NOT IN ('Closed', 'Resolved')
        AND NOW() <= t.due_at
        AND EXTRACT(EPOCH FROM (t.due_at - NOW()))
            <= 0.20 * EXTRACT(EPOCH FROM (t.due_at - t.created_at))
        AND EXTRACT(EPOCH FROM (t.due_at - t.created_at)) > 0
    ) AS resolution_at_risk,
    (t.due_at IS NULL) AS resolution_no_sla,
    (
        t.first_response_at IS NOT NULL
        AND sp.first_response_hours IS NOT NULL
        AND t.first_response_at <= t.created_at + (sp.first_response_hours * INTERVAL '1 hour')
    ) AS first_response_sla_met,
    (
        sp.first_response_hours IS NOT NULL
        AND (
            (
                t.first_response_at IS NOT NULL
                AND t.first_response_at > t.created_at + (sp.first_response_hours * INTERVAL '1 hour')
            )
            OR (
                t.first_response_at IS NULL
                AND NOW() > t.created_at + (sp.first_response_hours * INTERVAL '1 hour')
            )
        )
    ) AS first_response_sla_missed,
    (
        t.first_response_at IS NULL
        AND sp.first_response_hours IS NOT NULL
        AND t.status NOT IN ('Closed', 'Resolved')
        AND NOW() <= t.created_at + (sp.first_response_hours * INTERVAL '1 hour')
        AND EXTRACT(EPOCH FROM (
            (t.created_at + (sp.first_response_hours * INTERVAL '1 hour'))
            - NOW()
        )) <= 0.20 * (sp.first_response_hours * 3600.0)
    ) AS first_response_at_risk,
    (sp.first_response_hours IS NULL) AS first_response_no_sla
FROM ticketing.tickets t
LEFT JOIN LATERAL (
    SELECT sp.resolution_hours, sp.first_response_hours
    FROM ticketing.sla_policies sp
    WHERE sp.organization_id = t.organization_id
      AND sp.priority = t.priority
      AND sp.active = true
    ORDER BY sp.id DESC
    LIMIT 1
) sp ON true
WHERE t.organization_id = {{org_id}}

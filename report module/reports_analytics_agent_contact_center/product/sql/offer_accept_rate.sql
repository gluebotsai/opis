WITH offers AS (
    SELECT
        ca.*,
        COALESCE(q.name, 'Unassigned Queue') AS queue_name,
        COALESCE(a.display_name, 'Unassigned') AS agent_name
    FROM ccass.conversation_assignments ca
    LEFT JOIN ccass.queues q ON q.id = ca.queue_id
    LEFT JOIN ccass.agents a ON a.id = ca.agent_id
    WHERE ca.organization_id = {org_id}
)
SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE state = 'accepted')::bigint AS accepted_count,
    COUNT(*)::bigint AS total_offers,
    ROUND(
        COUNT(*) FILTER (WHERE state = 'accepted')::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS offer_accept_rate
FROM offers
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

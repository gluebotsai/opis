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
    ROUND(AVG(EXTRACT(EPOCH FROM (accepted_at - offered_at)) / 60.0)::numeric, 2) AS avg_offer_ring_time
FROM offers
WHERE accepted_at IS NOT NULL
  AND offered_at IS NOT NULL
  AND accepted_at >= offered_at
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}

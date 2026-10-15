WITH presence_raw AS (
    SELECT
        p.agent_id,
        p.new_state AS presence_state,
        p.started_at AS seg_start,
        COALESCE(
            LEAD(p.started_at) OVER (PARTITION BY p.agent_id, p.organization_id ORDER BY p.started_at),
            NOW()
        ) AS seg_end
    FROM ccass.agent_presence_history p
    WHERE p.organization_id = {org_id}
      AND {{scope_sql}}
),
presence_segments AS (
    SELECT
        r.agent_id,
        COALESCE(a.display_name, 'Unassigned') AS agent_name,
        r.presence_state,
        EXTRACT(EPOCH FROM (
            LEAST(r.seg_end, TIMESTAMPTZ '{{time_end}}')
            - GREATEST(r.seg_start, TIMESTAMPTZ '{{time_start}}')
        )) AS duration_seconds
    FROM presence_raw r
    LEFT JOIN ccass.agents a ON a.id = r.agent_id
    WHERE r.seg_end > GREATEST(r.seg_start, TIMESTAMPTZ '{{time_start}}')
      AND r.seg_start < LEAST(r.seg_end, TIMESTAMPTZ '{{time_end}}')
)
SELECT
    {{dimension_select}}
    ROUND(
        SUM(duration_seconds) FILTER (WHERE presence_state IN ('busy', 'after_contact_work'))::numeric
        / NULLIF(SUM(duration_seconds) FILTER (WHERE presence_state != 'offline'), 0),
        4
    ) AS agent_occupancy
FROM presence_segments
WHERE duration_seconds > 0
{{group_by_sql}}
{{limit_sql}}

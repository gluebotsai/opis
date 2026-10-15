WITH presence_raw AS (
    SELECT
        p.agent_id,
        p.reason_code,
        p.started_at AS seg_start,
        COALESCE(
            LEAD(p.started_at) OVER (PARTITION BY p.agent_id, p.organization_id ORDER BY p.started_at),
            NOW()
        ) AS seg_end
    FROM ccass.agent_presence_history p
    WHERE p.organization_id = {org_id}
      AND p.reason_code IS NOT NULL
      AND {{scope_sql}}
),
presence_segments AS (
    SELECT
        r.agent_id,
        COALESCE(a.display_name, 'Unassigned') AS agent_name,
        r.reason_code,
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
    reason_code,
    ROUND(SUM(duration_seconds)::numeric, 1) AS total_duration_seconds,
    ROUND((SUM(duration_seconds) / 3600.0)::numeric, 2) AS total_duration_hours
FROM presence_segments
WHERE duration_seconds > 0
GROUP BY reason_code {{group_by_extra}}
{{limit_sql}}

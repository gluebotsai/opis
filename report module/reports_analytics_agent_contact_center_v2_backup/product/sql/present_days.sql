-- product/sql/present_days.sql
-- Certified present_days. Distinct UTC dates of logged-in presence overlapping the window.
-- Declared filter slots only. No open filters_sql hole.
SELECT
  {{dimension_select}}
  COUNT(DISTINCT gs.day) AS present_days
FROM rpt.presence_history presence_history
CROSS JOIN LATERAL generate_series(
  date_trunc('day', GREATEST(
    presence_history.started_at,
    COALESCE(CAST(:start AS timestamptz), presence_history.started_at)
  ) AT TIME ZONE 'UTC'),
  date_trunc('day', (
    LEAST(
      COALESCE(presence_history.ended_at, now()),
      COALESCE(CAST(:end AS timestamptz), COALESCE(presence_history.ended_at, now()))
    ) - interval '1 microsecond'
  ) AT TIME ZONE 'UTC'),
  interval '1 day'
) AS gs(day)
WHERE 1 = 1
  AND presence_history.new_state IS DISTINCT FROM 'offline'
  AND (CAST(:start AS timestamptz) IS NULL OR COALESCE(presence_history.ended_at, now()) > CAST(:start AS timestamptz))
  AND (CAST(:end AS timestamptz) IS NULL OR presence_history.started_at < CAST(:end AS timestamptz))
  AND (CAST(:agent AS text) IS NULL OR EXISTS (SELECT 1 FROM rpt.agents ag WHERE ag.id = presence_history.agent_id AND ag.display_name = CAST(:agent AS text)))
  AND (CAST(:presence_state AS text) IS NULL OR presence_history.new_state = CAST(:presence_state AS text))
  AND (CAST(:shift AS text) IS NULL OR EXISTS (
      SELECT 1 FROM rpt.queue_members qm
      WHERE qm.agent_id = presence_history.agent_id
        AND qm.shift_type = CAST(:shift AS text)
    ))
{{group_by_sql}}

-- product/sql/occupancy.sql
-- Certified occupancy. Clip presence intervals to the UTC window. No open filters_sql hole.
SELECT
  {{dimension_select}}
  SUM(GREATEST(0, EXTRACT(EPOCH FROM (
      LEAST(COALESCE(presence_history.ended_at, now()), COALESCE(CAST(:end AS timestamptz), now()))
      - GREATEST(presence_history.started_at, COALESCE(CAST(:start AS timestamptz), presence_history.started_at))
    )))) FILTER (WHERE presence_history.new_state IN ('busy', 'after_contact_work')) AS busy_acw_seconds,
  SUM(GREATEST(0, EXTRACT(EPOCH FROM (
      LEAST(COALESCE(presence_history.ended_at, now()), COALESCE(CAST(:end AS timestamptz), now()))
      - GREATEST(presence_history.started_at, COALESCE(CAST(:start AS timestamptz), presence_history.started_at))
    )))) FILTER (WHERE presence_history.new_state IN ('ready', 'not_ready', 'busy', 'break', 'away', 'after_contact_work')) AS logged_in_seconds
FROM rpt.presence_history presence_history
WHERE 1 = 1
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

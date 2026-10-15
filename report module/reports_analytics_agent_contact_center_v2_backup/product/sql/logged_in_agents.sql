-- product/sql/logged_in_agents.sql
-- Certified logged_in_agents. Live presence in ready/not_ready/busy/break/away/after_contact_work.
-- Declared filter slots only. No open filters_sql hole.
SELECT
  {{dimension_select}}
  COUNT(*) AS logged_in_agents
FROM rpt.agents agents
JOIN rpt.presence presence ON presence.agent_id = agents.id
WHERE 1 = 1
  AND presence.presence_state IN ('ready', 'not_ready', 'busy', 'break', 'away', 'after_contact_work')
  AND (CAST(:agent AS text) IS NULL OR agents.display_name = CAST(:agent AS text))
  AND (CAST(:presence_state AS text) IS NULL OR presence.presence_state = CAST(:presence_state AS text))
  AND (CAST(:shift AS text) IS NULL OR EXISTS (
      SELECT 1 FROM rpt.queue_members qm
      WHERE qm.agent_id = agents.id
        AND qm.shift_type = CAST(:shift AS text)
    ))
{{group_by_sql}}

SELECT COUNT(*)::bigint AS active_agents
FROM ticketing.agents
WHERE organization_id = {{org_id}}
  AND status = 'Active'
  AND role = 'agent'

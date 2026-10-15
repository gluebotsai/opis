SELECT
    COUNT(*)::bigint AS active_agents
FROM ccass.agents a
WHERE a.organization_id = {org_id}
  AND a.status = 'active'
{{limit_sql}}

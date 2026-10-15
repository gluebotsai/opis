SELECT COUNT(*)::bigint AS total_users
FROM ticketing.agents
WHERE organization_id = {{org_id}}

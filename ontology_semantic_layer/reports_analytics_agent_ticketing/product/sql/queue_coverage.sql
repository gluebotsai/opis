SELECT COUNT(*)::bigint AS queue_coverage
FROM ticketing.agent_queue_members
WHERE organization_id = {{org_id}}

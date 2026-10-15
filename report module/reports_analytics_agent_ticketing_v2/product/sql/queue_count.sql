SELECT COUNT(*)::bigint AS queue_count
FROM ticketing.agent_queues
WHERE organization_id = {{org_id}}

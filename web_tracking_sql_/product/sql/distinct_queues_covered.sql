SELECT COUNT(DISTINCT queue_id)::bigint AS distinct_queues_covered
FROM ticketing.agent_queue_members
WHERE organization_id = {{org_id}}

SELECT COUNT(DISTINCT user_id)::bigint AS distinct_agents_in_queues
FROM ticketing.agent_queue_members
WHERE organization_id = {{org_id}}

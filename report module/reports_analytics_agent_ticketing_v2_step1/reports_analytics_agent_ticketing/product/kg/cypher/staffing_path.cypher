MATCH (q:Queue)
WHERE true
  AND {{scope_cypher}}
OPTIONAL MATCH (q)-[:staffed_by]->(a:Agent)
RETURN q.id AS queue_id,
       q.queue_name AS queue_name,
       a.id AS agent_id,
       a.support_email AS agent_email,
       a.role AS agent_role
ORDER BY q.queue_name
LIMIT {{limit}}

MATCH (q:SupportQueue)
WHERE true
  AND {{scope_cypher}}
OPTIONAL MATCH (a:SupportAgent)-[:MEMBER_OF]->(q)
RETURN q.id AS queue_id,
       q.queue_name AS queue_name,
       a.id AS agent_id,
       coalesce(a.display_name, a.support_email) AS agent_name,
       a.support_email AS agent_email,
       a.role AS agent_role
ORDER BY q.queue_name
LIMIT {{limit}}

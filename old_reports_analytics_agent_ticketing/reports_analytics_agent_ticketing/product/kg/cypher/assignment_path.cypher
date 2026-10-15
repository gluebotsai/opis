MATCH (t:Ticket)
WHERE true
  AND {{scope_cypher}}
  AND {{time_cypher}}
  AND {{segment_cypher}}
OPTIONAL MATCH (t)-[:in_queue]->(q:Queue)
OPTIONAL MATCH (t)-[:assigned_to]->(a:Agent)
RETURN t.id AS ticket_id,
       t.ticket_number AS ticket_number,
       t.status AS status,
       t.assignee_id AS assignee_id,
       t.assignee_name AS assignee_name,
       t.queue_id AS queue_id,
       q.queue_name AS queue_name,
       a.support_email AS assignee_email
ORDER BY t.created_at DESC
LIMIT {{limit}}

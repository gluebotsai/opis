MATCH (t:Ticket)
WHERE true
  AND {{scope_cypher}}
  AND {{time_cypher}}
  AND {{segment_cypher}}
OPTIONAL MATCH (t)-[:in_queue]->(q:Queue)
OPTIONAL MATCH (t)-[:assigned_to]->(aa:Agent)
OPTIONAL MATCH (t)-[:resolved_by]->(ra:Agent)
OPTIONAL MATCH (t)-[:has_sla]->(s:SLA)
OPTIONAL MATCH (t)-[:has_note]->(n:Note)
WITH t, q, aa, ra, s, collect(DISTINCT n.id)[0..10] AS note_ids
RETURN t.id AS ticket_id,
       t.ticket_number AS ticket_number,
       t.subject AS subject,
       t.status AS status,
       t.priority AS priority,
       t.assignee_id AS assignee_id,
       t.resolver_id AS resolver_id,
       t.queue_id AS queue_id,
       q.queue_name AS queue_name,
       aa.support_email AS assignee_email,
       ra.support_email AS resolver_email,
       s.display_name AS sla_name,
       note_ids
ORDER BY t.created_at DESC
LIMIT {{limit}}

MATCH (t:Ticket)
WHERE true
  AND {{scope_cypher}}
  AND {{time_cypher}}
  AND {{segment_cypher}}
OPTIONAL MATCH (t)-[:ROUTED_TO]->(q:SupportQueue)
OPTIONAL MATCH (t)-[:ASSIGNED_TO]->(aa:SupportAgent)
OPTIONAL MATCH (t)-[:RESOLVED_BY]->(ra:SupportAgent)
OPTIONAL MATCH (t)-[:GOVERNED_BY]->(s:SupportSLA)
OPTIONAL MATCH (t)-[:HAS]->(n:Note)
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

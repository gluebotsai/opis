MATCH (t:Ticket)
WHERE true
  AND {{scope_cypher}}
  AND {{time_cypher}}
  AND {{segment_cypher}}
OPTIONAL MATCH (t)-[:raised_by]->(c:Contact)
RETURN t.id AS ticket_id,
       t.ticket_number AS ticket_number,
       t.customer_id AS customer_id,
       t.customer_name AS customer_name,
       c.id AS contact_id,
       c.cdp_id AS cdp_id
ORDER BY t.created_at DESC
LIMIT {{limit}}

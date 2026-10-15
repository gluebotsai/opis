MATCH (t:Ticket)
WHERE true
  AND {{scope_cypher}}
  AND {{time_cypher}}
  AND {{segment_cypher}}
MATCH (t)-[:has_note]->(n:Note)
OPTIONAL MATCH (n)-[:written_by]->(a:Agent)
RETURN t.id AS ticket_id,
       t.ticket_number AS ticket_number,
       n.id AS note_id,
       n.visibility AS visibility,
       n.author_id AS author_id,
       a.support_email AS author_email,
       n.created_at AS note_created_at
ORDER BY n.created_at DESC
LIMIT {{limit}}

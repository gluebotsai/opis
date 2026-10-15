MATCH (t:Ticket)
WHERE true
  AND {{scope_cypher}}
  AND {{time_cypher}}
  AND {{segment_cypher}}
{{hop_match}}
RETURN {{dimension_select}}
       count(t) AS ticket_count
ORDER BY ticket_count DESC
LIMIT {{limit}}

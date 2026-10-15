# Skill: `analytics-graph-path`

## Role & Description
Executes multi-hop graph traversals across CCaaS nodes, ensuring correct directed relationships, schema allowlist compliance, and strict product fencing.

---

## Canonical Graph Patterns

### 1. Channel Multilabel Traversal
Match conversations by specific channel labels:
```cypher
MATCH (c:Conversation:ContactCentre)
WHERE c:ChatConversation OR c:EmailConversation OR c:WhatsAppConversation 
   OR c:FacebookConversation OR c:InstagramConversation
RETURN coalesce(c.channel, 'unknown') AS channel,
       count(c) AS conversation_volume,
       round(avg(duration.between(c.created_at, c.ended_at).seconds) / 60.0, 2) AS avg_duration_minutes
GROUP BY channel
ORDER BY conversation_volume DESC
LIMIT 10
```

### 2. Queue & Agent Routing Paths
Traverse conversations through queues to assigned human agents:
```cypher
MATCH (c:Conversation)-[:ROUTED_TO]->(q:ContactCentreQueue)
OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:ContactCentreAgent)
RETURN coalesce(q.name, 'Queue ' + toString(q.id)) AS queue_name,
       coalesce(a.display_name, a.email, 'Unassigned') AS agent_name,
       count(c) AS total_handled,
       round(avg(duration.between(c.created_at, c.ended_at).seconds) / 60.0, 2) AS avg_duration_minutes
ORDER BY total_handled DESC
LIMIT 20
```

### 3. Customer CDP Journey Traversal
Cross-channel history traversal starting from shared customer profile:
```cypher
MATCH (ct:Contact {cdp_id: $contact_id})-[:HAS_CONVERSATION_HISTORY]->(:ConversationHistory)-[:HAS_CONVERSATION]->(c:Conversation)
RETURN ct.cdp_id AS customer_id,
       coalesce(ct.first_name + ' ' + ct.last_name, 'Customer') AS customer_name,
       c.id AS conversation_id,
       c.channel AS channel,
       c.status AS status,
       c.created_at AS session_start,
       c.end_reason AS outcome
ORDER BY c.created_at DESC
LIMIT 20
```

---

## Directives
1. **Always Use Directed Hops**: Specify `(from)-[:REL]->(to)`. Undirected `(--)` hops are strictly blocked.
2. **Never Hop to Forbidden Entities**: Prohibit traversals from `Contact` to `Ticket`, `Deal`, or `Campaign`.

# Skill: `analytics-root-cause-attribution`

## Role & Description
Executes deep causal diagnosis of why conversations failed, dropped, remained unresolved, or experienced transfer churn. Relies strictly on verified telemetry fields (`end_actor`, `end_reason`, `disposition_code`, `facts`, `[:MissedContact]`).

---

## Canonical Graph Patterns

### 1. Hard Telemetry Audit for Unresolved Sessions
Breakdown by disconnect actor and reason:
```cypher
MATCH (c:Conversation)
WHERE toLower(c.resolution_code) = 'unresolved'
OPTIONAL MATCH (c)-[:ROUTED_TO]->(q:ContactCentreQueue)
OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:ContactCentreAgent)
RETURN coalesce(q.name, 'Queue ' + toString(c.queue_id)) AS queue_name,
       coalesce(a.display_name, 'Unassigned') AS agent_name,
       coalesce(c.end_actor, 'system') AS disconnect_actor,
       coalesce(c.end_reason, 'unspecified') AS disconnect_reason,
       coalesce(c.disposition_code, 'none') AS disposition,
       count(c) AS unresolved_volume,
       round(avg(duration.between(c.created_at, c.ended_at).seconds) / 60.0, 2) AS avg_duration_minutes,
       collect(DISTINCT c.custom_conclusion)[..3] AS sample_agent_notes
ORDER BY unresolved_volume DESC
LIMIT 20
```

### 2. Bot Escalation & Missed Contact Root Cause
Identify handoff failures and reason codes:
```cypher
MATCH (c:Conversation)
WHERE c.handoff_reason IS NOT NULL OR exists((c)-[:HAS]->(:MissedContact))
OPTIONAL MATCH (c)-[:HAS]->(mc:MissedContact)
OPTIONAL MATCH (c)-[:ROUTED_TO]->(q:ContactCentreQueue)
RETURN c.id AS conversation_id,
       c.channel AS channel,
       c.handoff_reason AS escalation_trigger,
       coalesce(mc.reason, 'none') AS missed_reason,
       coalesce(mc.custom_reasonCode, 'none') AS missed_reason_code,
       coalesce(q.name, 'Support Queue') AS queue_name,
       c.facts AS telemetry_facts,
       c.end_actor AS end_actor,
       c.end_reason AS end_reason
ORDER BY c.id DESC
LIMIT 20
```

---

## Directives
1. **No Speculation**: Never claim "network drops" unless recorded in `c.facts` or error fields.
2. **Channel Separation**: Always separate duration by `c.channel` (never mix asynchronous email with real-time call/chat).

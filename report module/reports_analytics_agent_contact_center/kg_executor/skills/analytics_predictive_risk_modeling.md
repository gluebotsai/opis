# Skill: `analytics-predictive-risk-modeling`

## Role & Description
Extracts leading graph signals and operational bottleneck indicators to model forward-looking operational risk (Queue Overflow, Abandonment Forecast, Repeat Contact Loops, SLA Exposure).

---

## Canonical Graph Patterns

### 1. Queue Overflow & Agent Shortage Risk
Quantifies queues with high concentrations of `no_ready_agents` or `live_agent_unavailable`:
```cypher
MATCH (c:Conversation)-[:ROUTED_TO]->(q:ContactCentreQueue)
WHERE any(f IN coalesce(c.facts, []) WHERE f IN ['live_agent_unavailable', 'no_ready_agents'])
RETURN coalesce(q.name, 'Queue ' + toString(q.id)) AS bottleneck_queue,
       count(c) AS total_failure_events,
       count(CASE WHEN any(f IN coalesce(c.facts, []) WHERE f = 'no_ready_agents') THEN 1 END) AS no_ready_agents_count,
       count(CASE WHEN any(f IN coalesce(c.facts, []) WHERE f = 'live_agent_unavailable') THEN 1 END) AS agent_unavailable_count,
       round(avg(duration.between(c.created_at, c.ended_at).seconds) / 60.0, 2) AS avg_wait_minutes
ORDER BY total_failure_events DESC
LIMIT 15
```

### 2. Transfer Churn & Chained Session Loops
Measures session continuations and escalation loops predicting repeat customer friction:
```cypher
MATCH (c1:Conversation)-[:CONTINUES]->(c2:Conversation)
WITH c1, c2,
     coalesce(c1.facts, c2.facts, []) AS combined_facts,
     coalesce(c1.handoff_reason, c2.handoff_reason, 'none') AS handoff_reason
RETURN c1.id AS origin_session,
       c2.id AS continuation_session,
       c1.channel AS channel,
       handoff_reason,
       combined_facts AS failure_facts,
       c1.end_reason AS origin_end_reason,
       c2.end_reason AS target_end_reason
ORDER BY CASE WHEN size(combined_facts) > 0 THEN 0 ELSE 1 END, c1.id DESC
LIMIT 20
```

---

## Directives
1. **Focus on Leading Indicators**: Query failure flags and transfer chains rather than just static outcome totals.
2. **Division Safety**: Always wrap ratio calculations with `CASE WHEN total > 0 THEN ... ELSE 0.0 END`.

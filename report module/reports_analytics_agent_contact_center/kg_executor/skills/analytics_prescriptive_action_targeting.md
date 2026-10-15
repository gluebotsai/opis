# Skill: `analytics-prescriptive-action-targeting`

## Role & Description
Joins operational schedules, shifts, business hours, and queue configurations to identify actionable levers and specific operational recommendations.

---

## Canonical Graph Patterns

### 1. Shift Schedule & Coverage Window Analysis
Correlates conversation load and unavailability with specific shift hours:
```cypher
MATCH (bh:BusinessHours)-[:HAS_SHIFT]->(sh:Shift)
RETURN bh.name AS schedule_name,
       bh.timezone AS timezone,
       sh.day_of_week AS day_of_week,
       sh.shift_type AS shift_type,
       sh.start_time AS shift_start,
       sh.end_time AS shift_end
ORDER BY sh.day_of_week, sh.start_time
LIMIT 20
```

### 2. Queue Configuration & Routing Optimization Target
Identifies specific queues needing routing adjustments or timeout tuning:
```cypher
MATCH (q:ContactCentreQueue)
OPTIONAL MATCH (c:Conversation)-[:ROUTED_TO]->(q)
RETURN q.id AS queue_id,
       coalesce(q.name, q.queue_name, 'Queue ' + toString(q.id)) AS queue_name,
       q.status AS queue_status,
       count(c) AS total_routed,
       count(CASE WHEN c.end_reason = 'idle_timeout' THEN 1 END) AS timeout_disconnects,
       count(CASE WHEN exists((c)-[:HAS]->(:MissedContact)) THEN 1 END) AS missed_contacts_logged
ORDER BY total_routed DESC
LIMIT 15
```

---

## Directives
1. **Concrete Action Targets**: Always identify exact queue names, shift intervals, or agent profiles rather than vague general advice.
2. **Channel Strategy**: Distinguish real-time queues from asynchronous email routing to propose proper queue decoupling.

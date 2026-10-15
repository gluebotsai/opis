# Skill: `hierarchical-duration-engine`

## Overview & Purpose
Enforces mathematical precision and channel segregation when calculating, aggregating, and formatting handle times, queue wait times, and conversation durations.

---

## 1. Channel Duration Segregation Rule
Asynchronous channels (like `EmailConversation` with handle durations of ~5.5 hours) must **never be averaged together** with real-time channels (like `call` and `ChatConversation` with handle durations of ~2.9 minutes).

```cypher
MATCH (c:Conversation)
WHERE c.created_at IS NOT NULL AND c.ended_at IS NOT NULL
RETURN coalesce(c.channel, 'all') AS channel,
       count(c) AS conversations_measured,
       round(avg(duration.between(c.created_at, c.ended_at).seconds) / 60.0, 2) AS avg_duration_minutes,
       round(avg(duration.between(c.created_at, c.ended_at).seconds), 1) AS avg_duration_seconds
ORDER BY conversations_measured DESC
LIMIT 10
```

---

## 2. Hierarchical Duration Formatting Rules

When presenting duration metrics, format dynamically based on magnitude:

| Duration Range | Format | Example Presentation |
| :--- | :--- | :--- |
| **< 60 seconds** | `X sec` | `40 sec` |
| **60 sec to < 60 mins** | `X min Y sec` | `55 min 20 sec` |
| **60 mins to < 24 hours** | `X hour(s) Y min Z sec` | `1 hour 33 min 5 sec` |
| **≥ 24 hours** | `X day(s) Y hour(s) Z min W sec` | `5 days 3 hours 4 min 10 sec` |

---

## 3. Cypher Mathematical Standards
1. **Always Provide Raw Seconds & Minutes**: Include both `duration_seconds` and `duration_minutes` in Cypher returns.
2. **Standard Formula**:
   ```cypher
   MATCH (c:Conversation)
   RETURN round(avg(duration.between(c.created_at, c.ended_at).seconds) / 60.0, 2) AS avg_duration_minutes
   LIMIT 10
   ```

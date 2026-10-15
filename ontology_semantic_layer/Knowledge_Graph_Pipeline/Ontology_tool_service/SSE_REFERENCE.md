# SSE Streaming Reference

## Overview

`POST /chat/stream` returns a Copilot-style Server-Sent Events stream. Each frame uses a named `event` and a JSON `data` payload.

```
event: <name>
data: <json>

```

---

## Events

### `status`

Progress loader — phase + human label.

```json
{"phase": "understanding", "label": "Understanding your question…"}
```

| Phase | When |
|-------|------|
| `understanding` | Turn start |
| `concepts` | Business concept / schema lookup |
| `planning` | LLM planning before tools |
| `querying` | Cypher query being written |
| `fetching` | Knowledge graph query running |
| `writing` | Final answer |
| `tool` | Other tools |

---

### `activity`

Step timeline for UI cards (understand → concepts → analysis → response).

```json
{
  "step_id": "analysis",
  "status": "running",
  "title": "Analyzing & calculating",
  "description": "Running analysis for: missed contacts…"
}
```

`status`: `pending` | `running` | `completed`

---

### `tool_call`

Emitted before each tool executes.

```json
{
  "id": "call_a1b2c3d4e5f6",
  "name": "knowledge_graph",
  "arguments": {"cypher_query": "MATCH … RETURN … LIMIT 50"}
}
```

---

### `block`

Tool card state (running → success / error).

```json
{
  "tool": "knowledge_graph",
  "status": "success",
  "label": "Query · MATCH (c:Contact)…",
  "summary": "12 rows returned"
}
```

`status`: `running` | `success` | `error`

---

### `text_delta`

Answer chunks (streamed in ~48 char pieces).

```json
{"delta": "Based on this week", "content": "Based on this week"}
```

Clients should append `delta` (or `content`) to build the full answer.

---

### `error`

```json
{"message": "Connection to Neo4j failed"}
```

---

### `done`

```json
{"elapsed_seconds": 18.432, "turnId": "550e8400-e29b-41d4-a716-446655440000"}
```

---

## Example stream

```
event: status
data: {"phase":"understanding","label":"Understanding your question…"}

event: activity
data: {"step_id":"concepts","status":"running","title":"Finding relevant metrics","description":"Searching concepts: missed contacts…"}

event: status
data: {"phase":"concepts","label":"Found: Missed Contacts, Contact Volume"}

event: status
data: {"phase":"planning","label":"Planning the analysis…"}

event: status
data: {"phase":"querying","label":"Writing the analytics query…"}

event: status
data: {"phase":"fetching","label":"Fetching: MATCH (c:Contact) WHERE …"}

event: tool_call
data: {"id":"call_abc123","name":"knowledge_graph","arguments":{"cypher_query":"MATCH …"}}

event: block
data: {"tool":"knowledge_graph","status":"running","label":"Query · MATCH (c:Contact)…"}

event: block
data: {"tool":"knowledge_graph","status":"success","label":"Query · MATCH (c:Contact)…","summary":"12 rows returned"}

event: status
data: {"phase":"writing","label":"Writing my reply…"}

event: text_delta
data: {"delta":"Missed contacts increased by 18% this week","content":"Missed contacts increased by 18% this week"}

event: done
data: {"elapsed_seconds":22.1,"turnId":"…"}
```

---

## Server flow

```
POST /chat/stream
  → yield status(understanding) immediately
  → Generate_response() in thread pool
       on_status(phase, label)
       on_activity(step events)
       on_tool_call → tool_call + block(running)
       on_tool_result → block(success|error)
  → queue drained via asyncio (thread-safe)
  → yield status(writing) + text_delta chunks + done
```

Key files: `src/sse_events.py`, `src/response.py`, `fastapi_service/main.py`

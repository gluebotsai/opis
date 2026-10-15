# Observability log formats (portable spec)

This document describes the **day-rotated log files** used by the Ticketing `ai-agents` service. Use it to implement the same tracing in another project without reading the Python sources.

**Design goals**

- One file per calendar day (UTC), append-only.
- **Never raise** from logging — chat and APIs must not fail because a disk write failed.
- Thread-safe appends (`fcntl` or a process-wide lock).
- Redact secrets in tool args, context payloads, and A2A JSON (`password`, `secret`, `token`, `api_key`, `authorization`, etc.).
- **Agent-turn** logs are human-readable blocks with a **LIVE** section that streams as the turn runs; **LLM** and **A2A** logs use a simpler block or JSON-line layout.

**Reference implementation**

| Log | Module |
|-----|--------|
| Agent turn | `ai-agents/app/observability/turn_log.py` |
| LLM / native trace | `ai-agents/app/llm_log.py`, `ai-agents/app/observability/logging.py` |
| A2A spoke | `ai-agents/app/a2a/log.py` |

**Directory (default)** `ai-agents/logs/`

---

## 1. Agent turn log (`agent-turn-YYYY-MM-DD.log`)

Primary trace for **staff coworker** multi-agent turns (Super → Domain → Executor).

### File naming

```
agent-turn-{YYYY-MM-DD}.log
```

Example: `agent-turn-2026-10-02.log`

### Console mirror

When `agent_turn_console` is true (default), each `_emit_live` line is also printed to stdout (same text as the file). Disable via settings/env if your other project only wants files.

### Block structure (one user message = one turn)

Each turn is a sequence:

1. **Header** (written at `begin_turn`)
2. **LIVE** lines (streaming, same file, during the turn)
3. **Closer** (written at `finish_turn`): `FINAL RESPONSE`, optional `ERROR`, `TOTAL` timings, closing `====` line

Between turns, unrelated **CONTEXT LAYER** lines may appear if another worker (e.g. proactive agent) called ontology without an active turn context — those use the same LIVE line format but sit outside an `AGENT TURN` header.

#### Header

```
========================================================================================
AGENT TURN  {YYYY-MM-DD HH:MM:SS} UTC
request_id={id}  session={session_id}  org={organization_id}  user={user_id}
----------------------------------------------------------------------------------------
USER QUERY
  {user text, one or more lines indented with two spaces}

LIVE
```

- `request_id`: correlates with HTTP/API request (e.g. `req_muqf1thv_vvu9cnld`).
- `session`: durable chat session id (e.g. `cw_1033_c562b68a-686f-400f-ae94-15188cde6939`).
- `org` / `user`: tenant and staff user ids as strings; use `-` when unknown.

#### LIVE line prefix

Every live event starts with:

```
  [{HH:MM:SS.mmm}] {EVENT_TYPE}  ...
```

- Timestamp is **UTC** with millisecond precision (`%H:%M:%S.%f` truncated to 3 ms digits).
- Two spaces after the closing `]` before the event type.

#### LIVE event types

| Event | Format | When |
|-------|--------|------|
| **STEP** | `STEP  {n}. {Agent display label}` | An agent joins the turn (Super, Domain, Executor). Harness-only ids (`ticketing_coworker`, `supervisor`) are omitted from STEP/labels. |
| **ROUTE** | `ROUTE {from} → {to}` optional `  query={delegation task}` | Domain delegates to Executor or Super routes to Domain. |
| **LLM** (wait) | `LLM   {agent}  waiting` | Immediately before the LLM HTTP call. |
| **LLM** (done) | `LLM   {agent}  {duration}  {kind}` optional `  {note}` | After LLM returns. `duration` is `Xs` or `X.XXs` if &lt; 10s. `kind` is usually `chat`; `note` may be `reply` or tool-related hint. |
| **TOOL** | See below | After each MCP/tool call completes. |
| **CONTEXT LAYER** | See below | Ontology slice, semantic query, SQL layer, etc. |

**Agent display labels** (optional map in your project): e.g. `ticketing_super_agent` → `Super Agent (ticketing_super_agent)`.

##### TOOL block

```
  [{time}] TOOL  [{index}] {Agent label}  {tool_name}
      args:
        {pretty-printed JSON, each line indented 8 spaces}
      TOOL RESPONSE
        {pretty-printed JSON or text, clipped}
```

- `index` is 1-based per turn.
- Args and response pass through **redact** then **pretty JSON** (indent 2). Strings that are JSON are parsed and re-pretty-printed.
- **Clip limit**: tool body default **6000** characters; append `… [truncated N chars]`.

##### CONTEXT LAYER block

**Ontology slice** (privacy: never log response body):

Calling:

```
  [{time}] CONTEXT LAYER  ontology_slice  calling
      url: {full URL}
      payload:
        {redacted JSON, indented}
```

Received:

```
  [{time}] CONTEXT LAYER  ontology_slice  received  status={http_code}
```

Or on failure:

```
  [{time}] CONTEXT LAYER  ontology_slice  received  error: {message}
```

**Other endpoints** (semantic_query, sql_query, etc.) — log full request and response (redacted, clipped):

```
  [{time}] CONTEXT LAYER  {endpoint_name}
      url: {url}
      payload:
        {json}
      response  status={code}
        {response body, clipped}
```

Or `error: {message}` instead of response.

#### Closer (`finish_turn`)

After the last LIVE line, append:

```
FINAL RESPONSE  (agent: {Agent label})
{assistant text or HTML; clipped to 8000 chars default}

ERROR: {message}                    # optional

TOTAL  wall={wall_time}  llm={sum_llm}  calls={n_llm_calls}
  {Agent label}  {that_agent_llm_sum}  ({m} call|calls)
  ... one summary line per agent that had LLM hops ...
========================================================================================

```

- `wall` = time from `begin_turn` to `finish_turn`.
- `llm` = sum of all `record_llm_hop` durations.
- Per-agent lines repeat only for agents present in `llm_hops`.

#### Optional full summary block

The same trace can be formatted as a **non-live** summary (`format_turn`) with sections `ATTENDING AGENT`, `ROUTED TO`, `TOOLS`, `LLM TIMING` — useful for batch replay or tests. Production staff chat uses **header + LIVE + closer** only in the daily file.

### Lifecycle API (implement in your project)

| Hook | Responsibility |
|------|----------------|
| `begin_turn(user_query, session_id, request_id, organization_id, user_id, start_agent)` | Create context var / struct; emit header + `LIVE`; optionally emit STEP for `start_agent`. |
| `record_attending_agent(name)` | STEP when agent changes. |
| `record_route(from, to, query?)` | ROUTE + STEP for `to`. |
| `record_llm_start(agent?)` | LLM waiting line. |
| `record_llm_hop(ms, agent?, kind?, note?)` | LLM completed line; accumulate timing. |
| `record_tool(name, arguments, result, agent?)` | TOOL block. |
| `record_context_layer(endpoint, url, payload, status?, response?, error?, phase?)` | CONTEXT LAYER rules above. |
| `finish_turn(final_response, final_agent?, error?)` | Closer + clear context; return optional full text for tests. |

### Example (minimal turn)

```
========================================================================================
AGENT TURN  2026-10-02 03:41:26 UTC
request_id=req_muqf1thv_vvu9cnld  session=cw_1033_c562b68a-686f-400f-ae94-15188cde6939  org=1012  user=1033
----------------------------------------------------------------------------------------
USER QUERY
  hello

LIVE
  [03:41:28.994] STEP  1. Super Agent (ticketing_super_agent)
  [03:41:28.995] LLM   Super Agent (ticketing_super_agent)  waiting
  [03:41:31.086] LLM   Super Agent (ticketing_super_agent)  2.09s  chat  reply

FINAL RESPONSE  (agent: Super Agent (ticketing_super_agent))
<p>Hi there! How can I help you today?</p>

TOTAL  wall=5.63s  llm=2.09s  calls=1
  Super Agent (ticketing_super_agent)  2.09s  (1 call)
========================================================================================
```

### Example (tool + route)

```
  [04:12:01.100] ROUTE Super Agent (ticketing_super_agent) → Domain (catalog) (catalog_administration_domain)
  [04:12:01.101] STEP  2. Domain (catalog) (catalog_administration_domain)
  [04:12:02.200] ROUTE Domain (catalog) (catalog_administration_domain) → team_queue_crud_executor  query=List members for Offers & Loyalty Support
  [04:12:02.201] STEP  3. team_queue_crud_executor
  [04:12:03.500] TOOL  [1] team_queue_crud_executor  list_queues
      args:
        {
          "query": "Offers & Loyalty Support"
        }
      TOOL RESPONSE
        {
          "data": [ ... ]
        }
```

### Constants to copy

| Constant | Value | Purpose |
|----------|-------|---------|
| Separator width | 88 | `=` and `-` rules |
| `_MAX_TOOL_CHARS` | 6000 | Tool + non-slice context response |
| `_MAX_REPLY_CHARS` | 8000 | Final response |

---

## 2. LLM log (`llm-YYYY-MM-DD.log`)

**All** LLM-ish traffic in one file: staff chat model calls, proactive agents, `express_tool` wrappers, `native_*` events from `trace_run`.

### File naming

```
llm-{YYYY-MM-DD}.log
```

### Block structure

```
========================================================================================
{YYYY-MM-DD HH:MM:SS} UTC | kind={kind} | agent={agent} | page={page} | session={session} | org={org} | user={user} | model={model} | secs={human} | ms={integer}
----------------------------------------------------------------------------------------
USER:
{prompt or request summary}

RESPONSE:
{model output or HTTP summary}

ERROR: {message}                     # optional
========================================================================================

```

- Missing dimensions use `-`.
- `secs` omitted if `ms` not provided.
- `kind` examples: `chat`, `express_tool`, `native_{event}`.
- No redaction helper in `llm_log.py` itself — callers should avoid logging raw secrets in `user_text` / `response`.

### API

```text
log_llm(
  kind,
  response,
  user_text="",
  agent=None,
  page=None,
  session_id=None,
  organization_id=None,
  user_id=None,
  model=None,
  error=None,
  ms=None,
)
```

---

## 3. A2A spoke logs (`a2a-YYYY-MM-DD.log` + `.json`)

Hub ↔ ticketing **Agent-to-Agent** channel; structured JSON for parsing and a human `.log` with the same payload.

### File naming

```
a2a-{YYYY-MM-DD}.log    # logging.Formatter: "%(asctime)s %(levelname)s %(message)s"
a2a-{YYYY-MM-DD}.json   # one JSON object per line (JSONL)
```

### `.log` line shape

```
2026-10-02 12:34:56,789 INFO {"agent": "a2a-spoke", "step": "invoke", ...}
```

- `INFO` when `ok: true`, `ERROR` when `ok: false`.
- `message` is a single-line JSON string (no pretty print).

### JSON object schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | yes | Fixed `"a2a-spoke"` (or your spoke name). |
| `step` | string | yes | `ready`, `token`, `invoke`, `receipt`, or custom. |
| `channel` | string | yes | `"a2a"`. |
| `ok` | boolean | yes | Success flag for log level. |
| `hub` | object | no | Hub-side fields (skillId, messageId, client_id, grant_type, …). Secrets redacted to `***`. |
| `ticketing` | object | no | Spoke-side fields (task_id, status, url, expires_in, …). |

### Example JSONL lines

```json
{"agent": "a2a-spoke", "step": "ready", "channel": "a2a", "ok": true, "ticketing": {"server": "worktual-ticketing", "url": "http://host:8021", "logPath": "/path/a2a-2026-10-02.log"}}
{"agent": "a2a-spoke", "step": "token", "channel": "a2a", "ok": true, "hub": {"grant_type": "client_credentials", "client_id": "..."}, "ticketing": {"expires_in": 21600}}
{"agent": "a2a-spoke", "step": "invoke", "channel": "a2a", "ok": true, "hub": {"skillId": "tk.super-agent.route", "organizationId": "1012", "messageId": "..."}}
{"agent": "a2a-spoke", "step": "receipt", "channel": "a2a", "ok": true, "hub": {"skillId": "...", "messageId": "..."}, "ticketing": {"task_id": "...", "status": "completed"}}
```

### API

```text
log_event(step, ok=True, hub=None, ticketing=None) -> dict
```

Also writes to Python logger `a2a-spoke` (stream + daily file handler).

---

## 4. Proactive executor harness (optional)

Same **agent-turn** file may receive blocks from `log_proactive_executor_run` (e.g. ticket SLA executor). Format:

```
========================================================================================
{title}
  time:     {iso8601}
  event:    {event_type}
  org:      {organization_id}
  ticket:   {ticket_number}
  domain:   {domain label}

ATTENDING AGENT
  1. {domain}
  2. {executor_id}

ROUTED TO
  {domain} → {executor}  skill={skill} task={task_id} via={via}
      proactive_agent={agent_id} status={status}
      detail={optional, max 240 chars}
========================================================================================
```

Use the same separator width (88) for visual consistency.

---

## 5. Checklist for another project

1. Create `logs/` (or configurable path) with **UTC day rotation**.
2. Implement **redact** on nested dict/list keys matching secret substrings.
3. Wire **begin_turn** at HTTP entry (`/api/coworker/agent-turn` or equivalent) and **finish_turn** on success/error before returning the response body.
4. Call **record_*** from: router (route), tool loop (tool + llm), context-layer HTTP client (context layer).
5. Keep ontology **slice** response bodies out of logs; log status only.
6. Add **llm** logging at the single LLM client wrapper so all models share one file.
7. If you expose A2A, add **log_event** on ready/token/invoke/receipt and dual-write `.json` JSONL for dashboards.
8. Document clip limits and env flags (`agent_turn_console`) in your own config README.

---

## 6. Related docs

- Staff chat flow and what to expect in logs: [ai-chat-agent-a-to-z.md](./ai-chat-agent-a-to-z.md) § N.

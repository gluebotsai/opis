# Worktual co-worker — multi-agent chatbot (Python + LangGraph)

Modular agents for ticketing modules. A router classifies each user message,
then LangGraph sends it to the matching agent. The LLM is an OpenAI-compatible
endpoint (`worktual-gemma`).

## Setup

```bash
cd ai-agents
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

## Run API

```bash
# from ai-agents/
uvicorn app.main:app --reload --host 127.0.0.1 --port 8012
```

- Health: `GET http://127.0.0.1:8012/health`
- Chat: `POST http://127.0.0.1:8012/chat` with JSON `{"message":"...","page":"Home"}`
- Triage + assign (Flows 2–4): `POST http://127.0.0.1:8012/tasks/triage-assign`

```json
{
  "organization_id": "a0000000-0000-4000-8000-000000000001",
  "customer_name": "Alex Customer",
  "customer_email": "alex@example.com",
  "issue": "My VPN is not working and I cannot login"
}
```

Returns enrich-compatible fields: `subject`, `description`, `priority`, `assignee`, `queue`, `channel`, `rationale`, `enrichedByAi`.

Requires header `X-Coworker-Tasks-Key` matching `COWORKER_TASKS_SECRET` (default `worktual-tasks-dev-secret`).

## Domain tools / MCP

By default tools call Express directly (`TOOLS_TRANSPORT=express`). To route the same tool names through the Ticketing MCP server:

```bash
# terminal 1 — MCP (wraps Express)
cd mcp-server && source .venv/bin/activate && python server.py

# terminal 2 — agents
export TOOLS_TRANSPORT=mcp
export MCP_SERVER_URL=http://127.0.0.1:8020
uvicorn app.main:app --reload --host 127.0.0.1 --port 8012
```

Catalog: `shared/ticketing_tool_catalog.json`. Details: [`docs/agents.md`](../docs/agents.md), [`mcp-server/README.md`](../mcp-server/README.md).

Express `POST /api/tickets/enrich` calls this endpoint via `COWORKER_AGENTS_URL` (fallback to Node enrich if agents are down). Create without enrich also runs triage server-side when assignee/queue/subject are incomplete.

## Tests

```bash
pytest   # five suites under tests/test_suite_*.py
```

## CLI

```bash
python cli.py
```

## Agents

| Route      | Focus                          |
|------------|--------------------------------|
| tickets    | Tickets, SLAs, assignment      |
| teams      | Teams / queues                 |
| kb         | Knowledge base articles        |
| customers  | Customer directory             |
| general    | Navigation & catch-all         |
| **triage-assign** (task) | Flows 2–4: categorize + team + assign |

**Why each agent exists and how they fit the ticket flow:** see [`docs/agents.md`](../docs/agents.md).

## Extending

1. Add `app/agents/my_agent.py` with a `run(state)` node.
2. Add a system prompt in `app/prompts.py`.
3. Register the node + edge in `app/graph.py`.
4. Include the name in the router allow-list in `app/agents/router.py`.

## Live database answers

Each specialist agent receives **LIVE DATABASE RESULTS** for the signed-in organisation (passed as `organisation_id` from Express). Examples:

- “How many tickets raised today?” → SQL count on `tickets.created_at`
- “List my teams” → rows from `agent_queues`
- “Find customer Acme” → `customers` ILIKE search
- “KB password reset” → `kb_articles` search

Set `DATABASE_URL` in the repo-root `.env` (same as the ticketing app).
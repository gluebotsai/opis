# Knowledge Graph Agent (`knowledge_graph_agent`)

A self-contained, enterprise-grade, strictly read-only Knowledge Graph reporting agent designed for direct integration with a **Super Agent**, **Supervisor / Orchestrator**, or **Microservice Fleet**.

This package provides deep graph analytics, Ticketing system ontology reasoning (ticket volume, monthly trends, backlog, SLA, queues, agents), and automated Cypher generation with zero hallucination guarantees, tenant security isolation, and headless API endpoints.

---

## 1. Directory Structure

Every file and directory in `knowledge_graph_agent` is organized with clean, standard naming conventions:

```text
knowledge_graph_agent/
├── __init__.py                # Package entrypoint (exports run_knowledge_graph_agent, router, models)
├── api.py                    # Headless FastAPI endpoints (POST /query, POST /diagnostic, GET /health)
├── agent.py                  # Core multi-turn reasoning engine (Generate_response, run_knowledge_graph_agent)
├── models.py                 # Pydantic request/response data contracts (KnowledgeGraphRequest, KnowledgeGraphResponse)
├── config.py                 # Pydantic typed configuration loader (app, neo4j, llm, audit, access)
├── tools.py                  # Neo4j Cypher executor, CypherValidator allowlist, row caps, Meilisearch client
├── prompt.py                 # Grounded system prompt, operational principles, and few-shot examples
├── llm.py                    # vLLM / OpenAI client with structured parsing & tool calling
├── diagnostic.py             # Root-cause diagnostic reasoner for collaborative "why" questions
├── audit.py                  # Thread-safe structured JSONL audit logger (logs/audit.jsonl)
├── memory.py                 # Conversation memory and session management
├── summarizer.py             # Context summarization and compaction
├── ontology/                 # Authoritative graph ontology & security allowlists
│   ├── schema_registry.json  # Schema allowlist for Cypher AST validator (labels, relationships, properties)
│   ├── concept_cards.json    # Business metric formulas, definitions, and graph traversal patterns
│   ├── meilisearch_documents.json # Semantic search documents for Meilisearch index
│   └── ontology_base.json    # Base graph schema and relationship definitions
├── config/                   # Declarative YAML configurations
│   ├── app.yaml              # Application metadata and default role
│   ├── neo4j.yaml            # Neo4j driver parameters, timeouts, row caps, allowed orgs
│   ├── llm.yaml              # LLM inference host, model alias, timeouts
│   ├── audit.yaml            # Audit logger sinks and PII toggles
│   └── access.yaml           # Role hierarchies (employee -> self, team_lead -> team, admin -> org)
├── .env.example              # Minimal environment variables example template
└── README.md                 # Super Agent integration guide
```

> **Excluded Junk:** All UI frontends (Streamlit), HTML templates, test consoles, legacy `.bak` files, Jupyter notebooks, and scratch notes have been excluded. This package contains purely the core agent engine and headless endpoints.

---

## 2. Integration Methods for Super Agents

A super agent or supervisor can consume this agent in one of three ways:

### Method A: Direct In-Process Python SDK (Recommended)

Call the agent asynchronously within your super agent process without HTTP overhead:

```python
import asyncio
from knowledge_graph_agent import run_knowledge_graph_agent, KnowledgeGraphResponse

async def main():
    response: KnowledgeGraphResponse = await run_knowledge_graph_agent(
        query="In which month were the most tickets created?",
        organization_id="1012",
        user_id="supervisor_01",
        role="employee",          # Least-privilege default
        debug=False
    )

    print(f"Status: {response.status}")
    print(f"Answer: {response.answer}")
    print(f"Executed Cypher: {response.cypher_queries}")
    print(f"Discovered Concepts: {response.data.get('concepts_discovered')}")

asyncio.run(main())
```

### Method B: Mount as a FastAPI Sub-Router

Mount the agent's endpoints directly onto your super agent's FastAPI application:

```python
from fastapi import FastAPI
from knowledge_graph_agent import get_knowledge_graph_router

super_agent_app = FastAPI(title="Super Agent Service")

# Mount knowledge graph agent at /kg prefix
super_agent_app.include_router(get_knowledge_graph_router(), prefix="/kg")
```

Now your super agent exposes:
- `POST /kg/query`
- `POST /kg/diagnostic`
- `GET /kg/health`

### Method C: Standalone Microservice

Run the knowledge graph agent as an independent HTTP microservice:

```bash
uvicorn knowledge_graph_agent.api:app --host 0.0.0.0 --port 8002
```

---

## 3. API Contract Specifications

### 3.1 `POST /query`
**Request Payload (`application/json`):**
```json
{
  "query": "How many open tickets are there currently?",
  "organization_id": "1012",
  "user_id": "user-4819",
  "role": "employee",
  "scope": {
    "team_id": "tier-1-support"
  },
  "session_id": "sess-9a8b7c",
  "debug": false
}
```

**Response Payload (`application/json`):**
```json
{
  "status": "ok",
  "answer": "<p>There are currently <b>123</b> open tickets in the system.</p>",
  "explanation": "Processed successfully by Knowledge Graph Agent.",
  "data": {
    "type": "concept",
    "title": "Ontology Concept Relationship",
    "concepts_discovered": "Entity/Concept: Ticket | Definition: Represents a customer service request...",
    "session_id": "sess-9a8b7c",
    "organization_id": "1012",
    "user_id": "user-4819",
    "role": "employee",
    "total_rows": 1
  },
  "tool_calls": null,
  "cypher_queries": [
    "MATCH (t:Ticket) WHERE t.status = 'Open' RETURN count(t) AS open_tickets LIMIT 50"
  ],
  "error": null,
  "debug": null,
  "latency_seconds": 2.84
}
```

---

### 3.2 `POST /diagnostic`
For root-cause investigation queries ("Why did X drop/surge?"):

**Request Payload:**
```json
{
  "query": "Why did ticket backlog surge in August?",
  "sql_metrics": [
    {"queue": "Technical Support", "delta_pct": 84.5},
    {"queue": "Billing", "delta_pct": 12.1}
  ],
  "organization_id": "1012"
}
```

**Response Payload:**
```json
{
  "status": "ok",
  "explanation": "Total conversation volume fell sharply across all channels, predominantly driven by a 91.8% contraction in WhatsApp inbound traffic...",
  "organization_id": "1012"
}
```

---

## 4. Enterprise Security & Guardrails

1. **Strictly Read-Only (Zero Mutation):**
   Every Cypher query is evaluated by an AST validator. Any presence of `CREATE`, `MERGE`, `SET`, `DELETE`, `DETACH`, `REMOVE`, `DROP`, or `ALTER` is rejected immediately.
2. **Authoritative Allowlist Validation:**
   Labels, relationships, and properties are checked against `ontology/schema_registry.json`. Unregistered labels or relations cannot be executed.
3. **Tenant Boundary Isolation:**
   All queries are bound to tenant-isolated databases (`org1012`, `org1000`). Passing an unknown or unapproved tenant raises a 403 access denial before touching the database.
4. **Least-Privilege Role Default:**
   If a super agent passes an empty role, the agent strictly defaults to `employee` (never `admin`).
5. **Query Resource Caps:**
   Queries automatically enforce a `LIMIT 50` row cap and a 30-second read transaction timeout.
6. **Structured Audit Logging:**
   Every request records a structured JSON line in `logs/audit.jsonl` with timestamps, tenant ID, user, role, query, latency, and status (`ok`, `denied`, `error`). Zero PII is logged.

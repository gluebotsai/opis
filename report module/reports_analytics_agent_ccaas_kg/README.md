# CCaaS Knowledge Graph (KG) Agent

An autonomous AI agent designed for **Contact Center as a Service (CCaaS) Knowledge Graph Analytics** powered by **Neo4j** and **LLM Cypher Generation**.

---

## Capabilities

- **Omnichannel Conversation Analytics**: Graph traversal tracing customer conversations across Webchat, Voice, and Messaging channels.
- **Support Queue Routing & Wait Times**: Analysis of conversation placement across queues (`ROUTED_TO`).
- **Support Staff / Agent Workload**: Tracking conversations handled by support representatives (`HANDLED_BY`).
- **Outcomes & Disconnect Analysis**: Insights into wrap-up codes, idle timeouts, visitor disconnects, and customer abandonment.
- **Service Level & SLA Compliance**: Monitoring response timeliness, priorities, and SLA adherence.
- **AST & Regex Cypher Guardrails**: Enforces strict read-only execution, blocks mutating operations (`CREATE`, `MERGE`, `SET`, `DELETE`, `DETACH`, `DROP`, `ALTER`), caps query limits (`LIMIT 100`).
- **Graph Privacy & RBAC**: Role-based access control protecting employee credentials and sensitive fields from non-admin roles (`team_lead`, `agent`).
- **Multi-Tenant Neo4j Isolation**: Tenant routing directly to isolated Neo4j databases (`org1012`).
- **Natural Real-Time Business Language**: Explains facts in human-friendly contact center terms without exposing graph database jargon (nodes, relationships, Cypher syntax).

---

## Directory Structure

```text
reports_analytics_agent_ccaas_kg/
├── .env                          # Local credentials (NEO4J_URI, LLM_BASE_URL)
├── .env.example                  # Template environment file
├── README.md                     # Documentation & setup guide
├── requirements.txt              # Python package dependencies
├── agent.md                      # System instructions & ontology prompt
├── app.py                        # Streamlit web UI
├── main.py                       # CLI interface & REPL runner
├── core/
│   ├── access.py                 # RBAC and credentials protection
│   ├── cypher_guard.py           # Read-only AST guardrail
│   ├── kg_client.py              # Neo4j driver connection manager
│   ├── kg_planner.py             # Dynamic LLM planner
│   ├── kg_runner.py              # Cypher query and template runner
│   ├── llm.py                    # LLM client (worktual-gemma)
│   ├── loader.py                 # Ontology and template loader
│   ├── loop.py                   # Option A 2-attempt replan loop
│   ├── models.py                 # Core data contracts
│   ├── orchestrator.py           # CCaaSKGAgent pipeline
│   └── synthesis.py              # Query-adaptive fact synthesizer
├── ontology/
│   ├── examples/cypher.yml       # Few-shot Cypher examples
│   ├── rules.yml                 # Ontological rules
│   ├── schema_registry.json      # Node labels, properties, and edges
│   └── templates.yml             # Certified Cypher templates
└── tests/
    ├── test_cypher_guard.py      # Security guardrail tests
    ├── test_privacy_and_rbac.py  # RBAC & credentials protection tests
    ├── test_kg_templates.py      # Template loading tests
    ├── test_neo4j_client.py      # DB routing & live connection tests
    └── test_orchestrator.py      # End-to-end pipeline tests
```

---

## Quickstart

### 1. Run Automated Test Suite
```bash
PYTHONPATH=. pytest tests/ -v
```

### 2. Run Minimalist Streamlit Interface
```bash
streamlit run app.py --server.port 8503
```

### 3. Run Command-Line Interface (CLI)
```bash
python main.py "What is our total customer conversation volume?"
```

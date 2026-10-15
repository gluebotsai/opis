# NLP Service

Simplified FastAPI NLP backend for Worktual Contact Center.

- One `SupportBotAgent` handles Webchat, WhatsApp, Instagram, Facebook, and Email.
- `AgentRouter` hands co-worker requests between six small specialist agents.
- Domain operations run through real MCP client/server sessions.
- Skills and metrics use separate MCP servers; metric retrieval is vectorless.
- Existing REST, SSE, contact-preview, and queue-confirmation contracts are preserved.

See [docs/architecture.md](docs/architecture.md) for the complete structure and workflows.

## Setup

```sh
# from repo root
npm run nlp:sync

# Uses repo root .env
# CHAT_OPENAI_API_KEY, CHAT_OPENAI_BASE_URL, CHAT_OPENAI_MODEL
# COPILOT_MAX_TOKENS (co-worker max output tokens; default 4096, minimum 2048 recommended)
# TOGETHER_API_KEY, TOGETHER_BASE_URL, TOGETHER_MODEL
# JWT_SECRET, CC_CORE_URL, INTERNAL_SERVICE_KEY
# SEMANTIC_LAYER_URL, SEMANTIC_LAYER_PRODUCT (optional analytics gateway)
# ONTOLOGY_LAYER_URL (optional admin-dashboard why/how knowledge-graph gateway)
# Semantic layer standard response: JSON array of { ok, metric_id, rows|error } — see
# apps/nlp/src/app/services/semantic_layer.py module docstring.
# Semantic layer logs: apps/nlp/logs/semantic-layer.log (and stdout JSON)
```

## Run Tests

```sh
# Run full NLP test suite
uv run --directory apps/nlp pytest
```

API docs: http://localhost:8000/docs

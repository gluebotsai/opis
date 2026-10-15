"""Load settings from environment / .env file."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Load ai-agents/.env then repo-root .env (later wins). Shared secrets such as
# COWORKER_TASKS_SECRET should live in the root .env so Express and agents match.
_ROOT = Path(__file__).resolve().parents[2]
_AGENTS = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """LLM and database configuration — no secrets/IPs committed as defaults."""

    model_config = SettingsConfigDict(
        env_file=(
            str(_AGENTS / ".env"),
            str(_ROOT / ".env"),
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    model_name: str = "worktual-gemma-cx"
    # Must be set via MODEL_URL / COWORKER_MODEL_URL in env for real LLM calls.
    model_url: str = ""
    api_key: str = "empty"
    model_temperature: float = 0.45
    # OpenAI-compatible client timeout (seconds). Prevents chat turns hanging forever.
    model_request_timeout: float = 90.0
    # Schema-invalid semantic decisions may be retried without freezing policy in code.
    workflow_decision_max_attempts: int = 2

    database_url: str = ""
    # Cap each process pool. Shared remote Postgres hits 53300 if leftover stacks stay up.
    pg_pool_max: int = 3
    # Deprecated — never used as a silent live-data fallback.
    default_org_id: str = ""

    # Shared secret for agents routes (must match Express COWORKER_TASKS_SECRET)
    coworker_tasks_secret: str = ""
    # SFT catalog (:8022). Same header as CCaaS; falls back to coworker_tasks_secret.
    internal_service_key: str = ""
    ticketing_sft_port: int = 8022

    # Express base URL for domain tool calls (writes/reads via APIs)
    express_base_url: str = "http://127.0.0.1:3001"

    # Route durable conversation_context through Ticketing API (default on).
    conversation_context_via_api: str = "1"

    # Triage roster/workload via Ticketing API (default on).
    agent_data_via_api: str = "1"

    # Proactive store via Ticketing API (default on).
    proactive_via_api: str = "1"

    # Ticketing MCP server (tools_transport=mcp)
    mcp_server_url: str = "http://127.0.0.1:8020"
    # Migration flag: express (default) | mcp
    tools_transport: str = "express"

    # Comma-separated CORS origins; empty = same-origin only (no *)
    cors_origins: str = ""

    # Worktual Context Layer — single base URL for slice, semantic, and SQL.
    # POST /v1/ontology/slice, POST /v1/semantic/query, POST /v1/sql/query
    context_layer_url: str = ""
    context_layer_timeout: float = 30.0
    context_layer_product: str = "ticketing"

    # Ontology knowledge-graph chat (SSE). Narrative “why” / drivers only — not KPI values.
    # organization_id is taken from the logged-in tool actor per request (not env).
    ontology_chat_url: str = ""
    ontology_chat_timeout: float = 90.0

    # Hub A2A remainder (Ticketing → Hub leftovers). Plain HTTP — not LangGraph.
    hub_a2a_url: str = ""
    hub_a2a_token_url: str = ""
    hub_a2a_client_id: str = "worktual-ticketing-hub"
    hub_a2a_client_secret: str = ""
    hub_a2a_server_name: str = "worktual-hub"
    hub_a2a_spoke_label: str = "Ticketing System"
    hub_a2a_timeout: float = 120.0

    # Inbound A2A spoke (Hub → Ticketing). Separate process on :8021.
    a2a_public_url: str = ""
    a2a_server_name: str = "worktual-ticketing"
    a2a_agent_name: str = "Worktual Ticketing"
    a2a_agent_description: str = (
        "Ticketing A2A spoke — Hub-invokable skills for ticket create/read/"
        "list/update, customer verify and 360, KB search, inbound capture/"
        "deflect, and Super Agent routing."
    )
    a2a_catalog_version: str = "1.0.0"
    a2a_overlay_version: str = "1.0.0"
    a2a_oauth_token_url: str = ""
    a2a_streaming_enabled: bool = False
    a2a_allow_dev_auth: bool = False
    # Comma-separated skill ids. Empty = Hub card 10. Non-empty further
    # subsets that list (cannot advertise unpublished catalog skills).
    a2a_enabled_skills: str = ""
    a2a_spoke_client_id: str = "worktual-hub-ticketing"
    a2a_spoke_client_secret: str = ""
    a2a_hub_jwt_secret: str = ""
    a2a_hub_jwt_audience: str = "worktual-ticketing-a2a"
    a2a_access_token_issuer: str = "worktual-ticketing-a2a-access"
    a2a_access_token_ttl_seconds: int = 21600
    a2a_refresh_token_ttl_seconds: int = 5184000

    # Echo each staff-chat turn (query / route / tools / reply) to the process
    # stdout so `uvicorn` / `npm run dev:agents` shows the same block as the
    # day log under ai-agents/logs/agent-turn-*.log. Set AGENT_TURN_CONSOLE=0
    # to silence the terminal (file log still writes).
    agent_turn_console: bool = True


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance (safe to call from many modules)."""
    return Settings()

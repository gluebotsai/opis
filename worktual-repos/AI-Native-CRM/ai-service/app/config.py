from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_AI_SERVICE_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _AI_SERVICE_ROOT.parent


class Settings(BaseSettings):
    # up-dev starts uvicorn from repo root; load both root and ai-service/.env.
    model_config = SettingsConfigDict(
        env_file=(
            str(_REPO_ROOT / ".env"),
            str(_AI_SERVICE_ROOT / ".env"),
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    host: str = "0.0.0.0"
    port: int = 8000
    agent_log_retention_days: int = 5

    # Shared secret with Next.js CRM (x-internal-secret)
    enrich_internal_secret: str = ""
    cron_secret: str = ""

    # Fastify CRM API (internal agent bridges — not MCP)
    crm_api_base_url: str = "http://127.0.0.1:4000"

    # CRM Postgres (same DATABASE_URL Prisma uses) — MCP tools write crm.*
    database_url: str = ""
    # Optional accounts DB for role lookups (defaults to database_url)
    account_database_url: str = ""

    # Dedicated HTTP MCP service. Production agents never dispatch in-process.
    mcp_base_url: str = "http://127.0.0.1:8010/mcp/v1"
    mcp_prefer_http: bool = True
    mcp_mount_in_api: bool = True
    mcp_allow_test_inprocess: bool = False
    mcp_allow_legacy_secret_auth: bool = False
    mcp_execution_jwt_secret: str = ""
    mcp_execution_jwt_issuer: str = "worktual-crm-api"
    mcp_execution_jwt_audience: str = "worktual-crm-mcp"
    mcp_policy_version: str = "crm-modules-v1"
    mcp_execution_jwt_ttl_seconds: int = 60

    # CRM A2A spoke (Hub ↔ CRM). Separate process: uvicorn app.a2a_main:app --port 8020
    a2a_port: int = 8020
    a2a_public_url: str = "http://127.0.0.1:8020"
    hub_a2a_url: str = ""
    hub_a2a_token_url: str = ""
    hub_a2a_server_name: str = "worktual-hub"
    hub_a2a_client_id: str = ""
    hub_a2a_client_secret: str = ""
    hub_a2a_spoke_label: str = "CRM"
    hub_a2a_timeout_seconds: int = 300
    a2a_hub_jwt_secret: str = ""
    a2a_hub_jwt_audience: str = "worktual-crm-a2a"
    a2a_hub_jwt_issuer: str = "worktual-hub"
    a2a_access_token_issuer: str = "worktual-crm-a2a-access"
    a2a_server_name: str = "worktual-crm"
    a2a_spoke_client_id: str = ""
    a2a_spoke_client_secret: str = ""
    a2a_access_token_ttl_seconds: int = 21600
    a2a_refresh_token_ttl_seconds: int = 5_184_000
    a2a_task_database_url: str = ""
    a2a_peer_skill_tags: str = "campaign,marketing,ccaas,service,cvm"
    a2a_protocol_version: str = "1.0"
    a2a_catalog_version: str = "1.0.0"
    a2a_overlay_version: str = "1.0.0"
    a2a_agent_name: str = "CRM Super Agent"
    a2a_agent_description: str = (
        "Worktual CRM spoke. Hub sends action skills with organizationId "
        "and cdpId; CRM executes existing coworker and job agents and "
        "returns receipts. Not a CRM read API."
    )
    a2a_streaming_enabled: bool = False
    a2a_oauth_token_url: str = ""

    # Enterprise orchestrator short-term memory. Client sessionMemory remains
    # compatible; Redis is authoritative only when explicitly enabled.
    orchestrator_stm_enabled: bool = False
    orchestrator_redis_url: str = "redis://127.0.0.1:6379/0"
    orchestrator_stm_ttl_seconds: int = 86_400
    orchestrator_stm_lock_ttl_seconds: int = 15
    orchestrator_stm_max_bytes: int = 16_384
    orchestrator_stm_failure_mode: str = "graceful"

    # Coworker native supervisor/tool-loop rollout. Both are required; defaults
    # preserve the pre-orchestrator crm_agent behavior for instant rollback.
    coworker_native_enabled: bool = False
    coworker_native_allowlist: str = ""
    coworker_native_deadline_seconds: int = 120

    # Stable named proactive/meeting routes. Disabled by default for rollback;
    # an empty native allowlist means all named agents when globally enabled.
    # The legacy allowlist selects pre-orchestrator behavior as an emergency
    # override; both paths are framework-independent.
    named_agents_native_enabled: bool = False
    named_agents_native_allowlist: str = ""
    named_agents_legacy_allowlist: str = ""
    named_agents_native_deadline_seconds: int = 120
    # Gemini section writes use 180s; Fastify waits up to 240s.
    named_agents_proposal_deadline_seconds: int = 240

    # Operational guardrails. Conservative defaults are high enough to preserve
    # existing behavior while bounding one noisy tenant or agent.
    agent_global_concurrency: int = 64
    agent_tenant_concurrency: int = 12
    agent_requests_per_minute: int = 240
    dependency_circuit_failures: int = 5
    dependency_circuit_recovery_seconds: int = 30
    readiness_require_redis: bool = False

    cors_origins: str = "http://localhost:3000"

    # ZoomInfo via Worktual gateway (search free; enrich = 1 data credit).
    # Read from root / ai-service .env even when not exported into os.environ.
    zoominfo_gateway_url: str = "http://173.234.75.165:8199"
    zoominfo_gateway_token: str = ""

    # Semrush via Worktual gateway (keyword_metrics = ~20 units / 1 daily hit).
    semrush_gateway_url: str = "http://173.234.75.165:8090"
    semrush_gateway_token: str = ""

    search_timeout_seconds: float = 8.0
    fetch_timeout_seconds: float = 8.0
    max_html_bytes: int = 400_000
    max_search_results: int = 8

    # OpenAI-compatible LLM (worktual-qwen-27B — all agents except proposal learn/generate)
    llm_api_key: str = "EMPTY"
    llm_model: str = "worktual-qwen-27B"
    llm_base_url: str = "http://81.17.61.149:8066/v1"

    # Proposal extract + generate (native google-genai). Empty key = skip Gemini.
    proposal_llm_api_key: str = ""
    proposal_llm_model: str = "gemini-3.5-flash"
    proposal_llm_base_url: str = ""
    proposal_llm_thinking_level: str = "high"
    gemini_api_key: str = ""
    social_image_model: str = "gemini-3.1-flash-image-preview"

    # CRM metrics semantic layer (reports / analytics agent tool)
    semantic_layer_gateway_url: str = "http://82.113.92.44:8800"
    semantic_layer_product: str = "crm"

    # CRM ontology knowledge-graph chat (why/how reasoning; SSE /chat/stream)
    ontology_gateway_url: str = "http://82.113.92.44:8000"
    ontology_gateway_timeout_s: float = 90.0

    # Reports B2B warehouse + Neo4j (reports-analytics-agent internals)
    reports_warehouse_database_url: str = ""
    reports_neo4j_uri: str = ""
    reports_neo4j_user: str = "neo4j"
    reports_neo4j_password: str = ""

    # Knowledge base: POST /retrieve (domain_id) or POST /search (org + module)
    knowledge_base_url: str = "http://82.113.92.47:7051/search"
    kb_organization_id: str = "0000"
    kb_domain_id: str = ""
    kb_product_id: str = "crm"
    knowledge_base_semantic_ratio: float = 0.9
    knowledge_base_timeout_s: float = 12.0
    knowledge_base_job_timeout_s: float = 45.0
    knowledge_base_probe_timeout_s: float = 3.0

    @property
    def internal_secret(self) -> str:
        return (self.enrich_internal_secret or self.cron_secret or "").strip()

    @property
    def resolved_reports_neo4j_uri(self) -> str:
        return (self.reports_neo4j_uri or os.getenv("NEO4J_URI") or "").strip()

    @property
    def resolved_reports_neo4j_user(self) -> str:
        return (self.reports_neo4j_user or os.getenv("NEO4J_USER") or "neo4j").strip()

    @property
    def resolved_reports_neo4j_password(self) -> str:
        return (self.reports_neo4j_password or os.getenv("NEO4J_PASSWORD") or "").strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()

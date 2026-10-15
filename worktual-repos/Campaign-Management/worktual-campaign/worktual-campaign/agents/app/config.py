from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    agents_host: str = "0.0.0.0"
    agents_port: int = 8005
    cors_origin: str = "http://localhost:5173"

    jwt_secret: str = "change-me-in-production-campaign"
    # Worktual CRM access JWT — same vars as campaign backend (embed iframe auth).
    crm_jwt_access_secret: str = ""
    crm_jwt_issuer: str = ""
    crm_jwt_user_id_claim: str = "sub"
    crm_jwt_algorithm: str = "HS256"
    campaign_api_base: str = "http://127.0.0.1:3001/api"

    # Browser-reachable API base for chat download links (sample sheet, etc.).
    # Prefer LAN/public host; falls back to campaign_api_base when empty.
    campaign_api_public_base: str = ""
    # LAN → rebuild backend IP + Host header (same as backend MEDIA_PUBLIC_*).
    media_public_direct_origin: str = ""
    media_public_host_header: str = ""

    llm_api_key: str = "dummy"
    # OpenAILLM defaults — local campaign chat + template generation
    # Previous: gpt-oss-120b @ http://173.234.75.166:8003/v1
    # Previous: worktual-gemma-cx @ http://81.17.61.149:8060/v1
    llm_model: str = "worktual-qwen-27B"
    llm_base_url: str = "http://81.17.61.149:8066/v1"

    # Full LLM + tool I/O blocks → agents/logs/llm_io.log (see llm_io_log.py)
    llm_io_log: bool = False
    llm_io_log_path: str = ""

    # Knowledge via Enterprise Context Layer (never call Meili directly).
    kb_enabled: bool = True
    context_layer_url: str = "http://82.113.92.47:7051"
    context_layer_timeout_s: float = 12.0
    # Legacy retrieve — unused when context_layer_url is set.
    kb_retrieve_url: str = "http://173.234.75.165:8080/retrieve"
    kb_sales_domain_id: str = "worktual_sales_may11"
    kb_service_domain_id: str = "worktual_service_kb"

    # Chat NL analytics — semantic layer (CRM handoff pattern, Campaign product)
    # POST {base}/ask with { query, organization_id, product }
    semantic_layer_gateway_url: str = "http://82.113.92.44:8800"
    semantic_layer_product: str = "campaign"
    semantic_layer_timeout_s: float = 30.0

    # Ontology knowledge graph chat (Past Analyst / template MAS)
    # Full stream URL: POST with { sessionID, query, organization_id }
    ontology_chat_stream_url: str = "http://82.113.92.44:8000/chat/stream"
    ontology_chat_timeout_s: float = 90.0

    data_dir: str = "./data"

    web_tracking_landing_url: str = ""

    # --- A2A spoke (Hub ↔ Campaign) ---
    # Public base Hub must reach (LAN IP / host). Not 127.0.0.1 for remote Hub.
    a2a_public_url: str = "http://192.168.11.31:8040"
    a2a_host: str = "0.0.0.0"
    a2a_port: int = 8040
    a2a_server_name: str = "worktual-campaign"
    # Hub → Campaign: Hub authenticates to our /token with these
    a2a_spoke_client_id: str = "worktual-hub-campaign"
    a2a_spoke_client_secret: str = "MA7fdPQALkoFmS3GMFadDAxvVKfAX45C_HoAqlhlkxE"
    # Signs Campaign access JWTs for Hub (never share with Hub)
    a2a_hub_jwt_secret: str = "change-me-campaign-a2a-jwt-secret"
    a2a_hub_jwt_audience: str = "worktual-campaign-a2a"
    a2a_access_token_issuer: str = "worktual-campaign-a2a-access"
    a2a_access_token_ttl_seconds: int = 21600
    a2a_refresh_token_ttl_seconds: int = 5184000
    # Shared accounts DB for a2a_spoke_clients (empty = in-memory)
    account_database_url: str = ""
    # Optional static Campaign API Bearer. Prefer auto-mint from organizationId
    # (JWT_SECRET + ACCOUNT_DATABASE_URL). Hub does not need to send campaignToken.
    a2a_campaign_api_token: str = ""

    # Campaign → Hub (remainder escalate) — Hub registration credentials
    hub_a2a_url: str = "http://192.168.13.112:8030"
    hub_a2a_token_url: str = "http://192.168.13.112:8030/token"
    hub_a2a_server_name: str = "worktual-hub"
    hub_a2a_client_id: str = "worktual-crm-hub"
    hub_a2a_client_secret: str = "CdLdHlb-qM-TXj0W_oWbOKWIZsBf2mcMd4IkFNCf2t4"
    hub_a2a_spoke_label: str = "Campaign"
    hub_a2a_timeout_s: float = 120.0

    # MAS (Super → Domain → Executor). Comma-separated domain ids, or "all".
    # Production default: all product domains. Set empty to force legacy-only.
    mas_enabled_domains: str = "all"

    # Create-campaign native MAS executors (bounded tool loops per executor).
    # False = legacy run_create_campaign_turn wrappers inside MAS executors.
    mas_create_campaign_native: bool = True

    # Audience CRM native MAS executors (bounded tool loops per executor).
    # False = legacy run_coordinator inside MAS executors.
    mas_audience_native: bool = True

    # Optimization native MAS executors (monitoring / analytics / recovery).
    mas_optimization_native: bool = True

    # Content native MAS executors (channels / WA / coach).
    mas_content_native: bool = True

    # Forms native MAS executors (theme / fields / design).
    mas_forms_native: bool = True

    # Image native MAS executors (generate / refine / attach).
    mas_image_native: bool = True

    # Edit space: per-channel LLM+tools specialists (canvas via request_template_change).
    edit_space_unified_agent: bool = True

    # Template Generation Director — design-then-content for email (Phase 1)
    template_director_enabled: bool = True
    # Phase 2 compose plugin: first-time email create only. Off = existing director.
    phase2_email_compose_enabled: bool = False
    # Cross-campaign fingerprint history via GET /channel-templates/recent (off until backend deploy)
    template_org_fingerprints_enabled: bool = False

    # Gemini image generation (template hero / campaign images)
    gemini_api_key: str = ""
    gemini_image_model: str = "gemini-3.1-flash-image-preview"
    # When false (default), missing GEMINI_API_KEY fails generation instead of a blue dev PNG.
    gemini_image_allow_dev_stub: bool = False

    # SFT agent catalog (`GET /internal/v1/agents*`). Fail closed when empty.
    internal_service_key: str = "cmp-sft-7Kq9mX2nR4pWv8sL1tYc6HdakLAlq"

    # My Accounts — App/Web push list + credentials (never persist secrets).
    accounts_api_base_url: str = ""
    product_mcp_connectors_token: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()

"""Environment-backed application configuration."""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

NLP_ROOT = Path(__file__).resolve().parents[2]
repository_root = os.getenv("REPOSITORY_ROOT")
REPOSITORY_ROOT = (
    Path(repository_root)
    if repository_root
    else NLP_ROOT.parents[1]
    if len(NLP_ROOT.parents) > 1
    else NLP_ROOT
)
ENV_FILE = REPOSITORY_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE if ENV_FILE.is_file() else None,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Worktual Contact Center NLP"
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: str = "http://localhost:5173"

    # together_api_key: str = ""
    # together_base_url: str = "http://81.17.61.148:8064/v1"
    # together_model: str = "worktual-minimax"
    # together_temperature: float = 0.2
    # together_timeout_seconds: float = 90.0
    # together_max_tokens: int = 4096

    # chat_openai_api_key: str = ""
    # chat_openai_base_url: str = "http://81.17.61.148:8064/v1"
    # chat_openai_model: str = "worktual-minimax"
    # chat_openai_temperature: float = 0.2
    # chat_openai_timeout_seconds: float = 90.0
    # chat_openai_max_tokens: int = 4096


    # Coworker LLM — worktual-minimax.
    together_api_key: str = "123"
    together_base_url: str = "http://81.17.61.148:8789/v1"
    # together_model: str = "worktual-gemma"
    together_model: str = "worktual-minimax"
    together_temperature: float = 0.2
    together_timeout_seconds: float = 90.0
    together_max_tokens: int = 2048

    chat_openai_api_key: str = "123"
    chat_openai_base_url: str = "http://81.17.61.148:8789/v1"
    # chat_openai_model: str = "worktual-gemma"
    chat_openai_model: str = "worktual-minimax"
    chat_openai_temperature: float = 0.2
    chat_openai_timeout_seconds: float = 90.0
    chat_openai_max_tokens: int = 2048

    # Gemma: true/on/low enable thinking. off disables it. GLM also accepts low|medium|high.
    llm_thinking_mode: str = "true"

    # Co-worker / specialist agent max output tokens (env: COPILOT_MAX_TOKENS).
    copilot_max_tokens: int = 2048
    # Backward-compatible co-worker orchestration rollout.
    # flat: current surface-selected specialists
    # shadow: current behavior plus non-authoritative L1/L2 route observation
    # three_layer: L1 Contact Center Super -> L2 domain -> L3 executor
    coworker_mas_mode: Literal["flat", "shadow", "three_layer"] = "three_layer"
    coworker_mas_org_ids: str = "*"
    coworker_mas_internal_handoff_limit: int = 10
    coworker_mas_routing_timeout_seconds: float = 6.0
    agent_markdown_prompts_enabled: bool = False
    dynamic_procedural_skills_enabled: bool = True
    active_skill_prompt_max_chars: int = 24_000
    passive_assist_structured_enabled: bool = False
    agent_memory_v2_enabled: bool = False
    agent_audit_persistence_enabled: bool = False

    internal_service_key: str | None = None
    internal_service_key_required: bool = True
    internal_rate_limit_per_minute: int = 120
    jwt_secret: str = ""
    jwt_issuer: str | None = None
    jwt_audience: str | None = None
    nlp_allow_insecure_copilot_auth: bool = False

    cc_core_url: str = "http://localhost:3000"
    cc_core_timeout_seconds: float = 15.0
    semantic_layer_url: str = ""
    semantic_layer_product: str = "aiccaas"
    semantic_layer_timeout_seconds: float = 30.0
    ontology_layer_url: str = ""
    ontology_layer_timeout_seconds: float = 120.0
    knowledge_search_url: str = "http://82.113.92.47:7051"
    knowledge_search_product_id: str = "contact-center"
    knowledge_search_ccaas_audience: str = "both"
    knowledge_search_max_results: int = 5
    knowledge_search_timeout_seconds: float = 30.0
    copilot_timeout_seconds: float = 60.0
    sentiment_llm_api_key: str = "123"
    sentiment_llm_base_url: str = "http://173.234.75.166:8011/v1"
    sentiment_llm_model: str = "worktual-gemma"
    sentiment_llm_temperature: float = 0.0
    sentiment_llm_timeout_seconds: float = 15.0
    sentiment_llm_max_tokens: int = 512
    # Suggested-reply draft only. Co-worker chat stays on the shared Minimax client.
    assist_llm_api_key: str = "123"
    assist_llm_base_url: str = "http://173.234.75.166:8011/v1"
    assist_llm_model: str = "worktual-gemma"
    assist_llm_temperature: float = 0.2
    assist_llm_timeout_seconds: float = 60.0
    assist_llm_max_tokens: int = 2048
    api_v1_base: str = "/api/v1"
    api_v1_public_base: str | None = None
    nlp_api_v1_public_base: str | None = None
    support_bot_confidence_threshold: float = 0.55
    custom_lola_worktual_org_ids: str = "1003"
    custom_lola_assist_org_ids: str = "1003"
    custom_lola_worktual_llm_base_url: str = "http://173.234.75.166:8011/v1"
    custom_lola_worktual_llm_model: str = "worktual-gemma"
    custom_lola_worktual_llm_max_tokens: int = 8192
    custom_lola_worktual_llm_reasoning_effort: str = "medium"
    custom_lola_worktual_llm_api_key: str = "DUMMY"
    custom_lola_worktual_kb_retrieve_url: str = "http://173.234.75.165:8080/retrieve"
    custom_lola_worktual_callback_assignee_user_id: str = ""
    custom_booxoo_bot_org_ids: str = "1012"
    custom_booxoo_bot_llm_base_url: str = "http://173.234.75.166:8003/v1"
    custom_booxoo_bot_llm_model: str = "gpt-oss-120b"
    custom_booxoo_bot_llm_api_key: str = "DUMMY"
    custom_booxoo_bot_llm_max_tokens: int = 2048
    custom_booxoo_bot_ticketing_base_url: str = "https://rebuild-ticketing.worktual.com"
    custom_booxoo_bot_ticketing_api_key: str = ""
    custom_booxoo_bot_cdp_base_url: str = ""
    custom_booxoo_bot_otp_dev_code: str = ""
    custom_booxoo_bot_sms_otp_url: str = "https://did.worktual.co.uk/sms/v1/infobip/smsOutBot"
    custom_booxoo_bot_sms_otp_source: str = "447451295161"
    # Booxoo OTP delivery uses its dedicated SMTP credentials.
    custom_booxoo_bot_smtp_sender: str = Field(
        default="",
        validation_alias=AliasChoices(
            "CUSTOM_BOOXOO_BOT_SMTP_SENDER",
            "SMTP_SENDER",
        ),
    )
    custom_booxoo_bot_smtp_app_password: str = Field(
        default="",
        validation_alias=AliasChoices(
            "CUSTOM_BOOXOO_BOT_SMTP_APP_PASSWORD",
            "SMTP_APP_PASSWORD",
        ),
    )
    custom_booxoo_bot_smtp_host: str = "smtp.gmail.com"
    custom_booxoo_bot_smtp_port: int = 465
    custom_booxoo_bot_callback_assignee_user_id: str = ""
    webchat_tickets_base_url: str = ""
    webchat_tickets_api_key: str = ""
    crm_appointments_base_url: str = "https://rebuild-crm.worktual.com"
    database_url: str = ""
    redis_url: str | None = None
    log_level: str = "INFO"
    log_dir: str = "logs"

    @property
    def custom_lola_worktual_org_id_set(self) -> set[str]:
        return {
            value.strip()
            for value in self.custom_lola_worktual_org_ids.split(",")
            if value.strip()
        }

    @property
    def custom_lola_assist_org_id_set(self) -> set[str]:
        return {
            value.strip()
            for value in self.custom_lola_assist_org_ids.split(",")
            if value.strip()
        }

    @property
    def custom_booxoo_bot_org_id_set(self) -> set[str]:
        return {
            value.strip()
            for value in self.custom_booxoo_bot_org_ids.split(",")
            if value.strip()
        }

    @property
    def coworker_mas_org_id_set(self) -> set[str]:
        return {
            value.strip()
            for value in self.coworker_mas_org_ids.split(",")
            if value.strip()
        }

    def coworker_mas_mode_for(self, tenant_id: str) -> Literal["flat", "shadow", "three_layer"]:
        if self.coworker_mas_mode == "flat":
            return "flat"
        allowed = self.coworker_mas_org_id_set
        if "*" not in allowed and tenant_id not in allowed:
            return "flat"
        return self.coworker_mas_mode

    @property
    def cors_origin_list(self) -> list[str]:
        return [value.strip() for value in self.cors_origins.split(",") if value.strip()]

    @property
    def resolved_llm_max_tokens(self) -> int:
        """Max output tokens for co-worker and shared LLM providers."""
        return max(
            self.copilot_max_tokens,
            self.together_max_tokens,
            self.chat_openai_max_tokens,
        )

    @property
    def api_v1_bases(self) -> list[str]:
        bases = [self.api_v1_base.rstrip("/") or "/api/v1"]
        public = (self.api_v1_public_base or self.nlp_api_v1_public_base or "").rstrip("/")
        if public and public not in bases:
            bases.append(public)
        return bases


@lru_cache
def get_settings() -> Settings:
    return Settings()

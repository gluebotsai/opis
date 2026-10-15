"""A2A spoke settings. No Hub client secrets belong here."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _env_files() -> tuple[str, ...]:
    """Prefer repo-root `.env`, then local cwd `.env`."""
    here = Path(__file__).resolve()
    # .../apps/a2a-server/src/cc_a2a/config.py → repo root is parents[4]
    candidates = [
        here.parents[4] / ".env",  # monorepo root
        here.parents[3] / ".env",  # apps/a2a-server/.env
        Path.cwd() / ".env",
    ]
    return tuple(str(path) for path in candidates if path.is_file())


class A2ASettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_files() or (".env",),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    a2a_enabled: bool = Field(default=False, alias="A2A_ENABLED")
    a2a_public_url: str = Field(default="http://localhost:8020", alias="A2A_PUBLIC_URL")
    a2a_protocol_version: str = Field(default="1.0", alias="A2A_PROTOCOL_VERSION")
    a2a_catalog_version: str = Field(default="1.1.0", alias="A2A_CATALOG_VERSION")
    a2a_overlay_version: str = Field(default="1.1.0", alias="A2A_OVERLAY_VERSION")

    a2a_oauth_issuer: str = Field(default="", alias="A2A_OAUTH_ISSUER")
    a2a_oauth_audience: str = Field(
        default="worktual-contact-centre-a2a",
        alias="A2A_OAUTH_AUDIENCE",
    )
    a2a_oauth_jwks_url: str = Field(default="", alias="A2A_OAUTH_JWKS_URL")
    a2a_oauth_token_url: str = Field(default="", alias="A2A_OAUTH_TOKEN_URL")
    a2a_allow_dev_auth: bool = Field(default=False, alias="A2A_ALLOW_DEV_AUTH")
    a2a_hub_client_id: str = Field(default="worktual-hub-ccaas", alias="A2A_HUB_CLIENT_ID")
    a2a_hub_client_secret: str = Field(default="", alias="A2A_HUB_CLIENT_SECRET")
    a2a_token_signing_secret: str = Field(default="", alias="A2A_TOKEN_SIGNING_SECRET")
    a2a_token_ttl_seconds: int = Field(default=3600, alias="A2A_TOKEN_TTL_SECONDS")
    a2a_refresh_ttl_seconds: int = Field(
        default=2_592_000,
        alias="A2A_REFRESH_TTL_SECONDS",
    )
    a2a_catalog_skill_version: str = Field(default="1.0.0", alias="A2A_SKILL_VERSION")

    a2a_task_timeout_seconds: int = Field(default=120, alias="A2A_TASK_TIMEOUT_SECONDS")
    a2a_task_retention_days: int = Field(default=30, alias="A2A_TASK_RETENTION_DAYS")
    a2a_max_request_bytes: int = Field(default=262_144, alias="A2A_MAX_REQUEST_BYTES")
    a2a_rate_limit_per_minute: int = Field(default=120, alias="A2A_RATE_LIMIT_PER_MINUTE")
    a2a_delegation_hop_budget: int = Field(default=3, alias="A2A_DELEGATION_HOP_BUDGET")

    # Tenant/skill feature flags (comma-separated). Empty = all enabled when A2A_ENABLED.
    a2a_enabled_tenants: str = Field(default="", alias="A2A_ENABLED_TENANTS")
    a2a_enabled_skills: str = Field(default="", alias="A2A_ENABLED_SKILLS")
    a2a_streaming_enabled: bool = Field(default=False, alias="A2A_STREAMING_ENABLED")

    cc_core_url: str = Field(default="http://localhost:3000", alias="CC_CORE_URL")
    internal_service_key: str = Field(default="", alias="INTERNAL_SERVICE_KEY")
    webchat_trigger_api_key: str = Field(default="", alias="WEBCHAT_TRIGGER_API_KEY")

    # Outbound Hub remote agent (CCaaS → Hub). Distinct from inbound A2A_HUB_CLIENT_*.
    hub_a2a_base_url: str = Field(default="", alias="HUB_A2A_URL")
    hub_a2a_token_url: str = Field(default="", alias="HUB_A2A_TOKEN_URL")
    hub_a2a_client_id: str = Field(
        default="worktual-ccaas-hub",
        alias="HUB_A2A_CLIENT_ID",
    )
    hub_a2a_client_secret: str = Field(default="", alias="HUB_A2A_CLIENT_SECRET")
    hub_a2a_spoke_label: str = Field(default="CCaaS", alias="HUB_A2A_SPOKE_LABEL")
    hub_a2a_server_name: str = Field(default="worktual-hub", alias="HUB_A2A_SERVER_NAME")
    hub_a2a_timeout_seconds: int = Field(default=120, alias="HUB_A2A_TIMEOUT_SECONDS")
    hub_a2a_poll_interval_seconds: float = Field(
        default=2.0,
        alias="HUB_A2A_POLL_INTERVAL_SECONDS",
    )

    agent_name: str = Field(default="Worktual Contact Centre", alias="A2A_AGENT_NAME")
    agent_description: str = Field(
        default=(
            "Contact Centre Super Agent for Hub CDP/CVM. Hub sends a typed skillId; "
            "the super agent assigns the task to an L2 domain, then an L3 executor. "
            "Skills cover contacts, live conversation context, queue staffing, "
            "callbacks, analytics, and proactive webchat engagement."
        ),
        alias="A2A_AGENT_DESCRIPTION",
    )

    def enabled_tenant_set(self) -> set[str] | None:
        raw = self.a2a_enabled_tenants.strip()
        if not raw:
            return None
        return {item.strip() for item in raw.split(",") if item.strip()}

    def enabled_skill_set(self) -> set[str] | None:
        raw = self.a2a_enabled_skills.strip()
        if not raw:
            return None
        return {item.strip() for item in raw.split(",") if item.strip()}


@lru_cache
def get_settings() -> A2ASettings:
    return A2ASettings()  # type: ignore[call-arg]

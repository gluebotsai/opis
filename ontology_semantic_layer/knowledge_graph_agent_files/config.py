# ==============================================================================
# config.py — Typed Configuration Loader for Knowledge Graph Agent
# ==============================================================================

import os
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
import yaml
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv

load_dotenv()

_PKG_ROOT = Path(__file__).resolve().parent
_PKG_CONFIG_DIR = _PKG_ROOT / "config"


def _expand_env_vars(val: Any) -> Any:
    """Recursively expand ${VAR} or ${VAR:default} environment variable references."""
    if isinstance(val, str):
        pattern = re.compile(r"\$\{([A-Za-z0-9_]+)(?::([^}]*))?\}")

        def repl(match):
            var_name = match.group(1)
            default = match.group(2) if match.group(2) is not None else ""
            return os.getenv(var_name, default)

        return pattern.sub(repl, val)
    elif isinstance(val, dict):
        return {k: _expand_env_vars(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [_expand_env_vars(i) for i in val]
    return val


def _load_yaml_file(file_path: Path) -> dict:
    if not file_path.exists():
        return {}
    with open(file_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return _expand_env_vars(data)


# ------------------------------------------------------------------------------
# Pydantic Configuration Models
# ------------------------------------------------------------------------------

class AppConfig(BaseModel):
    app_name: str = "Knowledge Graph Agent"
    environment: str = "production"
    default_role: str = "employee"
    default_organization_id: str = "1012"


class Neo4jConfig(BaseModel):
    uri: str = Field(default_factory=lambda: os.getenv("NEO4J_URI", ""))
    user: str = Field(default_factory=lambda: os.getenv("NEO4J_USER", "neo4j"))
    password: str = Field(default_factory=lambda: os.getenv("NEO4J_PASSWORD", ""))
    database_prefix: str = "org"
    read_timeout_seconds: float = 30.0
    max_rows: int = 50
    allowed_orgs: List[str] = Field(default_factory=lambda: ["1000", "1012"])
    dev_db_prefix: str = "dev_"

    @field_validator("uri")
    @classmethod
    def validate_uri(cls, v: str) -> str:
        clean = (v or "").strip().strip('"').strip("'")
        if not clean:
            clean = os.getenv("NEO4J_URI", "").strip().strip('"').strip("'")
        if not clean:
            raise ValueError("NEO4J_URI configuration is required.")
        return clean.replace(":7474", ":7687")

    @field_validator("allowed_orgs", mode="before")
    @classmethod
    def parse_allowed_orgs(cls, v: Any) -> List[str]:
        env_allowed = os.getenv("KG_ALLOWED_ORGS")
        if env_allowed:
            return [x.strip() for x in env_allowed.split(",") if x.strip()]
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        return ["1000", "1012"]


class LLMConfig(BaseModel):
    base_url: str = Field(default_factory=lambda: os.getenv("LLM_BASE_URL", ""))
    model_name: str = Field(default_factory=lambda: os.getenv("LLM_MODEL_NAME", "worktual-gemma"))
    api_key: str = Field(default_factory=lambda: os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "dummy-key"))
    temperature: float = 0.0
    timeout_seconds: float = 60.0
    structured_output: str = "auto"

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, v: str) -> str:
        url = (v or "").strip()
        if not url:
            url = os.getenv("LLM_BASE_URL", "").strip()
        if not url:
            raise ValueError("LLM_BASE_URL configuration is required.")
        return url


class AuditConfig(BaseModel):
    enabled: bool = True
    sink: str = "file"
    file_path: str = "logs/audit.jsonl"
    log_pii: bool = False
    log_full_results: bool = False


class AccessConfig(BaseModel):
    roles: Dict[str, Dict[str, str]] = Field(
        default_factory=lambda: {
            "employee": {"level": "self"},
            "team_lead": {"level": "team"},
            "admin": {"level": "org"},
        }
    )
    default_role: str = "employee"
    default_role_level: str = "self"
    hidden_for_non_admin: Dict[str, List[str]] = Field(
        default_factory=lambda: {
            "labels": ["Role", "Permission"],
            "properties": [],
        }
    )


class KnowledgeGraphSystemConfig(BaseModel):
    app: AppConfig
    neo4j: Neo4jConfig
    llm: LLMConfig
    audit: AuditConfig
    access: AccessConfig


# ------------------------------------------------------------------------------
# Singleton Cache & Loader
# ------------------------------------------------------------------------------

_CONFIG_CACHE: Optional[KnowledgeGraphSystemConfig] = None


def load_system_config(config_dir: Optional[Path] = None, force_reload: bool = False) -> KnowledgeGraphSystemConfig:
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None and not force_reload:
        return _CONFIG_CACHE

    target_dir = config_dir or _PKG_CONFIG_DIR

    app_data = _load_yaml_file(target_dir / "app.yaml")
    neo4j_data = _load_yaml_file(target_dir / "neo4j.yaml")
    llm_data = _load_yaml_file(target_dir / "llm.yaml")
    audit_data = _load_yaml_file(target_dir / "audit.yaml")
    access_data = _load_yaml_file(target_dir / "access.yaml")

    # Env overlays
    if os.getenv("NEO4J_URI"):
        neo4j_data["uri"] = os.getenv("NEO4J_URI")
    if os.getenv("NEO4J_USER"):
        neo4j_data["user"] = os.getenv("NEO4J_USER")
    if os.getenv("NEO4J_PASSWORD"):
        neo4j_data["password"] = os.getenv("NEO4J_PASSWORD")
    if os.getenv("NEO4J_MAX_ROWS"):
        try:
            neo4j_data["max_rows"] = int(os.getenv("NEO4J_MAX_ROWS"))
        except ValueError:
            pass
    if os.getenv("NEO4J_READ_TIMEOUT_SECONDS"):
        try:
            neo4j_data["read_timeout_seconds"] = float(os.getenv("NEO4J_READ_TIMEOUT_SECONDS"))
        except ValueError:
            pass

    if os.getenv("LLM_BASE_URL"):
        llm_data["base_url"] = os.getenv("LLM_BASE_URL")
    if os.getenv("LLM_MODEL_NAME"):
        llm_data["model_name"] = os.getenv("LLM_MODEL_NAME")
    if os.getenv("LLM_API_KEY"):
        llm_data["api_key"] = os.getenv("LLM_API_KEY")

    if os.getenv("AUDIT_LOG_ENABLED"):
        audit_data["enabled"] = os.getenv("AUDIT_LOG_ENABLED").lower() in ("true", "1", "yes")
    if os.getenv("AUDIT_LOG_PATH"):
        audit_data["file_path"] = os.getenv("AUDIT_LOG_PATH")

    cfg = KnowledgeGraphSystemConfig(
        app=AppConfig(**app_data),
        neo4j=Neo4jConfig(**neo4j_data),
        llm=LLMConfig(**llm_data),
        audit=AuditConfig(**audit_data),
        access=AccessConfig(**access_data),
    )

    _CONFIG_CACHE = cfg
    return cfg


def get_config() -> KnowledgeGraphSystemConfig:
    return load_system_config()


# ------------------------------------------------------------------------------
# Org Allowlist & Pattern Validation
# ------------------------------------------------------------------------------

_ORG_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


def validate_org_id(org_id: Optional[str], config: Optional[KnowledgeGraphSystemConfig] = None) -> str:
    """
    Validate organization_id against allowed pattern and configured allowlist.
    Raises ValueError if invalid, malicious, or unknown.
    """
    if not org_id:
        cfg = config or get_config()
        org_id = cfg.app.default_organization_id

    org_str = str(org_id).strip()

    if not _ORG_ID_PATTERN.match(org_str):
        raise ValueError(
            f"Invalid organization_id format: '{org_str}'. "
            "Must be alphanumeric or contain dashes/underscores only."
        )

    # Normalize key: strip leading 'org_' or 'org' if present
    raw_key = org_str
    if raw_key.startswith("org_"):
        raw_key = raw_key[4:]
    elif raw_key.startswith("org") and len(raw_key) > 3 and raw_key[3:].isdigit():
        raw_key = raw_key[3:]

    cfg = config or get_config()
    allowed = cfg.neo4j.allowed_orgs

    if raw_key not in allowed and org_str not in allowed and f"org{raw_key}" not in allowed:
        raise ValueError(
            f"Unauthorized or unknown organization_id: '{org_str}'. "
            f"Allowed organizations: {', '.join(sorted(allowed))}"
        )

    return raw_key

"""AI Chat service configuration."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AI_CHAT_ROOT = Path(__file__).resolve().parent

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(AI_CHAT_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_CHAT_ROOT))

from shared.env import load_ai_chat_env

load_ai_chat_env()


@dataclass(frozen=True)
class Settings:
    clickhouse_host: str
    clickhouse_port: int
    clickhouse_user: str
    clickhouse_password: str
    clickhouse_database: str
    secret_key: str
    jwt_algorithm: str
    host: str
    port: int
    sql_timeout_seconds: int
    sql_max_rows: int
    schema_cache_ttl_seconds: int
    llm_api_key: str
    llm_model_name: str
    llm_base_url: str
    log_level: str
    context_layer_url: str
    context_layer_timeout_seconds: int


@lru_cache
def get_settings() -> Settings:
    return Settings(
        clickhouse_host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
        clickhouse_port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        clickhouse_user=os.environ.get("CLICKHOUSE_USER", "default"),
        clickhouse_password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        clickhouse_database=os.environ.get("CLICKHOUSE_DATABASE", "web_tracking"),
        secret_key=os.environ.get("API_SECRET_KEY", "dev-secret-key"),
        jwt_algorithm=os.environ.get("JWT_ALGORITHM", "HS256"),
        host=os.environ.get("AI_CHAT_HOST", os.environ.get("SERVICE_HOST", "0.0.0.0")),
        port=int(os.environ.get("AI_CHAT_PORT", os.environ.get("CHAT_SOCKET_PORT", "7863"))),
        sql_timeout_seconds=int(os.environ.get("AI_CHAT_SQL_TIMEOUT", "30")),
        sql_max_rows=int(os.environ.get("AI_CHAT_SQL_MAX_ROWS", "500")),
        schema_cache_ttl_seconds=int(os.environ.get("AI_CHAT_SCHEMA_CACHE_TTL", "600")),
        llm_api_key=os.environ.get("LLM_API_KEY", ""),
        llm_model_name=os.environ.get("LLM_MODEL_NAME", "gpt-oss-120b"),
        llm_base_url=os.environ.get("LLM_BASE_URL", "http://173.234.75.166:8003/v1"),
        log_level=os.environ.get("AI_CHAT_LOG_LEVEL", "INFO"),
        # 195.168.11.25:8765 is the intended host; 192.168.11.25 is the live probe host.
        context_layer_url=os.environ.get(
            "CONTEXT_LAYER_URL",
            "http://192.168.11.25:8765",
        ),
        context_layer_timeout_seconds=int(os.environ.get("CONTEXT_LAYER_TIMEOUT", "20")),
    )

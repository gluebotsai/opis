"""Load harness .env then repo .env. Creds stay out of the UI."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote_plus

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def _load_env_file(path: Path, *, override: bool) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'\"")
        if override or key not in os.environ:
            os.environ[key] = val


def load_env() -> None:
    _load_env_file(REPO / ".env", override=False)
    _load_env_file(HERE / ".env", override=True)


def database_url() -> str:
    load_env()
    explicit = (os.environ.get("DATABASE_URL") or "").strip()
    if explicit:
        return explicit
    host = (os.environ.get("pg_host") or os.environ.get("PG_HOST") or "").strip()
    if not host:
        return ""
    user = (os.environ.get("pg_user") or os.environ.get("PG_USER") or "postgres").strip()
    password = (os.environ.get("pg_pass") or os.environ.get("pg_password") or os.environ.get("PG_PASS") or "")
    port = (os.environ.get("pg_port") or os.environ.get("PG_PORT") or "5432").strip()
    db = (os.environ.get("pg_db") or os.environ.get("PG_DB") or "postgres").strip()
    return f"postgresql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{db}"


def neo4j_settings() -> dict[str, str]:
    load_env()
    return {
        "uri": (os.environ.get("NEO4J_URI") or "neo4j://10.180.0.126:7474").strip(),
        "user": (os.environ.get("NEO4J_USER") or "neo4j").strip(),
        "password": os.environ.get("NEO4J_PASSWORD") or "",
    }


def llm_settings() -> dict[str, str]:
    load_env()
    return {
        "url": (os.environ.get("SQL_AGENT_LLM_URL") or "http://173.234.75.166:8011/v1").strip(),
        "model": (os.environ.get("SQL_AGENT_LLM_MODEL") or "worktual-gemma").strip(),
        "timeout": os.environ.get("SQL_AGENT_LLM_TIMEOUT") or "90",
    }

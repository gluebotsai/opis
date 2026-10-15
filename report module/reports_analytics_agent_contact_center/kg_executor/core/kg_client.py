"""Neo4j read session for Contact Center KG. Settings from product/kg/neo4j.yml."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import yaml

from .paths import KG_DIR

_DRIVER = None
_EXPAND = re.compile(r"\$\{([A-Za-z0-9_]+)(?::([^}]*))?\}")


def _expand(val: Any) -> Any:
    if isinstance(val, str):
        def repl(match: re.Match[str]) -> str:
            return os.getenv(match.group(1), match.group(2) if match.group(2) is not None else "")

        return _EXPAND.sub(repl, val)
    if isinstance(val, dict):
        return {k: _expand(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_expand(i) for i in val]
    return val


def load_neo4j_settings() -> dict[str, Any]:
    path = KG_DIR / "neo4j.yml"
    data = yaml.safe_load(path.read_text()) if path.exists() else {}
    data = _expand(data or {})
    if os.getenv("NEO4J_URI"):
        data["uri"] = os.getenv("NEO4J_URI")
    if os.getenv("NEO4J_USER"):
        data["user"] = os.getenv("NEO4J_USER")
    if os.getenv("NEO4J_PASSWORD"):
        data["password"] = os.getenv("NEO4J_PASSWORD")
    if os.getenv("NEO4J_MAX_ROWS"):
        data["max_rows"] = int(os.getenv("NEO4J_MAX_ROWS"))
    if os.getenv("NEO4J_READ_TIMEOUT_SECONDS"):
        data["read_timeout_seconds"] = float(os.getenv("NEO4J_READ_TIMEOUT_SECONDS"))
    env_orgs = os.getenv("KG_ALLOWED_ORGS")
    if env_orgs:
        data["allowed_orgs"] = [x.strip() for x in env_orgs.split(",") if x.strip()]
    data["uri"] = str(data.get("uri") or "").replace(":7474", ":7687")
    data.setdefault("user", os.getenv("NEO4J_USER", "neo4j"))
    data.setdefault("database_prefix", "org")
    data.setdefault("read_timeout_seconds", 30.0)
    data.setdefault("max_rows", 50)
    data.setdefault("allowed_orgs", ["1000", "1012"])
    return data


def org_db_name(organization_id: str | int) -> str:
    raw = str(organization_id).strip()
    if raw.startswith("org_"):
        raw = raw[4:]
    elif raw.startswith("org") and len(raw) > 3 and raw[3:].isdigit():
        raw = raw[3:]
    prefix = str(load_neo4j_settings().get("database_prefix") or "org")
    if raw.startswith(prefix):
        return raw
    return f"{prefix}{raw}"


def get_driver():
    global _DRIVER
    if _DRIVER is not None:
        return _DRIVER
    settings = load_neo4j_settings()
    uri = (settings.get("uri") or "").strip()
    if not uri:
        raise ValueError("NEO4J_URI is not set")
    from neo4j import GraphDatabase

    _DRIVER = GraphDatabase.driver(uri, auth=(settings.get("user"), settings.get("password") or ""))
    return _DRIVER


def close_driver() -> None:
    global _DRIVER
    if _DRIVER is not None:
        _DRIVER.close()
        _DRIVER = None


def apply_runtime(uri: str | None, user: str | None, password: str | None) -> None:
    """Point the Neo4j driver at Streamlit/harness payload values."""
    close_driver()
    if uri:
        os.environ["NEO4J_URI"] = uri.strip()
    if user:
        os.environ["NEO4J_USER"] = user.strip()
    if password is not None:
        os.environ["NEO4J_PASSWORD"] = password


def _cell(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, tuple, dict, set)):
        return json.dumps(value, default=str)
    return value


def execute_read(cypher: str, params: dict[str, Any], db_name: str) -> list[dict[str, Any]]:
    settings = load_neo4j_settings()
    timeout = float(settings.get("read_timeout_seconds") or 30)
    driver = get_driver()
    session = driver.session(database=db_name)
    try:
        def _run(tx):
            result = tx.run(cypher, params, timeout=timeout)
            rows = [
                {key: _cell(value) for key, value in dict(record).items()}
                for record in result
            ]
            result.consume()
            return rows

        return session.execute_read(_run)
    except Exception as exc:
        raise RuntimeError(f"Neo4j read failed ({db_name}): {exc}") from exc
    finally:
        session.close()

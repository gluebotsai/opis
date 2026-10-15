"""Org-scoped Postgres DQL. Never log the connection URL."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sql_agent.settings import load_env

ORG_CONVERSATIONS = "__org_conversations"


@dataclass(frozen=True)
class WarehouseSettings:
    url: str
    organization_id: str

    @property
    def enabled(self) -> bool:
        return bool(self.url)


def live_enabled() -> bool:
    return os.environ.get("SQL_AGENT_LIVE", "").strip().lower() in {"1", "true", "yes"}


def get_warehouse_settings() -> WarehouseSettings:
    load_env()
    url = (os.environ.get("DATABASE_URL") or "").strip()
    org = (
        os.environ.get("SQL_AGENT_ORG_ID")
        or os.environ.get("ORGANIZATION_ID")
        or "1000"
    ).strip()
    if org and not re.fullmatch(r"\d+", org):
        raise ValueError("organization_id must be numeric")
    return WarehouseSettings(url=normalize_pg_url(url), organization_id=org or "1000")


def normalize_pg_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    kept = [(key, value) for key, value in parse_qsl(parsed.query) if key.lower() in {"sslmode"}]
    return urlunparse(parsed._replace(query=urlencode(kept)))


def jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def format_duration_seconds(seconds: float) -> str:
    total = int(round(float(seconds)))
    if total < 60:
        return f"{total}s"
    minutes, sec = divmod(total, 60)
    if minutes < 60:
        return f"{minutes}m" if sec == 0 else f"{minutes}m {sec}s"
    hours, minutes = divmod(minutes, 60)
    if minutes == 0:
        return f"{hours}h"
    return f"{hours}h {minutes}m"


def display_value(key: str, value: Any) -> Any:
    name = key.casefold()
    if value is None:
        return "n/a"
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal)) and any(
        token in name for token in ("rate", "pct", "sla", "percent")
    ):
        return f"{round(float(value), 1)}%"
    if isinstance(value, (int, float, Decimal)) and (
        "seconds" in name or "handle_time" in name or name.endswith("_duration")
    ):
        return format_duration_seconds(float(value))
    if isinstance(value, float):
        return round(value, 2)
    return jsonable(value)


def enforce_org_scoped_conversations(sql: str, organization_id: str) -> str:
    if not re.fullmatch(r"\d+", organization_id):
        raise ValueError("organization_id must be numeric")
    if not re.search(r"ccass\.conversations\b", sql, re.IGNORECASE):
        return sql
    rewritten = re.sub(r"ccass\.conversations\b", ORG_CONVERSATIONS, sql, flags=re.IGNORECASE)
    cte = (
        f"{ORG_CONVERSATIONS} AS (\n"
        "  SELECT *\n"
        "  FROM ccass.conversations\n"
        f"  WHERE organization_id = '{organization_id}'::bigint\n"
        ")"
    )
    if re.match(r"WITH\b", rewritten, re.IGNORECASE):
        return re.sub(r"^WITH\s+", f"WITH {cte},\n", rewritten, count=1, flags=re.IGNORECASE)
    return f"WITH {cte}\n{rewritten}"


def execute_dql(sql: str, *, organization_id: str | None = None) -> dict[str, Any]:
    settings = get_warehouse_settings()
    if not settings.url:
        return {
            "ok": False,
            "dry_run": True,
            "warehouse": "unavailable",
            "error": "DATABASE_URL is not set",
        }
    org = organization_id or settings.organization_id
    scoped = enforce_org_scoped_conversations(sql, org)
    try:
        import psycopg
    except ImportError:
        return {
            "ok": False,
            "dry_run": True,
            "warehouse": "unavailable",
            "error": "psycopg is not installed in the NLP venv",
        }
    try:
        with psycopg.connect(settings.url, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT set_config('app.organization_id', %s, true)", (org,))
                cur.execute("SET LOCAL statement_timeout = '15000'")
                cur.execute(scoped)
                columns = [desc.name for desc in (cur.description or [])]
                fetched = cur.fetchall() if cur.description is not None else []
            conn.commit()
    except Exception as error:
        return {
            "ok": False,
            "dry_run": False,
            "warehouse": "error",
            "organization_id": org,
            "error": str(error).split("\n")[0],
        }
    rows = []
    for raw in fetched:
        row = {columns[index]: jsonable(raw[index]) for index in range(len(columns))}
        rows.append(row)
    preview = []
    for row in rows:
        preview.append(
            {
                key: display_value(key, value)
                for key, value in row.items()
                if key != "__total_matched_rows"
            }
        )
    return {
        "ok": True,
        "dry_run": False,
        "warehouse": "postgres",
        "organization_id": org,
        "columns": columns,
        "row_count": len(rows),
        "rows": rows,
        "preview": preview,
    }

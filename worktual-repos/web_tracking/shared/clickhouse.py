"""ClickHouse client helpers — single source for api/ and etl/."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Generator

from shared.env import load_project_env

load_project_env()

DEFAULT = {
    "host": "localhost",
    "port": 8123,
    "username": "default",
    "password": "",
    "database": "web_tracking",
}


def clickhouse_settings() -> dict[str, Any]:
    return {
        "host": os.environ.get("CLICKHOUSE_HOST", DEFAULT["host"]),
        "port": int(os.environ.get("CLICKHOUSE_PORT", str(DEFAULT["port"]))),
        "username": os.environ.get("CLICKHOUSE_USER", DEFAULT["username"]),
        "password": os.environ.get("CLICKHOUSE_PASSWORD", DEFAULT["password"]),
        "database": os.environ.get("CLICKHOUSE_DATABASE", DEFAULT["database"]),
    }


def get_client():
    import clickhouse_connect

    cfg = clickhouse_settings()
    return clickhouse_connect.get_client(
        host=cfg["host"],
        port=cfg["port"],
        username=cfg["username"],
        password=cfg["password"],
        database=cfg["database"],
    )


@contextmanager
def get_connection() -> Generator[Any, None, None]:
    client = get_client()
    try:
        yield client
    finally:
        client.close()


def query(client, sql: str, params: dict | None = None) -> list[dict]:
    result = client.query(sql, parameters=params or {})
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]


def query_one(client, sql: str, params: dict | None = None) -> dict | None:
    rows = query(client, sql, params)
    return rows[0] if rows else None


def execute(client, sql: str, params: dict | None = None) -> None:
    client.command(sql, parameters=params or {})

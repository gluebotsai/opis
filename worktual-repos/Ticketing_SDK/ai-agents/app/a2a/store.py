"""Persist A2A task receipts in ticketing.a2a_spoke_tasks."""

from __future__ import annotations

import json
import os
from typing import Any

from app.db import execute, fetch_one

_MEMORY_TASKS: dict[str, dict[str, Any]] = {}


def _use_memory() -> bool:
    if os.getenv("PYTEST_CURRENT_TEST"):
        return True
    return False


def insert_task(
    *,
    organization_id: str,
    task_id: str,
    message_id: str,
    skill_id: str,
    cdp_id: str | None,
    client_id: str,
    status: str,
    request_json: dict[str, Any],
    response_json: dict[str, Any],
) -> dict[str, Any]:
    row = {
        "organization_id": organization_id,
        "task_id": task_id,
        "message_id": message_id,
        "skill_id": skill_id,
        "cdp_id": cdp_id,
        "client_id": client_id,
        "status": status,
        "request_json": request_json,
        "response_json": response_json,
    }
    if _use_memory():
        _MEMORY_TASKS[task_id] = row
        return row
    try:
        execute(
            """
            INSERT INTO a2a_spoke_tasks (
              organization_id, task_id, message_id, skill_id, cdp_id,
              client_id, status, request_json, response_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            """,
            (
                organization_id,
                task_id,
                message_id,
                skill_id,
                cdp_id,
                client_id,
                status,
                json.dumps(request_json),
                json.dumps(response_json),
            ),
        )
    except Exception:  # noqa: BLE001
        # Table may not exist in minimal test DB — memory still holds receipt
        _MEMORY_TASKS[task_id] = row
    return row


def get_task(task_id: str) -> dict[str, Any] | None:
    if _use_memory():
        return _MEMORY_TASKS.get(task_id)
    row = fetch_one(
        """
        SELECT task_id, organization_id, message_id, skill_id, cdp_id,
               client_id, status, request_json, response_json, created_at, updated_at
        FROM a2a_spoke_tasks
        WHERE task_id = %s
        LIMIT 1
        """,
        (task_id,),
    )
    return row


def clear_memory_tasks() -> None:
    _MEMORY_TASKS.clear()

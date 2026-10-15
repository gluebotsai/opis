"""CRM-owned A2A task persistence (crm.a2a_spoke_tasks) plus memory fallback."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings

log = logging.getLogger("ai-service.a2a.store")

_MEMORY: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(
    *,
    task_id: str,
    context_id: str,
    organization_id: str,
    skill_id: str,
    state: str,
    actor_id: str,
    run_id: str,
    idempotency_key: str,
    receipt: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "task_id": task_id,
        "context_id": context_id,
        "organization_id": organization_id,
        "skill_id": skill_id,
        "state": state,
        "actor_id": actor_id,
        "run_id": run_id,
        "idempotency_key": idempotency_key,
        "receipt": receipt,
        "updated_at": _now(),
    }


async def save_task(record: dict[str, Any]) -> dict[str, Any]:
    _MEMORY[record["task_id"]] = dict(record)
    dsn = (get_settings().a2a_task_database_url or get_settings().database_url or "").strip()
    if not dsn:
        return record
    try:
        from app.mcp.db import acquire

        await _ensure_table()
        async with acquire() as conn:
            await conn.execute(
                """
                INSERT INTO a2a_spoke_tasks (
                  id, organization_id, task_id, context_id, skill_id, state,
                  actor_id, run_id, idempotency_key, receipt, created_at, updated_at
                ) VALUES (
                  $1, $2::bigint, $3, $4, $5, $6,
                  $7, $8, $9, $10::jsonb, NOW(), NOW()
                )
                ON CONFLICT (task_id) DO UPDATE SET
                  state = EXCLUDED.state,
                  receipt = EXCLUDED.receipt,
                  updated_at = NOW()
                """,
                record.get("id") or str(uuid.uuid4()),
                str(record["organization_id"]),
                record["task_id"],
                record.get("context_id") or "",
                record.get("skill_id") or "",
                record.get("state") or "WORKING",
                record.get("actor_id") or "",
                record.get("run_id") or "",
                record.get("idempotency_key") or "",
                json.dumps(record.get("receipt") or {}, default=str),
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("a2a task persist failed: %s", exc)
    return record


async def get_task(task_id: str) -> dict[str, Any] | None:
    if task_id in _MEMORY:
        return dict(_MEMORY[task_id])
    dsn = (get_settings().a2a_task_database_url or get_settings().database_url or "").strip()
    if not dsn:
        return None
    try:
        from app.mcp.db import fetchrow

        row = await fetchrow(
            """
            SELECT task_id, context_id, organization_id::text AS organization_id,
                   skill_id, state, actor_id, run_id, idempotency_key, receipt
            FROM a2a_spoke_tasks
            WHERE task_id = $1
            """,
            task_id,
        )
        if not row:
            return None
        record = dict(row)
        _MEMORY[task_id] = record
        return record
    except Exception as exc:  # noqa: BLE001
        log.warning("a2a task load failed: %s", exc)
        return None


async def _ensure_table() -> None:
    """No-op if Prisma migration applied; create in crm schema otherwise."""
    try:
        from app.mcp.db import acquire

        async with acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS a2a_spoke_tasks (
                  id TEXT PRIMARY KEY,
                  organization_id BIGINT NOT NULL,
                  task_id TEXT NOT NULL UNIQUE,
                  context_id TEXT NOT NULL DEFAULT '',
                  skill_id TEXT NOT NULL DEFAULT '',
                  state VARCHAR(32) NOT NULL,
                  actor_id VARCHAR(160) NOT NULL DEFAULT '',
                  run_id VARCHAR(160) NOT NULL DEFAULT '',
                  idempotency_key VARCHAR(240) NOT NULL DEFAULT '',
                  receipt JSONB,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
    except Exception as exc:  # noqa: BLE001
        log.debug("a2a_spoke_tasks ensure skipped: %s", exc)


def new_task_ids(existing_task: str | None, existing_context: str | None) -> tuple[str, str]:
    task_id = (existing_task or "").strip() or str(uuid.uuid4())
    context_id = (existing_context or "").strip() or str(uuid.uuid4())
    return task_id, context_id

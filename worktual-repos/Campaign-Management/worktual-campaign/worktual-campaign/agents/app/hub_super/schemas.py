"""Hub Super Agent task envelope — no clarification fields."""

from __future__ import annotations

import uuid
from typing import Any


def new_task_id() -> str:
    return str(uuid.uuid4())


def normalize_hub_request(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Validate and normalize a hub task request. Never asks for clarification."""
    data = raw if isinstance(raw, dict) else {}
    task_id = str(data.get("task_id") or "").strip() or new_task_id()
    intent = str(data.get("intent") or "").strip().lower().replace("-", "_")
    organization_id = str(
        data.get("organization_id") or data.get("org_id") or ""
    ).strip()
    token = str(data.get("token") or "").strip()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if not payload and isinstance(data.get("request"), dict):
        payload = data["request"]
    # Allow flat hub bodies: merge top-level operational fields into payload.
    flat_keys = (
        "request_text",
        "emails",
        "phones",
        "contact_ids",
        "customer_ids",
        "channels",
        "first_name",
        "last_name",
        "email",
        "phone",
        "company_name",
        "city",
        "campaign_id",
        "channel",
        "reason",
        "action",
        "name",
        "goal",
        "objective",
        "launch",
        "source",
    )
    merged = dict(payload)
    for key in flat_keys:
        if key in data and key not in merged:
            merged[key] = data[key]

    constraints = (
        data.get("constraints")
        if isinstance(data.get("constraints"), dict)
        else {}
    )
    pipeline = data.get("pipeline")
    if isinstance(pipeline, list):
        pipeline = [str(s).strip().lower() for s in pipeline if str(s).strip()]
    else:
        pipeline = None

    errors: list[dict[str, str]] = []
    if not intent and not pipeline:
        errors.append(
            {
                "code": "MISSING_INTENT",
                "message": "intent or pipeline is required",
            }
        )
    if not token:
        errors.append(
            {
                "code": "MISSING_TOKEN",
                "message": "token (Bearer JWT) is required for hub tasks",
            }
        )

    return {
        "task_id": task_id,
        "correlation_id": str(data.get("correlation_id") or "").strip(),
        "intent": intent,
        "organization_id": organization_id,
        "token": token,
        "payload": merged,
        "constraints": constraints,
        "pipeline": pipeline,
        "validation_errors": errors,
    }


def step_result(
    skill: str,
    *,
    status: str,
    data: dict[str, Any] | None = None,
    error: str | None = None,
    warnings: list[str] | None = None,
    latency_ms: int | None = None,
) -> dict[str, Any]:
    return {
        "skill": skill,
        "status": status,
        "data": data or {},
        "error": error,
        "warnings": list(warnings or []),
        "latency_ms": latency_ms,
    }


def hub_task_result(
    *,
    task_id: str,
    status: str,
    pipeline: list[str],
    step_results: list[dict[str, Any]],
    result: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
    errors: list[dict[str, Any]] | None = None,
    correlation_id: str = "",
) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "correlation_id": correlation_id or None,
        "status": status,
        "pipeline": pipeline,
        "step_results": step_results,
        "result": result or {},
        "warnings": list(warnings or []),
        "errors": list(errors or []),
    }

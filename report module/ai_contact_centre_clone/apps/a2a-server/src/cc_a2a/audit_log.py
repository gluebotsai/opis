"""Human-readable structured trace logs for Hub A2A invocations."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("a2a.trace")

_TEXT_PREVIEW_CHARS = 200


def configure_a2a_logging() -> None:
    """Ensure application logs are visible alongside uvicorn access logs."""
    level_name = os.environ.get("A2A_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(levelname)s: %(name)s: %(message)s",
        force=True,
    )
    logging.getLogger("a2a.trace").setLevel(level)


def _sanitize_arguments(arguments: dict[str, Any] | None) -> dict[str, Any]:
    if not arguments:
        return {}
    sanitized = dict(arguments)
    text = sanitized.get("text")
    if isinstance(text, str):
        trimmed = text.strip()
        sanitized.pop("text", None)
        sanitized["textLength"] = len(trimmed)
        if trimmed:
            if os.environ.get("A2A_LOG_VERBOSE", "").lower() in {"1", "true", "yes"}:
                sanitized["text"] = trimmed
            else:
                preview = trimmed[:_TEXT_PREVIEW_CHARS]
                sanitized["textPreview"] = preview + ("…" if len(trimmed) > _TEXT_PREVIEW_CHARS else "")
    return sanitized


def log_a2a_trace(
    phase: str,
    *,
    command_id: str | None = None,
    **fields: Any,
) -> None:
    """Emit one JSON line: phase=INPUT|STEP|OUTPUT|OAUTH_* plus correlation ids."""
    payload: dict[str, Any] = {"phase": phase}
    if command_id:
        payload["commandId"] = command_id
    payload.update(fields)
    logger.info("A2A %s", json.dumps(payload, default=str, ensure_ascii=False))


def log_envelope_input(
    *,
    command_id: str,
    skill_id: str,
    organization_id: str,
    arguments: dict[str, Any] | None,
    caller_subject: str,
    jsonrpc_method: str = "message/send",
) -> None:
    log_a2a_trace(
        "INPUT",
        command_id=command_id,
        method=jsonrpc_method,
        skillId=skill_id,
        organizationId=organization_id,
        callerSubject=caller_subject,
        arguments=_sanitize_arguments(arguments),
    )


def log_envelope_output(
    *,
    command_id: str,
    task_id: str | None,
    skill_id: str,
    organization_id: str,
    outcome: str,
    task_state: str | None = None,
    message: str | None = None,
    affected: dict[str, Any] | None = None,
    evidence: dict[str, Any] | None = None,
    idempotent_replay: bool = False,
    missing_fields: list[str] | None = None,
) -> None:
    output: dict[str, Any] = {
        "outcome": outcome,
        "taskState": task_state,
        "taskId": task_id,
        "skillId": skill_id,
        "organizationId": organization_id,
        "idempotentReplay": idempotent_replay,
    }
    if message:
        output["message"] = message
    if missing_fields:
        output["missingFields"] = missing_fields
    if affected:
        output["affected"] = affected
    if evidence:
        slim_evidence = {
            key: evidence[key]
            for key in (
                "outcome",
                "webchatId",
                "visitorId",
                "conversationId",
                "sessionStarted",
                "organizationId",
                "resolvedWebchat",
                "detail",
                "statusCode",
            )
            if key in evidence
        }
        if slim_evidence:
            output["evidence"] = slim_evidence
    log_a2a_trace("OUTPUT", command_id=command_id, **output)

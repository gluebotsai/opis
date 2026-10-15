"""Dedicated audit log for Hub → Campaign on-demand A2A turns.

Writes a clear, human-readable block per turn to /tmp/campaign-hub-ondemand.log
with BOTH the Hub request and the response we sent back to Hub.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_log = logging.getLogger("app.a2a.hub_ondemand")

DEFAULT_LOG_PATH = Path("/tmp/campaign-hub-ondemand.log")

_TOKEN_KEYS = frozenset(
    {
        "token",
        "campaigntoken",
        "campaign_token",
        "accesstoken",
        "access_token",
        "authorization",
        "api_token",
        "refreshtoken",
        "refresh_token",
        "client_secret",
        "clientsecret",
    }
)

_ON_DEMAND_SKILLS = frozenset(
    {
        "on-demand-send",
        "on_demand_send",
        "on_demand",
        "create-and-launch",
        "create_and_launch",
        "create-contact-and-send",
        "create_contact_and_send",
        "contact_then_send",
    }
)


def is_on_demand_skill(skill_id: str | None, intent: str | None = None) -> bool:
    sid = str(skill_id or "").strip().lower()
    intent_l = str(intent or "").strip().lower().replace("-", "_")
    if sid in _ON_DEMAND_SKILLS or sid.replace("_", "-") in {
        "on-demand-send",
        "create-and-launch",
        "create-contact-and-send",
    }:
        return True
    if intent_l in {
        "on_demand_send",
        "on_demand",
        "create_and_launch",
        "create_contact_and_send",
        "contact_then_send",
    }:
        return True
    return False


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            key = str(k)
            norm = key.lower().replace("-", "_")
            if norm in _TOKEN_KEYS or key.lower() in _TOKEN_KEYS:
                out[key] = "***REDACTED***"
            else:
                out[key] = _redact(v)
        return out
    if isinstance(value, list):
        return [_redact(v) for v in value]
    if isinstance(value, str) and re.match(r"^Bearer\s+\S+", value, re.I):
        return "Bearer ***REDACTED***"
    return value


def _pretty(value: Any) -> str:
    return json.dumps(_redact(value), ensure_ascii=False, indent=2, default=str)


def _append_file(block: str, path: Path | str | None = None) -> None:
    dest = Path(path) if path else DEFAULT_LOG_PATH
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("a", encoding="utf-8") as fh:
            fh.write(block)
            if not block.endswith("\n"):
                fh.write("\n")
    except Exception:  # noqa: BLE001
        _log.exception("failed to write hub on-demand audit log")


def log_json_block(
    title: str,
    value: Any,
    extra_lines: list[str] | None = None,
    path: Path | str | None = None,
) -> str:
    """Pretty-print a JSON-RPC request or response to stdout and the audit file."""
    lines = ["", "=" * 72, title]
    for line in extra_lines or []:
        if line:
            lines.append(line)
    lines.append("-" * 72)
    lines.append(_pretty(value))
    lines.append("=" * 72)
    lines.append("")
    block = "\n".join(lines)
    _log.info("%s", block)
    _append_file(block, path=path)
    return block


def _payload_summary(request: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(request, dict):
        return {}
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else {}
    raw = request.get("raw_data") if isinstance(request.get("raw_data"), dict) else {}
    return {
        "request_text": payload.get("request_text") or raw.get("request_text"),
        "cdp_id": request.get("cdp_id") or payload.get("cdp_id") or raw.get("cdpId"),
        "channels": payload.get("channels") or raw.get("channels"),
        "emails": payload.get("emails"),
        "phones": payload.get("phones"),
        "contact_ids": payload.get("contact_ids") or payload.get("customer_ids"),
        "name": payload.get("name"),
        "goal": payload.get("goal"),
    }


def _response_summary(
    dispatch_result: dict[str, Any] | None,
    rpc_response: dict[str, Any] | None,
) -> dict[str, Any]:
    dr = dispatch_result if isinstance(dispatch_result, dict) else {}
    task = dr.get("task") if isinstance(dr.get("task"), dict) else {}
    result = task.get("result") if isinstance(task.get("result"), dict) else {}
    state = None
    if isinstance(rpc_response, dict):
        status = rpc_response.get("status")
        if isinstance(status, dict):
            state = status.get("state")
        elif isinstance(status, str):
            state = status
    return {
        "ok": dr.get("ok"),
        "hub_status_state": state
        or ("completed" if dr.get("ok") else "failed" if dr else None),
        "error": dr.get("error"),
        "error_code": dr.get("error_code"),
        "task_status": task.get("status"),
        "pipeline": task.get("pipeline"),
        "campaign_id": result.get("campaign_id"),
        "contact_id": result.get("contact_id"),
        "warnings": task.get("warnings") or [],
        "errors": task.get("errors") or [],
    }


def _format_turn_block(
    *,
    ts: str,
    skill_id: str | None,
    intent: str | None,
    organization_id: str | None,
    source: str | None,
    message_id: str | None,
    request: dict[str, Any] | None,
    dispatch_result: dict[str, Any] | None,
    rpc_response: dict[str, Any] | None,
    error: str | None,
) -> str:
    summary_req = _payload_summary(request)
    summary_res = _response_summary(dispatch_result, rpc_response)
    if error and not summary_res.get("error"):
        summary_res["error"] = error

    lines = [
        "",
        "=" * 72,
        f"HUB ON-DEMAND TURN  {ts}",
        f"message_id: {message_id or '-'}",
        f"skill_id:   {skill_id or '-'}",
        f"intent:     {intent or '-'}",
        f"org:        {organization_id or '-'}",
        f"source:     {source or '-'}",
        "-" * 72,
        ">>> HUB REQUEST",
        f"request_text: {summary_req.get('request_text') or '-'}",
        f"cdp_id:       {summary_req.get('cdp_id') or '-'}",
        f"channels:     {summary_req.get('channels') or '-'}",
        f"contact_ids:  {summary_req.get('contact_ids') or '-'}",
        f"emails:       {summary_req.get('emails') or '-'}",
        f"phones:       {summary_req.get('phones') or '-'}",
        f"name/goal:    {summary_req.get('name') or '-'} / {summary_req.get('goal') or '-'}",
        "",
        "hub_request (full, tokens redacted):",
        _pretty(request or {}),
        "-" * 72,
        "<<< RESPONSE TO HUB",
        f"ok:              {summary_res.get('ok')}",
        f"hub_status:      {summary_res.get('hub_status_state')}",
        f"task_status:     {summary_res.get('task_status')}",
        f"pipeline:        {summary_res.get('pipeline')}",
        f"campaign_id:     {summary_res.get('campaign_id') or '-'}",
        f"contact_id:      {summary_res.get('contact_id') or '-'}",
        f"error_code:      {summary_res.get('error_code') or '-'}",
        f"error:           {summary_res.get('error') or '-'}",
        f"warnings:        {summary_res.get('warnings') or []}",
        f"errors:          {summary_res.get('errors') or []}",
        "",
        "response_to_hub (campaign-receipt / rpc, tokens redacted):",
        _pretty(
            rpc_response
            if rpc_response is not None
            else {
                "status": {
                    "state": "completed" if summary_res.get("ok") else "failed"
                },
                "dispatch_result": dispatch_result or {},
            }
        ),
        "=" * 72,
        "",
    ]
    return "\n".join(lines)


def log_hub_ondemand_turn(
    *,
    skill_id: str | None = None,
    intent: str | None = None,
    organization_id: str | None = None,
    source: str | None = None,
    message_id: str | None = None,
    request: dict[str, Any] | None = None,
    response: dict[str, Any] | None = None,
    rpc_response: dict[str, Any] | None = None,
    error: str | None = None,
    path: Path | str | None = None,
    # Kept for call-site compatibility; ignored (one block per turn).
    phase: str | None = None,
) -> None:
    """Append one clear turn block: Hub request + response we sent to Hub."""
    dest = Path(path) if path else DEFAULT_LOG_PATH
    ts = datetime.now(timezone.utc).isoformat()
    block = _format_turn_block(
        ts=ts,
        skill_id=skill_id,
        intent=intent,
        organization_id=organization_id,
        source=source,
        message_id=message_id,
        request=request,
        dispatch_result=response,
        rpc_response=rpc_response,
        error=error,
    )
    # Machine-readable twin line (optional grep) after the human block.
    twin = {
        "ts": ts,
        "skill_id": skill_id,
        "intent": intent,
        "organization_id": organization_id,
        "source": source,
        "message_id": message_id,
        "hub_request": _redact(request or {}),
        "response_to_hub": _redact(
            rpc_response
            if rpc_response is not None
            else {"dispatch_result": response or {}, "error": error}
        ),
        "error": error,
    }
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("a", encoding="utf-8") as fh:
            fh.write(block)
            fh.write("JSON_SUMMARY " + json.dumps(twin, ensure_ascii=False, default=str))
            fh.write("\n")
        ok = (response or {}).get("ok") if isinstance(response, dict) else None
        _log.info("%s", block)
        _log.info(
            "hub_ondemand_turn skill=%s org=%s ok=%s error=%s",
            skill_id,
            organization_id,
            ok,
            error,
        )
    except Exception:  # noqa: BLE001
        _log.exception("failed to write hub on-demand audit log")

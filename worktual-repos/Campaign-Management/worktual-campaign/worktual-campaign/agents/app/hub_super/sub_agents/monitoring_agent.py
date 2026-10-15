"""Monitoring Agent — campaign analysis and stop/resume (hub, no chat)."""

from __future__ import annotations

import uuid
from typing import Any

from app.agents.monitoring.tools.handlers import (
    handle_report,
    handle_resume,
    handle_stop,
    handle_stop_campaign,
)

SKILL_ID = "monitoring"

_VALID_ACTIONS = frozenset(
    {"report", "analyze", "stop_channel", "resume_channel", "stop_campaign"}
)


def _resolve_action(payload: dict[str, Any], intent: str) -> str:
    raw = str(payload.get("action") or "").strip().lower().replace("-", "_")
    if raw in _VALID_ACTIONS:
        return "report" if raw == "analyze" else raw
    intent_l = str(intent or "").strip().lower().replace("-", "_")
    if intent_l in {"stop_channel"}:
        return "stop_channel"
    if intent_l in {"resume_channel"}:
        return "resume_channel"
    if intent_l in {"stop_campaign"}:
        return "stop_campaign"
    return "report"


async def run_monitoring_agent(ctx: dict[str, Any]) -> dict[str, Any]:
    """Report / stop / resume. Hub must supply campaign_id (and reason for stop)."""
    token = str(ctx.get("token") or "").strip()
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    intent = str(ctx.get("intent") or "").strip()
    organization_id = str(ctx.get("organization_id") or "").strip()

    if not token:
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": "token required",
        }

    campaign_id = str(payload.get("campaign_id") or "").strip()
    if not campaign_id:
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": "campaign_id is required",
            "errors": [{"code": "MISSING_CAMPAIGN_ID", "field": "campaign_id"}],
        }

    action = _resolve_action(payload, intent)
    channel = str(payload.get("channel") or "").strip().lower()
    reason = str(payload.get("reason") or "").strip()
    session_id = str(
        payload.get("session_id")
        or ctx.get("session_id")
        or f"hub-monitoring-{organization_id or 'org'}-{uuid.uuid4().hex[:12]}"
    )

    args: dict[str, Any] = {
        "campaign_id": campaign_id,
        "change_summary": f"Hub Super Agent {action}",
    }

    if action == "report":
        result = await handle_report(session_id, token, args)
    elif action == "stop_channel":
        if not channel:
            return {
                "ok": False,
                "skill": SKILL_ID,
                "status": "failed",
                "error": "channel is required for stop_channel",
                "errors": [{"code": "MISSING_CHANNEL", "field": "channel"}],
            }
        if not reason:
            return {
                "ok": False,
                "skill": SKILL_ID,
                "status": "failed",
                "error": "reason is required for stop_channel",
                "errors": [{"code": "MISSING_REASON", "field": "reason"}],
            }
        args["channel"] = channel
        args["reason"] = reason
        result = await handle_stop(session_id, token, args)
    elif action == "resume_channel":
        if not channel:
            return {
                "ok": False,
                "skill": SKILL_ID,
                "status": "failed",
                "error": "channel is required for resume_channel",
                "errors": [{"code": "MISSING_CHANNEL", "field": "channel"}],
            }
        args["channel"] = channel
        result = await handle_resume(session_id, token, args)
    elif action == "stop_campaign":
        if not reason:
            return {
                "ok": False,
                "skill": SKILL_ID,
                "status": "failed",
                "error": "reason is required for stop_campaign",
                "errors": [{"code": "MISSING_REASON", "field": "reason"}],
            }
        args["reason"] = reason
        result = await handle_stop_campaign(session_id, token, args)
    else:
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": f"unsupported action: {action}",
        }

    ok = bool(result.get("ok"))
    return {
        "ok": ok,
        "skill": SKILL_ID,
        "status": "ok" if ok else "failed",
        "error": None if ok else (result.get("error") or f"{action} failed"),
        "action": action,
        "campaign_id": campaign_id,
        "report": result.get("report"),
        "message": result.get("message"),
        "session_id": session_id,
        "raw": result if not ok else None,
    }

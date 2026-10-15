"""On-Demand Agent — create campaign + launch automatically (hub, no chat)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.agents.on_demand import prepare_on_demand_send
from app.agents.on_demand.audience_identity import (
    collect_audience_identity,
    heuristic_identity_from_text,
    missing_contact_identity_error,
)
from app.config import get_settings

_log = logging.getLogger(__name__)

SKILL_ID = "on_demand"


def _api_base() -> str:
    return get_settings().campaign_api_base.rstrip("/")


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _merge_audience_from_context(
    payload: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    """Pull contact created by prior Contacts Agent step into launch audience."""
    out = dict(payload)
    prior = context.get("contacts") if isinstance(context.get("contacts"), dict) else {}
    contact = prior.get("contact") if isinstance(prior.get("contact"), dict) else {}
    contact_id = str(prior.get("contact_id") or contact.get("id") or "").strip()
    email = str(contact.get("email") or out.get("email") or "").strip()
    phone = str(contact.get("phone") or out.get("phone") or "").strip()

    contact_ids = [
        str(x).strip()
        for x in (out.get("contact_ids") or out.get("customer_ids") or [])
        if str(x).strip()
    ]
    emails = [str(x).strip().lower() for x in (out.get("emails") or []) if str(x).strip()]
    phones = [str(x).strip() for x in (out.get("phones") or []) if str(x).strip()]

    if contact_id and contact_id not in contact_ids:
        contact_ids.append(contact_id)
    if email and email not in emails:
        emails.append(email)
    if phone and phone not in phones:
        phones.append(phone)

    if contact_ids:
        out["contact_ids"] = contact_ids
        out["customer_ids"] = contact_ids
    if emails:
        out["emails"] = emails
    if phones:
        out["phones"] = phones
    return out


async def run_on_demand_agent(ctx: dict[str, Any]) -> dict[str, Any]:
    """Create + launch on-demand campaign. Never asks the hub for clarification."""
    token = str(ctx.get("token") or "").strip()
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    prior = ctx.get("prior") if isinstance(ctx.get("prior"), dict) else {}
    payload = _merge_audience_from_context(payload, prior)

    request_text = str(payload.get("request_text") or "").strip()
    if not request_text:
        # Build a minimal operator instruction from structured fields.
        bits = []
        if payload.get("name") or payload.get("goal"):
            bits.append(
                str(payload.get("goal") or payload.get("name") or "Follow-up").strip()
            )
        ids = payload.get("contact_ids") or payload.get("customer_ids") or []
        if ids:
            bits.append(f"contact_ids={','.join(str(i) for i in ids[:5])}")
        emails = payload.get("emails") or []
        if emails:
            bits.append(f"emails={','.join(str(e) for e in emails[:5])}")
        if payload.get("email"):
            bits.append(f"email={payload.get('email')}")
        request_text = " ".join(bits).strip() or "On-demand send from hub"

    if not token:
        return {
            "ok": False,
            "skill": SKILL_ID,
            "error": "token required",
            "status": "failed",
        }

    launch = payload.get("launch")
    if launch is None:
        launch = True
    launch = bool(launch)

    # Structured audience first; free-text identity is validated by prepare/backend.
    body = {
        "request_text": request_text,
        "emails": list(payload.get("emails") or []),
        "phones": list(payload.get("phones") or []),
        "contact_ids": list(
            payload.get("contact_ids") or payload.get("customer_ids") or []
        ),
        "customer_ids": list(
            payload.get("customer_ids") or payload.get("contact_ids") or []
        ),
        "channels": list(payload.get("channels") or []),
        "name": payload.get("name"),
        "goal": payload.get("goal"),
        "objective": payload.get("objective"),
        "source": str(payload.get("source") or "hub"),
        "orchestration_mode": payload.get("orchestration_mode") or "prefer_primary",
        "broadcast_confirmed": bool(payload.get("broadcast_confirmed")),
    }
    if payload.get("email") and str(payload.get("email")).strip():
        emails = list(body.get("emails") or [])
        em = str(payload.get("email")).strip().lower()
        if em not in emails:
            emails.append(em)
        body["emails"] = emails
    # Drop empty lists so backend schema stays happy.
    for key in ("emails", "phones", "contact_ids", "customer_ids", "channels"):
        if not body[key]:
            body.pop(key, None)

    # Same identity rules as prepare — abort before HTTP launch when nothing resolvable.
    probe = collect_audience_identity(heuristic_identity_from_text(request_text), body)
    abort_msg = missing_contact_identity_error(probe)
    if abort_msg:
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": abort_msg,
            "error_code": "missing_contact_identity",
            "aborted": True,
        }

    if not launch:
        prepare = await prepare_on_demand_send(
            {
                "request_text": request_text,
                "channels": payload.get("channels"),
                "name": payload.get("name"),
                "goal": payload.get("goal"),
                "objective": payload.get("objective"),
                "emails": body.get("emails"),
                "phones": body.get("phones"),
                "contact_ids": body.get("contact_ids"),
                "customer_ids": body.get("customer_ids"),
            }
        )
        ok = bool(prepare.get("ok"))
        return {
            "ok": ok,
            "skill": SKILL_ID,
            "status": "ok" if ok else "failed",
            "error": None if ok else (prepare.get("error") or "prepare failed"),
            "error_code": prepare.get("error_code"),
            "aborted": bool(prepare.get("aborted")),
            "prepare_only": True,
            "analysis": prepare.get("analysis"),
            "campaign": prepare.get("campaign"),
            "channels": prepare.get("channels"),
            "templates": prepare.get("templates") or [],
            "launch": None,
        }

    try:
        async with httpx.AsyncClient(timeout=240.0) as client:
            res = await client.post(
                f"{_api_base()}/campaigns/on-demand",
                headers=_headers(token),
                json=body,
            )
            data = res.json() if res.content else {}
    except Exception as exc:  # noqa: BLE001
        _log.exception("on_demand_agent launch failed")
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": f"On-demand launch failed: {exc}",
        }

    if res.status_code >= 400:
        message = (
            (data.get("message") if isinstance(data, dict) else None)
            or (data.get("error") if isinstance(data, dict) else None)
            or res.text
            or f"HTTP {res.status_code}"
        )
        if (
            res.status_code >= 500
            and str(message).strip().lower() == "internal server error"
        ):
            _log.error(
                "on_demand backend %s with generic message; body=%s",
                res.status_code,
                (res.text or "")[:2000],
            )
            message = (
                "Campaign on-demand launch failed (server error). "
                "Check backend logs for org at POST /campaigns/on-demand — "
                "common causes: agents prepare unreachable, DB/contact resolution, "
                "or creation-agent template failure."
            )
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": str(message),
            "http_status": res.status_code,
        }

    # sendSuccess wraps payload; tolerate flat or nested shapes.
    result = data.get("data") if isinstance(data.get("data"), dict) else data
    campaign = result.get("campaign") if isinstance(result.get("campaign"), dict) else {}
    run = result.get("run") if isinstance(result.get("run"), dict) else {}
    launch = result.get("launch") if isinstance(result.get("launch"), dict) else {}
    launch_run = launch.get("run") if isinstance(launch.get("run"), dict) else {}
    campaign_id = str(
        result.get("campaign_id")
        or run.get("id")
        or launch_run.get("id")
        or launch.get("campaign_id")
        or result.get("id")
        or campaign.get("id")
        or ""
    ).strip()

    return {
        "ok": True,
        "skill": SKILL_ID,
        "status": "ok",
        "campaign_id": campaign_id or None,
        "launch": result,
        "request_text": request_text,
    }

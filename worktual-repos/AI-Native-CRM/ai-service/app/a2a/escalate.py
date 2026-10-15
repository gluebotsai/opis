"""Escalate leftover non-CRM work to Hub. Never bounce Hub-delegated tasks."""

from __future__ import annotations

import logging
import re
from typing import Any, Mapping

from app.a2a.catalog import list_spoke_skills
from app.a2a.payload import is_delegated
from app.config import get_settings

log = logging.getLogger("ai-service.a2a.escalate")

_FAILED_STATES = {"failed", "canceled", "rejected"}
_WORKING_STATES = {"submitted", "working"}
_PENDING_SPEECH = (
    "Hub is still working on this leftover request. "
    "It will call CRM when it has a next action."
)


def remainder_failed(result: Mapping[str, Any] | None) -> bool:
    if not isinstance(result, dict) or result.get("pending"):
        return False
    if result.get("ok") is False:
        return True
    status = result.get("status") if isinstance(result.get("status"), dict) else {}
    state = str(status.get("state") or result.get("state") or "").lower()
    return state in _FAILED_STATES


def remainder_pending(result: Mapping[str, Any] | None) -> bool:
    if not isinstance(result, dict) or remainder_failed(result):
        return False
    if result.get("pending"):
        return True
    status = result.get("status") if isinstance(result.get("status"), dict) else {}
    state = str(status.get("state") or result.get("state") or "").lower()
    return state in _WORKING_STATES


def _local_tags() -> set[str]:
    tags: set[str] = set()
    for skill in list_spoke_skills():
        tags.add(skill.id.lower())
        tags.update(tag.lower() for tag in skill.tags)
    return tags


def matches_peer_skill(text: str, peer_tags: tuple[str, ...], local_tags: set[str]) -> bool:
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    for tag in peer_tags:
        token = tag.strip().lower()
        if not token or token in local_tags or token.startswith("kind:") or token.startswith("business:"):
            continue
        if token in {"crm", "coworker", "proactive", "mutationcapable"}:
            continue
        if re.search(rf"\b{re.escape(token)}\b", lowered):
            return True
    return False


async def maybe_escalate_to_hub(
    *,
    text: str,
    payload: Mapping[str, Any],
    context_id: str | None = None,
) -> dict[str, Any] | None:
    if is_delegated(payload):
        return None
    settings = get_settings()
    if not settings.hub_a2a_url.strip():
        return None
    from app.a2a.hub_client import leftover_domain_tags, send_to_hub

    if not matches_peer_skill(text, leftover_domain_tags(), _local_tags()):
        return None
    try:
        result = await send_to_hub(
            text=text,
            metadata={
                "organization_id": payload.get("organizationId") or payload.get("organization_id"),
                "cdp_id": payload.get("cdpId") or payload.get("cdp_id") or payload.get("contactId") or payload.get("contact_id"),
                "channel": payload.get("channel") or payload.get("surface") or "chat",
            },
            context_id=context_id,
        )
        return result
    except Exception as exc:  # noqa: BLE001
        log.warning("hub escalate failed: %s", exc)
        return {
            "ok": False,
            "error": "The other product is unavailable right now.",
            "assistantText": "I couldn't reach Hub to finish that request. Try again shortly.",
        }


async def maybe_escalate_coworker_turn(
    *,
    messages: list[dict[str, Any]] | None,
    context: Mapping[str, Any] | None,
    organization_id: str | None,
) -> dict[str, Any] | None:
    ctx = dict(context or {})
    if is_delegated(ctx) or str(ctx.get("source") or "").lower() == "hub":
        return None
    pathname = str(ctx.get("pathname") or "").strip()
    if pathname.startswith("/marketing/seo"):
        return None
    settings = get_settings()
    if not settings.hub_a2a_url.strip():
        return None
    from app.agents.coworker_shared import last_user_text

    text = last_user_text(messages) or ""
    payload = {
        **ctx,
        "organizationId": organization_id or ctx.get("organizationId"),
    }
    result = await maybe_escalate_to_hub(text=text, payload=payload)
    if result is None:
        return None
    from app.a2a.log import log_a2a

    failed = remainder_failed(result)
    pending = remainder_pending(result)
    if result.get("assistantText"):
        outcome = "error" if failed else ("pending" if pending else "received")
        log_a2a(
            step="crm_reply",
            ok=not failed,
            crm={
                "assistantText": str(result.get("assistantText"))[:800],
                "mode": "remainder",
                "outcome": outcome,
            },
            message="CRM leftover reply",
        )
        return {
            "ok": False if failed else True,
            "pending": pending,
            "assistantText": result.get("assistantText"),
            "error": result.get("error"),
        }
    artifact = result.get("artifacts") or result.get("status")
    speech = None
    if isinstance(result.get("status"), dict):
        message = result["status"].get("message") or {}
        parts = message.get("parts") or []
        for part in parts:
            if isinstance(part, dict) and part.get("text"):
                speech = part["text"]
                break
    if failed:
        err = result.get("error")
        if isinstance(err, dict):
            speech = str(err.get("message") or err)
        elif err:
            speech = str(err)
        else:
            speech = "Hub leftover work failed."
        log_a2a(
            step="crm_reply",
            ok=False,
            crm={"assistantText": speech[:800], "mode": "remainder", "outcome": "error"},
            message="CRM leftover reply",
        )
        return {"ok": False, "assistantText": speech, "error": result.get("error"), "hubResult": artifact or result}
    if pending:
        speech = speech or _PENDING_SPEECH
        log_a2a(
            step="crm_reply",
            ok=True,
            crm={"assistantText": str(speech)[:800], "mode": "remainder", "outcome": "pending"},
            message="CRM leftover reply",
        )
        return {"ok": True, "pending": True, "assistantText": str(speech), "hubResult": artifact or result}
    if not speech:
        speech = "Hub finished the leftover work."
    log_a2a(
        step="crm_reply",
        ok=True,
        crm={"assistantText": str(speech)[:800], "mode": "remainder", "outcome": "received"},
        message="CRM leftover reply",
    )
    return {"ok": True, "assistantText": str(speech), "hubResult": artifact or result}

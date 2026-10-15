"""Structured CRM Personalised CRM prepare — no Hub request_text analysis."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.on_demand.audience_identity import (
    collect_audience_identity,
    missing_contact_identity_error,
)
from app.agents.template_library import run_creation_agent

_log = logging.getLogger(__name__)

_SENDABLE = frozenset({"email", "push", "web", "whatsapp"})


def flatten_crm_people(payload: dict[str, Any]) -> dict[str, Any]:
    """Lift people[] into emails / phones / contact_ids for identity collect."""
    body = dict(payload or {})
    emails = [str(e).strip() for e in (body.get("emails") or []) if str(e).strip()]
    phones = [str(p).strip() for p in (body.get("phones") or []) if str(p).strip()]
    contact_ids = [
        str(i).strip()
        for i in (body.get("contact_ids") or body.get("customer_ids") or [])
        if str(i).strip()
    ]
    people = body.get("people")
    if isinstance(people, list):
        for row in people:
            if not isinstance(row, dict):
                continue
            email = str(row.get("email") or "").strip()
            phone = str(row.get("phone") or "").strip()
            cid = str(
                row.get("contact_id")
                or row.get("customer_id")
                or row.get("id")
                or ""
            ).strip()
            if email:
                emails.append(email)
            if phone:
                phones.append(phone)
            if cid:
                contact_ids.append(cid)
    body["emails"] = emails
    body["phones"] = phones
    body["contact_ids"] = contact_ids
    body["customer_ids"] = contact_ids
    return body


def _channels(payload: dict[str, Any]) -> list[str]:
    raw = payload.get("channels")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        ch = str(item or "").strip().lower()
        if ch in {"app_push", "apppush"}:
            ch = "push"
        if ch in {"web_push", "webpush"}:
            ch = "web"
        if ch in _SENDABLE and ch not in out:
            out.append(ch)
    return out


async def prepare_personalised_crm_send(payload: dict[str, Any]) -> dict[str, Any]:
    """Generate channel templates for a CRM-named audience. Channels come from CRM."""
    body = flatten_crm_people(payload if isinstance(payload, dict) else {})
    channels = _channels(body)
    if not channels:
        return {
            "ok": False,
            "error": "channels is required (email, whatsapp, push, and/or web).",
            "error_code": "missing_channels",
            "templates": [],
            "aborted": True,
        }

    identity = collect_audience_identity({}, body)
    abort = missing_contact_identity_error(identity)
    if abort:
        return {
            "ok": False,
            "error": abort.replace("on-demand plan", "Personalised CRM request").replace(
                "On-demand plan", "Personalised CRM request"
            ),
            "error_code": "missing_contact_identity",
            "channels": channels,
            "templates": [],
            "aborted": True,
        }

    name = str(body.get("name") or "Personalised CRM").strip() or "Personalised CRM"
    brief = str(body.get("brief") or body.get("objective") or body.get("goal") or "").strip()
    insight = brief or "Personal follow-up requested from CRM."
    campaign = {
        "name": name[:200],
        "goal": str(body.get("goal") or insight)[:240],
        "objective": str(body.get("objective") or insight)[:400],
    }
    audience_bits = (
        identity["emails"][:5] + identity["phones"][:3] + identity["customer_ids"][:3]
    )
    audience = {
        "matched_count": max(len(audience_bits), 1),
        "description": (
            f"Personalised CRM audience. Operator brief (INTERNAL): {insight}. "
            f"Contacts: {', '.join(audience_bits) or 'named contacts'}."
        ),
        "filters": "",
        "summary": ", ".join(audience_bits),
        "insight": insight,
        "emails": identity["emails"],
    }
    channel_plans = [
        {
            "channel": ch,
            "how_it_works": (
                f"Personalised CRM {ch}: write recipient-facing copy from the brief. "
                "Do not mention CRM, Hub, or operator instructions."
            ),
        }
        for ch in channels
    ]

    try:
        org_id = str(body.get("organization_id") or body.get("organizationId") or "")
        created = await run_creation_agent(
            campaign=campaign,
            audience=audience,
            channels=channels,
            channel_plans=channel_plans,
            user_request=insight,
            session={"organization_id": org_id} if org_id else None,
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("personalised-crm run_creation_agent failed")
        return {
            "ok": False,
            "error": f"Template creation agent failed: {exc}",
            "campaign": campaign,
            "channels": channels,
            "templates": [],
        }

    by_channel: dict[str, dict[str, Any]] = {}
    for row in created.get("templates") or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        if not ch or not fields:
            continue
        if ch == "email":
            subject = str(fields.get("subject") or "").strip()
            paras = fields.get("paragraphs") if isinstance(fields.get("paragraphs"), list) else []
            sections = fields.get("sections") if isinstance(fields.get("sections"), list) else []
            html = str(fields.get("compiled_html") or "").strip()
            has_body = (
                any(str(p).strip() for p in paras) or bool(sections) or len(html) > 40
            )
            if not subject or not has_body:
                continue
        by_channel[ch] = {
            "channel": ch,
            "fields": fields,
            "how_it_works": row.get("how_it_works") or f"Personalised CRM {ch}",
            "fallback": False,
        }

    templates_out: list[dict[str, Any]] = []
    missing: list[str] = []
    for ch in channels:
        if ch in by_channel:
            templates_out.append(by_channel[ch])
        else:
            missing.append(ch)

    gen_errors = list(created.get("errors") or [])
    if missing:
        return {
            "ok": False,
            "error": (
                "Creation agent did not produce usable templates for: "
                + ", ".join(missing)
                + (f" ({'; '.join(gen_errors[:3])})" if gen_errors else ".")
            ),
            "campaign": campaign,
            "channels": channels,
            "templates": templates_out,
            "missing_channels": missing,
        }

    return {
        "ok": True,
        "campaign": campaign,
        "channels": channels,
        "templates": templates_out,
        "identity": identity,
        "generation": {"ok": bool(created.get("ok")), "errors": gen_errors},
    }

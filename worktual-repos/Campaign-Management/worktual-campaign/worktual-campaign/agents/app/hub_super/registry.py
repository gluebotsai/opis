"""Map skill ids to autonomous sub-agent runners."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from app.hub_super.sub_agents.monitoring_agent import run_monitoring_agent
from app.hub_super.sub_agents.on_demand_agent import run_on_demand_agent

SkillRunner = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


def _hub_create_query(payload: dict[str, Any]) -> str:
    first = str(payload.get("first_name") or "").strip()
    email = str(payload.get("email") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    parts = ["Create contact"]
    if first:
        parts.append(first)
    if email:
        parts.append(email)
    elif phone:
        parts.append(phone)
    return " ".join(parts).strip() or "Create contact"


def _hub_monitoring_query(intent: str, payload: dict[str, Any]) -> str:
    campaign_id = str(payload.get("campaign_id") or "").strip()
    action = str(payload.get("action") or intent or "campaign_report").strip()
    channel = str(payload.get("channel") or "").strip()
    parts = [action.replace("_", " ")]
    if campaign_id:
        parts.append(f"campaign {campaign_id}")
    if channel:
        parts.append(f"channel {channel}")
    return " ".join(parts).strip() or "Campaign monitoring report"


def _audience_from_temp_rows(rows: list[Any]) -> tuple[list[str], list[str]]:
    emails: list[str] = []
    phones: list[str] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        em = str(item.get("email") or "").strip().lower()
        ph = str(
            item.get("phone")
            or item.get("whatsappNumber")
            or item.get("phoneNumber")
            or ""
        ).strip()
        if em and em not in emails:
            emails.append(em)
        if ph and ph not in phones:
            phones.append(ph)
    return emails, phones


def _hub_whatsapp_query(payload: dict[str, Any]) -> str:
    text = str(payload.get("request_text") or "").strip()
    if text:
        return text
    tpl = str(payload.get("template_name") or payload.get("template_id") or "").strip()
    phones = payload.get("phones") if isinstance(payload.get("phones"), list) else []
    bits = ["Send approved WhatsApp template"]
    if tpl:
        bits.append(tpl)
    if phones:
        bits.append(f"to {len(phones)} phone(s)")
    return " ".join(bits).strip()


def _hub_image_query(payload: dict[str, Any]) -> str:
    prompt = str(payload.get("prompt") or payload.get("request_text") or "").strip()
    return prompt or "Generate campaign image from hub"


def _hub_on_demand_query(payload: dict[str, Any]) -> str:
    name = str(payload.get("campaign_name") or payload.get("name") or "").strip()
    channels = payload.get("channels")
    ch_text = ""
    if isinstance(channels, list) and channels:
        ch_text = " ".join(str(c) for c in channels[:4])
    bits = ["On-demand send"]
    if name:
        bits.append(name)
    if ch_text:
        bits.append(ch_text)
    return " ".join(bits).strip() or "On-demand send from hub"


async def _hub_via_mas_super(
    ctx: dict[str, Any],
    *,
    hub_skill: str,
    query: str,
    task_spec: dict[str, Any],
    skill: str,
    legacy_runner: SkillRunner | None = None,
    domain_check: str | None = None,
) -> dict[str, Any]:
    """Hub skill — full MAS: Super → Domain → Executor."""
    if domain_check:
        from app.mas.runtime.flags import is_domain_enabled

        if not is_domain_enabled(domain_check):
            if legacy_runner is not None:
                return await legacy_runner(ctx)
            return {"ok": False, "skill": skill, "status": "failed", "error": "MAS domain disabled"}

    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    token = str(ctx.get("token") or "").strip()
    organization_id = str(ctx.get("organization_id") or "").strip()
    session_id = str(ctx.get("session_id") or payload.get("session_id") or "").strip()
    intent = str(ctx.get("intent") or hub_skill).strip()

    from app.mas.runtime.invoke import mas_invoke

    spec = {
        **task_spec,
        "hub_entry": True,
        "hub_skill": hub_skill,
        "query": query,
        "intent": intent,
        "session_id": session_id or payload.get("session_id"),
        "organization_id": organization_id,
    }
    out = await mas_invoke(
        {
            "entry": "hub",
            "skip_super": False,
            "query": query,
            "hub_skill": hub_skill,
            "intent": intent,
            "token": token,
            "organization_id": organization_id,
            "session_id": session_id,
            "task_spec": spec,
            "session": {},
        }
    )
    domain_result = (
        out.get("domain_result") if isinstance(out.get("domain_result"), dict) else out
    )
    result = (
        domain_result.get("result")
        if isinstance(domain_result.get("result"), dict)
        else domain_result
    )
    if not isinstance(result, dict):
        result = out

    ok = bool(out.get("ok") and domain_result.get("action_status") != "failed")
    if isinstance(result, dict) and result.get("skill") == skill:
        return result

    message = (
        out.get("message")
        or domain_result.get("message")
        or domain_result.get("reply")
        or (result or {}).get("message")
    )
    merged: dict[str, Any] = {
        "ok": ok,
        "skill": skill,
        "status": "ok" if ok else "failed",
        "error": None if ok else (out.get("error") or message or f"{skill} failed"),
        "message": message,
        "raw": out if not ok else None,
        "mas": True,
    }
    for key in (
        "contact_id",
        "contact",
        "session_id",
        "campaign_id",
        "templates",
        "launch",
        "analysis",
        "report",
        "action",
        "action_result",
        "image_url",
        "send_result",
    ):
        val = (
            out.get(key)
            or domain_result.get(key)
            or (result or {}).get(key)
        )
        if val is not None:
            merged[key] = val
    if not merged.get("session_id"):
        merged["session_id"] = session_id
    return merged


async def _contacts_via_mas_or_legacy(ctx: dict[str, Any]) -> dict[str, Any]:
    """Hub create_contact — Super → Audience Domain → contact executor."""
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    query = _hub_create_query(payload)
    return await _hub_via_mas_super(
        ctx,
        hub_skill="create_contact",
        query=query,
        task_spec={
            "force_super": True,
            "hub_create": True,
            "module": "contacts",
            "first_name": payload.get("first_name"),
            "last_name": payload.get("last_name"),
            "email": payload.get("email"),
            "phone": payload.get("phone"),
            "company_name": payload.get("company_name"),
            "city": payload.get("city"),
        },
        skill="contacts",
        legacy_runner=None,
        domain_check="audience",
    )


async def _monitoring_via_mas_or_legacy(ctx: dict[str, Any]) -> dict[str, Any]:
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    intent = str(ctx.get("intent") or "campaign_report")
    query = _hub_monitoring_query(intent, payload)
    return await _hub_via_mas_super(
        ctx,
        hub_skill=intent,
        query=query,
        task_spec={
            "hub_monitoring": True,
            "module": "monitoring",
            "campaign_id": payload.get("campaign_id"),
            "action": payload.get("action"),
            "channel": payload.get("channel"),
            "reason": payload.get("reason"),
        },
        skill="monitoring",
        legacy_runner=run_monitoring_agent,
        domain_check="optimization",
    )


async def _whatsapp_send_via_mas(ctx: dict[str, Any]) -> dict[str, Any]:
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    query = _hub_whatsapp_query(payload)
    confirmed = payload.get("user_confirmed")
    if confirmed is None:
        confirmed = True
    return await _hub_via_mas_super(
        ctx,
        hub_skill="send_approved_whatsapp",
        query=query,
        task_spec={
            "hub_whatsapp_send": True,
            "module": "whatsapp_approved",
            "module_hint": "whatsapp_approved",
            "template_id": payload.get("template_id"),
            "template_name": payload.get("template_name"),
            "phones": list(payload.get("phones") or []),
            "contact_ids": list(payload.get("contact_ids") or []),
            "user_confirmed": bool(confirmed),
            "payload": payload,
        },
        skill="whatsapp_send",
        legacy_runner=None,
        domain_check="content",
    )


async def _image_gen_via_mas(ctx: dict[str, Any]) -> dict[str, Any]:
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    query = _hub_image_query(payload)
    return await _hub_via_mas_super(
        ctx,
        hub_skill="generate_image",
        query=query,
        task_spec={
            "hub_image_generate": True,
            "module": "image",
            "executor_id": "image_generate",
            "prompt": payload.get("prompt"),
            "campaign_id": payload.get("campaign_id"),
            "attach_to_template": payload.get("attach_to_template"),
            "payload": payload,
        },
        skill="image_gen",
        legacy_runner=None,
        domain_check="image",
    )


async def _temp_audience_send_via_mas(ctx: dict[str, Any]) -> dict[str, Any]:
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        return {
            "ok": False,
            "skill": "temp_audience_send",
            "status": "failed",
            "error": "rows required (non-empty array of contacts)",
            "error_code": "TEMP_CONTACTS_EMPTY",
        }
    emails, phones = _audience_from_temp_rows(rows)
    if not emails and not phones:
        return {
            "ok": False,
            "skill": "temp_audience_send",
            "status": "failed",
            "error": "Each row needs email or phone",
            "error_code": "TEMP_CONTACTS_EMPTY",
        }
    enriched = dict(payload)
    merged_emails = [
        str(x).strip().lower()
        for x in (enriched.get("emails") or [])
        if str(x).strip()
    ]
    merged_phones = [
        str(x).strip() for x in (enriched.get("phones") or []) if str(x).strip()
    ]
    for em in emails:
        if em not in merged_emails:
            merged_emails.append(em)
    for ph in phones:
        if ph not in merged_phones:
            merged_phones.append(ph)
    enriched["emails"] = merged_emails
    enriched["phones"] = merged_phones
    enriched.pop("rows", None)
    ctx2 = {**ctx, "payload": enriched, "intent": "temp_audience_and_send"}
    return await _on_demand_via_mas_or_legacy(ctx2)


async def _on_demand_via_mas_or_legacy(ctx: dict[str, Any]) -> dict[str, Any]:
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    intent = str(ctx.get("intent") or "on_demand_send")
    query = _hub_on_demand_query(payload)
    return await _hub_via_mas_super(
        ctx,
        hub_skill=intent,
        query=query,
        task_spec={
            "hub_on_demand": True,
            "module": "create_campaign",
            "payload": payload,
            "intent": intent,
        },
        skill="on_demand",
        legacy_runner=run_on_demand_agent,
        domain_check="creation",
    )


SKILL_RUNNERS: dict[str, SkillRunner] = {
    "on_demand": _on_demand_via_mas_or_legacy,
    "contacts": _contacts_via_mas_or_legacy,
    "monitoring": _monitoring_via_mas_or_legacy,
    "whatsapp_send": _whatsapp_send_via_mas,
    "image_gen": _image_gen_via_mas,
    "temp_audience_send": _temp_audience_send_via_mas,
}


def get_runner(skill_id: str) -> SkillRunner | None:
    return SKILL_RUNNERS.get(str(skill_id or "").strip().lower())

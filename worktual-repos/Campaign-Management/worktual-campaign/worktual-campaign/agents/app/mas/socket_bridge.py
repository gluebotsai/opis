"""Socket helpers to run module turns through MAS when the domain flag is on."""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from app.mas.catalog import MODULE_TO_DOMAIN
from app.mas.runtime.flags import is_module_mas_enabled
from app.mas.runtime.invoke import mas_invoke
from app.mas.runtime.task_memory import get_mas_task
from app.session_store import get_or_create_session, public_state, save_session

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


async def _apply_whatsapp_approved_post_turn(
    *,
    session_id: str,
    token: str,
    user_text: str,
    event_callback: ProgressCallback | None,
    result: dict[str, Any],
) -> dict[str, Any]:
    _ = (user_text, event_callback)
    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_approved"
    )
    await save_session(session, token=token)
    result["state"] = public_state(session)
    return result


async def _apply_create_campaign_post_turn(
    *,
    session_id: str,
    token: str,
    user_text: str,
    event_callback: ProgressCallback | None,
    result: dict[str, Any],
) -> dict[str, Any]:
    """Refresh public session state after a create-campaign MAS turn — no auto-build/launch."""
    _ = (user_text, event_callback)
    module = "create_campaign"
    session = await get_or_create_session(session_id, token=token, module=module)
    await save_session(session, token=token)
    result["state"] = public_state(session)
    return result


def collect_ui_events(*nodes: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Gather ui_events from MAS layers (domain, executor result, tool_results)."""
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(raw: Any) -> None:
        if not isinstance(raw, dict):
            return
        ev_type = str(raw.get("type") or "").strip()
        if not ev_type:
            return
        payload = raw.get("payload")
        key = f"{ev_type}:{json.dumps(payload, sort_keys=True, default=str)}"
        if key in seen:
            return
        seen.add(key)
        collected.append(raw)

    for node in nodes:
        if not isinstance(node, dict):
            continue
        for ev in node.get("ui_events") or []:
            _add(ev)
        nested = node.get("result")
        if isinstance(nested, dict):
            for ev in nested.get("ui_events") or []:
                _add(ev)
            for row in nested.get("tool_results") or []:
                if (
                    isinstance(row, (list, tuple))
                    and len(row) >= 2
                    and isinstance(row[1], dict)
                ):
                    if row[1].get("ui_event"):
                        _add(row[1]["ui_event"])
                    for ev in row[1].get("ui_events") or []:
                        _add(ev)
        mas_out = node.get("mas_out")
        if isinstance(mas_out, dict):
            domain = mas_out.get("domain_result")
            if isinstance(domain, dict):
                for ev in domain.get("ui_events") or []:
                    _add(ev)
                inner = domain.get("result")
                if isinstance(inner, dict):
                    for ev in inner.get("ui_events") or []:
                        _add(ev)
    return collected


def _normalize_mas_chat_result(
    out: dict[str, Any],
    *,
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.mas.runtime.transcript import extract_turn_reply

    domain_result = (
        out.get("domain_result") if isinstance(out.get("domain_result"), dict) else out
    )
    reply = extract_turn_reply(out if isinstance(out, dict) else {})
    ui_events = collect_ui_events(out, domain_result)
    state = domain_result.get("state") or out.get("state")
    if isinstance(session, dict) and session.get("session_id"):
        state = public_state(session)
    from app.agents.reports.visual_policy import analytics_for_chat_payload

    chat_analytics = analytics_for_chat_payload(
        domain_result.get("analytics")
        if isinstance(domain_result.get("analytics"), dict)
        else None
    )
    if not chat_analytics and isinstance(out.get("analytics"), dict):
        chat_analytics = analytics_for_chat_payload(out.get("analytics"))

    return {
        "reply": reply,
        "state": state,
        "ui_events": ui_events,
        "mas": True,
        "mas_out": out,
        **({"analytics": chat_analytics} if chat_analytics else {}),
        **(
            {"suggestions": domain_result["suggestions"]}
            if isinstance(domain_result.get("suggestions"), list)
            and domain_result.get("suggestions")
            else {}
        ),
    }


async def _run_module_mas_chat(
    *,
    module: str,
    session_id: str,
    token: str,
    user_text: str,
    task_spec: dict[str, Any] | None = None,
    event_callback: ProgressCallback | None,
) -> dict[str, Any]:
    """SPA module entry — Super on first turn; Domain LLM routes every follow-up."""
    domain_id = MODULE_TO_DOMAIN.get(module)
    if domain_id:
        session = await get_or_create_session(session_id, token=token, module=module)
        task = get_mas_task(session)
        if task.get("active_domain") == domain_id:
            spec = dict(task_spec or {})
            spec.setdefault("query", user_text)
            if module and "module" not in spec:
                spec["module"] = module
            return await _run_domain_chat(
                module=module,
                domain_id=domain_id,
                session_id=session_id,
                token=token,
                user_text=user_text,
                task_spec=spec,
                event_callback=event_callback,
            )
    return await _run_super_chat(
        module=module,
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec=task_spec,
        event_callback=event_callback,
    )


async def _run_super_chat(
    *,
    module: str,
    session_id: str,
    token: str,
    user_text: str,
    task_spec: dict[str, Any] | None = None,
    event_callback: ProgressCallback | None,
) -> dict[str, Any]:
    """Interactive module entry — always Super → Domain → Executor (no skip_super)."""
    session = await get_or_create_session(session_id, token=token, module=module)
    spec = dict(task_spec or {})
    spec.setdefault("query", user_text)
    if module and "module" not in spec:
        spec["module"] = module
    out = await mas_invoke(
        {
            "entry": "interactive",
            "skip_super": False,
            "query": user_text,
            "session": session,
            "session_id": session_id,
            "token": token,
            "task_spec": spec,
            "module_hint": module,
            "event_callback": event_callback,
        }
    )
    session = await get_or_create_session(session_id, token=token, module=module)
    if module == "contacts":
        from app.agents.contacts.tools.handlers import (
            _reconcile_contacts_update_session,
            _reconcile_contacts_view_session,
        )

        _reconcile_contacts_update_session(session_id, session)
        _reconcile_contacts_view_session(session_id, session)
    await save_session(session, token=token)
    return _normalize_mas_chat_result(out, session=session)


async def _run_domain_chat(
    *,
    module: str,
    domain_id: str,
    session_id: str,
    token: str,
    user_text: str,
    task_spec: dict[str, Any],
    event_callback: ProgressCallback | None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module=module)
    task = get_mas_task(session)
    sticky = task.get("active_domain") == domain_id
    entry = "sticky_domain" if sticky else "interactive"
    out = await mas_invoke(
        {
            "entry": entry,
            "skip_super": sticky,
            "domain_id": domain_id,
            "query": user_text,
            "session": session,
            "session_id": session_id,
            "token": token,
            "task_spec": task_spec,
            "module_hint": module,
            "event_callback": event_callback,
        }
    )
    session = await get_or_create_session(session_id, token=token, module=module)
    if module == "contacts":
        from app.agents.contacts.tools.handlers import (
            _reconcile_contacts_update_session,
            _reconcile_contacts_view_session,
        )

        _reconcile_contacts_update_session(session_id, session)
        _reconcile_contacts_view_session(session_id, session)
    await save_session(session, token=token)
    return _normalize_mas_chat_result(out, session=session)


async def run_contacts_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.mas.runtime.turn_audit_log import run_with_turn_audit

    # Contacts module is always full MAS — no legacy coordinator bypass.
    return await run_with_turn_audit(
        module="contacts",
        session_id=session_id,
        user_text=user_text,
        chat_context="create",
        runner=lambda: _run_module_mas_chat(
            module="contacts",
            session_id=session_id,
            token=token,
            user_text=user_text,
            task_spec={"query": user_text, "module": "contacts"},
            event_callback=event_callback,
        ),
    )


async def run_monitoring_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.agents.monitoring.agent import run_monitoring_turn

    if not is_module_mas_enabled("monitoring"):
        return await run_monitoring_turn(
            session_id, token, user_text, event_callback=event_callback
        )
    return await _run_module_mas_chat(
        module="monitoring",
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec={"query": user_text, "module": "monitoring"},
        event_callback=event_callback,
    )


async def run_reports_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.agents.reports.agent import run_reports_turn
    from app.mas.runtime.turn_audit_log import run_with_turn_audit

    async def _runner() -> dict[str, Any]:
        if not is_module_mas_enabled("reports"):
            return await run_reports_turn(
                session_id, token, user_text, event_callback=event_callback
            )
        return await _run_module_mas_chat(
            module="reports",
            session_id=session_id,
            token=token,
            user_text=user_text,
            task_spec={"query": user_text, "module": "reports", "surface": "reports"},
            event_callback=event_callback,
        )

    return await run_with_turn_audit(
        module="reports",
        session_id=session_id,
        user_text=user_text,
        chat_context="create",
        runner=_runner,
    )


async def run_events_report_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.agents.events_report.agent import run_events_report_turn

    if not is_module_mas_enabled("events_report"):
        return await run_events_report_turn(
            session_id, token, user_text, event_callback=event_callback
        )
    return await _run_module_mas_chat(
        module="events_report",
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec={
            "query": user_text,
            "module": "events_report",
            "surface": "events_report",
        },
        event_callback=event_callback,
    )


async def run_create_campaign_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
    persist_chat: bool = True,
) -> dict[str, Any]:
    from app.agents.create_campaign.agent import run_create_campaign_turn
    from app.mas.runtime.turn_audit_log import run_with_turn_audit
    from app.session_store import get_or_create_session, is_hub_session_id

    async def _runner() -> dict[str, Any]:
        session = await get_or_create_session(
            session_id, token=token, module="create_campaign"
        )
        if session.get("hub_mode") or is_hub_session_id(session_id):
            return await run_create_campaign_turn(
                session_id,
                token,
                user_text,
                event_callback=event_callback,
                persist_chat=persist_chat,
            )

        if not is_module_mas_enabled("create_campaign"):
            return await run_create_campaign_turn(
                session_id,
                token,
                user_text,
                event_callback=event_callback,
                persist_chat=persist_chat,
            )
        result = await _run_module_mas_chat(
            module="create_campaign",
            session_id=session_id,
            token=token,
            user_text=user_text,
            task_spec={
                "query": user_text,
                "module": "create_campaign",
                "persist_chat": persist_chat,
            },
            event_callback=event_callback,
        )
        return await _apply_create_campaign_post_turn(
            session_id=session_id,
            token=token,
            user_text=user_text,
            event_callback=event_callback,
            result=result,
        )

    return await run_with_turn_audit(
        module="create_campaign",
        session_id=session_id,
        user_text=user_text,
        chat_context="create",
        runner=_runner,
    )


async def run_recommendation_run_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
    persist_chat: bool = True,
) -> dict[str, Any]:
    from app.agents.create_campaign.agent import run_create_campaign_turn

    if not is_module_mas_enabled("recommendation_run"):
        return await run_create_campaign_turn(
            session_id,
            token,
            user_text,
            event_callback=event_callback,
            persist_chat=persist_chat,
        )
    result = await _run_module_mas_chat(
        module="recommendation_run",
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec={
            "query": user_text,
            "module": "recommendation_run",
            "persist_chat": persist_chat,
        },
        event_callback=event_callback,
    )
    return await _apply_create_campaign_post_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
        result=result,
    )


async def run_library_run_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
    persist_chat: bool = True,
) -> dict[str, Any]:
    from app.agents.create_campaign.agent import run_create_campaign_turn

    if not is_module_mas_enabled("library_run"):
        return await run_create_campaign_turn(
            session_id,
            token,
            user_text,
            event_callback=event_callback,
            persist_chat=persist_chat,
        )
    result = await _run_module_mas_chat(
        module="library_run",
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec={
            "query": user_text,
            "module": "library_run",
            "persist_chat": persist_chat,
        },
        event_callback=event_callback,
    )
    return await _apply_create_campaign_post_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
        result=result,
    )


async def run_recommendations_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.agents.recommendations.agent import run_recommendations_turn

    if not is_module_mas_enabled("recommendations"):
        return await run_recommendations_turn(
            session_id, token, user_text, event_callback=event_callback
        )
    return await _run_module_mas_chat(
        module="recommendations",
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec={"query": user_text, "module": "recommendations"},
        event_callback=event_callback,
    )


async def run_forms_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.agents.forms.agent import run_forms_turn

    if not is_module_mas_enabled("forms"):
        return await run_forms_turn(
            session_id, token, user_text, event_callback=event_callback
        )
    return await _run_module_mas_chat(
        module="forms",
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec={"query": user_text, "module": "forms"},
        event_callback=event_callback,
    )


async def run_whatsapp_approved_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
    persist_chat: bool = True,
) -> dict[str, Any]:
    from app.agents.whatsapp_approved.agent import run_whatsapp_approved_turn

    if not is_module_mas_enabled("whatsapp_approved"):
        return await run_whatsapp_approved_turn(
            session_id, token, user_text, event_callback=event_callback
        )
    result = await _run_module_mas_chat(
        module="whatsapp_approved",
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec={
            "query": user_text,
            "module": "whatsapp_approved",
            "persist_chat": persist_chat,
        },
        event_callback=event_callback,
    )
    return await _apply_whatsapp_approved_post_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
        result=result,
    )


async def run_whatsapp_rejected_turn_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.agents.whatsapp_rejected.agent import run_whatsapp_rejected_turn

    if not is_module_mas_enabled("whatsapp_rejected"):
        return await run_whatsapp_rejected_turn(
            session_id, token, user_text, event_callback=event_callback
        )
    return await _run_module_mas_chat(
        module="whatsapp_rejected",
        session_id=session_id,
        token=token,
        user_text=user_text,
        task_spec={"query": user_text, "module": "whatsapp_rejected"},
        event_callback=event_callback,
    )

async def run_super_entry_via_mas_or_legacy(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """
    Unified Super entry (module=mas): LLM route_to_domain when any domain is enabled.
    """
    from app.mas.runtime.flags import parse_enabled_domains

    if not parse_enabled_domains():
        return {
            "reply": (
                "Campaign MAS is not enabled yet. Set MAS_ENABLED_DOMAINS "
                "(e.g. audience,creation,content,optimization,forms) and restart agents."
            ),
            "state": None,
            "ui_events": [],
            "mas": False,
        }
    session = await get_or_create_session(session_id, token=token, module="mas")
    out = await mas_invoke(
        {
            "entry": "interactive",
            "skip_super": False,
            "query": user_text,
            "session": session,
            "session_id": session_id,
            "token": token,
            "task_spec": {"query": user_text, "force_llm_route": True},
            "event_callback": event_callback,
        }
    )
    return _normalize_mas_chat_result(out)


def module_uses_mas(module: str | None) -> bool:
    mod = str(module or "").strip().lower()
    if mod == "mas":
        from app.mas.runtime.flags import parse_enabled_domains

        return bool(parse_enabled_domains())
    return is_module_mas_enabled(module) and MODULE_TO_DOMAIN.get(mod) is not None

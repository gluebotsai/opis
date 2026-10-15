"""Campaign Super Agent — LLM route_to_domain for interactive entry."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.catalog import DOMAIN_IDS, MODULE_TO_DOMAIN, normalize_domain
from app.mas.runtime.bindings import resolve_hub_binding
from app.mas.runtime.handoffs import route_to_domain_result
from app.mas.runtime.llm_loop import run_single_tool_routing_loop, system_from_package
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import get_mas_task, set_active_domain
from app.mas.runtime.tools_schemas import SUPER_TOOLS

_PACKAGE = Path(__file__).resolve().parent


def _user_facing_domain_text(domain_result: dict[str, Any] | None) -> str:
    """Chat text from the domain — never the Super routing stub."""
    result = domain_result if isinstance(domain_result, dict) else {}
    for key in ("message", "reply"):
        text = str(result.get(key) or "").strip()
        if text and not text.lower().startswith("routed to domain"):
            return text
    return ""


def _module_scoped_fallback(module_hint: str, query: str) -> dict[str, Any] | None:
    """When Super LLM fails, default to the module's domain — no hub menu."""
    mod = module_hint.strip().lower()
    expected = MODULE_TO_DOMAIN.get(mod)
    if not expected:
        return None
    verbatim = (query or "").strip()
    return {
        "ok": True,
        "domain_id": expected,
        "restated_query": verbatim or query,
        "change_summary": "module_scoped_fallback",
    }


def _needs_domain_choice_response(
    *,
    meta: dict[str, Any],
    query: str,
    llm_choice: dict[str, Any],
) -> dict[str, Any]:
    return {
        "ok": True,
        "status": "needs_domain_choice",
        "action_status": "needs_input",
        "agent": "super",
        "agent_md_loaded": not meta.get("missing"),
        "message": (
            "I can help with Audience, Campaign Creation, Content, "
            "Campaign Optimization, or Forms. Which area should we use?"
        ),
        "domains": list(DOMAIN_IDS),
        "query": query,
        "llm": llm_choice,
    }


def _hub_skill(raw: dict[str, Any] | None, task_spec: dict[str, Any]) -> str:
    return str(
        (raw or {}).get("hub_skill")
        or (raw or {}).get("intent")
        or task_spec.get("hub_skill")
        or task_spec.get("intent")
        or ""
    ).strip()


def _apply_scoped_domain_correction(
    *,
    domain_id: str | None,
    module_hint: str,
    task_spec: dict[str, Any],
    raw: dict[str, Any] | None,
    route_meta: dict[str, Any],
) -> str | None:
    """Module/hub scope corrections — not chat regex."""
    mod = module_hint.strip().lower()
    expected = MODULE_TO_DOMAIN.get(mod)
    if expected and domain_id and domain_id != expected:
        route_meta["super_correction"] = domain_id
        domain_id = expected
        route_meta["source"] = f"module_scoped_{expected}"

    hub = _hub_skill(raw, task_spec)
    if hub and (task_spec.get("hub_entry") or task_spec.get("force_super")):
        bound = resolve_hub_binding(hub)
        if bound:
            bound_domain = normalize_domain(bound["domain_id"])
            if bound_domain and domain_id != bound_domain:
                route_meta["hub_binding_correction"] = domain_id
                domain_id = bound_domain
                route_meta["source"] = "hub_binding"
            task_spec.setdefault("preferred_executor", bound.get("executor_id"))
            task_spec.setdefault("preferred_domain", bound_domain)
            route_meta["hub_skill"] = hub

    return domain_id


async def _llm_choose_domain(
    *,
    query: str,
    sticky: str | None,
    session: dict[str, Any],
    module_hint: str = "",
    hub_skill: str = "",
) -> dict[str, Any]:
    from app.mas.runtime.context import build_mas_runtime_context, recent_routing_history

    runtime = build_mas_runtime_context(session, module_hint=module_hint)
    runtime += (
        f"\nSticky active_domain (hint only): {sticky or 'none'}.\n"
        f"Allowed domains: {', '.join(DOMAIN_IDS)}.\n"
        "If the user continues the same topic as sticky, keep that domain. "
        "If they clearly switch topics, choose the new domain."
    )
    if hub_skill:
        bound = resolve_hub_binding(hub_skill)
        hint = (
            f"\nHub request hub_skill={hub_skill!r}. "
            "Choose the domain that owns this hub task."
        )
        if bound:
            hint += (
                f" Catalog binding suggests domain_id={bound['domain_id']!r} "
                f"and executor_id={bound['executor_id']!r}."
            )
        runtime += hint
    system = system_from_package(_PACKAGE, runtime_context=runtime)
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=SUPER_TOOLS,
        allowed_tool_names=frozenset({"route_to_domain"}),
        max_rounds=2,
        prior_turns=recent_routing_history(session) if session else None,
    )
    if not routed.get("ok"):
        return {
            "ok": False,
            "error": "Super could not choose a domain",
            "llm": routed,
        }
    args = routed.get("tool_args") or {}
    domain_id = normalize_domain(args.get("domain_id"))
    restated = str(args.get("restated_query") or query).strip()
    if not domain_id:
        return {"ok": False, "error": "Invalid domain from Super LLM", "llm": routed}
    return {
        "ok": True,
        "domain_id": domain_id,
        "restated_query": restated,
        "change_summary": str(args.get("change_summary") or ""),
        "llm": routed,
    }


async def run_super(
    *,
    session: dict[str, Any],
    query: str = "",
    task_spec: dict[str, Any] | None = None,
    preferred_domain: str | None = None,
    raw: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    task = get_mas_task(session)
    sticky = normalize_domain(task.get("active_domain"))
    task_spec = dict(task_spec or {})
    module_hint = str(
        (raw or {}).get("module_hint") or task_spec.get("module") or session.get("module") or ""
    )
    hub = _hub_skill(raw, task_spec)

    domain_id: str | None = normalize_domain(preferred_domain or task_spec.get("preferred_domain"))
    restated_query = query
    route_meta: dict[str, Any] = {"source": "super"}

    # Hub with catalog binding: use binding domain directly (Super orchestrates, no LLM drift).
    if hub and task_spec.get("hub_entry"):
        bound = resolve_hub_binding(hub)
        if bound:
            domain_id = normalize_domain(bound["domain_id"])
            restated_query = query or str(task_spec.get("query") or "")
            task_spec.setdefault("preferred_executor", bound.get("executor_id"))
            route_meta["source"] = "hub_binding"
            route_meta["hub_skill"] = hub
        else:
            llm_choice = await _llm_choose_domain(
                query=query or str(task_spec.get("query") or ""),
                sticky=sticky,
                session=session,
                module_hint=module_hint,
                hub_skill=hub,
            )
            if not llm_choice.get("ok"):
                fallback = _module_scoped_fallback(
                    module_hint,
                    query or str(task_spec.get("query") or ""),
                )
                if fallback:
                    domain_id = fallback["domain_id"]
                    restated_query = fallback["restated_query"]
                    route_meta["source"] = "module_scoped_fallback"
                    route_meta["llm"] = llm_choice
                else:
                    return _needs_domain_choice_response(
                        meta=meta,
                        query=query,
                        llm_choice=llm_choice,
                    )
            else:
                domain_id = llm_choice["domain_id"]
                restated_query = llm_choice.get("restated_query") or query
                route_meta["source"] = "llm_route_to_domain"
                route_meta["llm"] = llm_choice.get("llm")
    else:
        llm_choice = await _llm_choose_domain(
            query=query or str(task_spec.get("query") or ""),
            sticky=sticky,
            session=session,
            module_hint=module_hint,
            hub_skill=hub,
        )
        if llm_choice.get("ok"):
            domain_id = llm_choice["domain_id"]
            restated_query = llm_choice.get("restated_query") or query
            route_meta["source"] = "llm_route_to_domain"
            route_meta["change_summary"] = llm_choice.get("change_summary")
            route_meta["llm"] = llm_choice.get("llm")
        else:
            fallback = _module_scoped_fallback(
                module_hint,
                query or str(task_spec.get("query") or ""),
            )
            if fallback:
                domain_id = fallback["domain_id"]
                restated_query = fallback["restated_query"]
                route_meta["source"] = "module_scoped_fallback"
                route_meta["llm"] = llm_choice
            else:
                return _needs_domain_choice_response(
                    meta=meta,
                    query=query,
                    llm_choice=llm_choice,
                )

    domain_id = _apply_scoped_domain_correction(
        domain_id=domain_id,
        module_hint=module_hint,
        task_spec=task_spec,
        raw=raw,
        route_meta=route_meta,
    )

    routed = route_to_domain_result(
        domain_id=domain_id or "",
        restated_query=restated_query,
        context_refs=route_meta,
    )
    if not routed.get("ok"):
        return routed

    set_active_domain(session, routed["domain_id"])
    verbatim = str(
        (raw or {}).get("verbatim_user_text")
        or task_spec.get("query")
        or query
        or ""
    ).strip()
    if restated_query:
        task_spec["routing_hint"] = restated_query
    task_spec["query"] = verbatim

    entry = "hub" if task_spec.get("hub_entry") else "interactive"

    from app.mas.domains.registry import get_domain_runner

    runner = get_domain_runner(routed["domain_id"])
    domain_result = await runner(
        {
            "session": session,
            "domain_id": routed["domain_id"],
            "task_spec": task_spec,
            "entry": entry,
            "query": verbatim,
            "verbatim_user_text": verbatim,
            "mas_transcript_managed": bool((raw or {}).get("mas_transcript_managed")),
            "token": (raw or {}).get("token") or "",
            "session_id": (raw or {}).get("session_id") or "",
            "organization_id": (raw or {}).get("organization_id") or "",
            "event_callback": (raw or {}).get("event_callback"),
            "module_hint": (raw or {}).get("module_hint") or "",
            "hub_skill": hub,
            "routed_from_super": True,
        }
    )
    from app.mas.runtime.handoffs import follow_needs_domain_hops

    domain_result = await follow_needs_domain_hops(
        initial=domain_result,
        session=session,
        raw=dict(raw or {}),
        max_hops=2,
    )
    user_text = _user_facing_domain_text(domain_result)
    return {
        "ok": bool(domain_result.get("ok", True)),
        "status": "completed",
        "agent": "super",
        "domain_id": domain_result.get("domain_id") or routed["domain_id"],
        "route": routed,
        "route_meta": route_meta,
        "domain_result": domain_result,
        "message": user_text,
        "reply": user_text,
        "action_status": domain_result.get("action_status") or "completed",
        "ui_events": domain_result.get("ui_events") or [],
        "state": domain_result.get("state"),
        "handoff_hops": domain_result.get("handoff_hops") or [],
    }

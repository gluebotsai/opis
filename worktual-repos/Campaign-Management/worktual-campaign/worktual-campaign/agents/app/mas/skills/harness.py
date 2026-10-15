"""Skill harness — load skill, restrict tools, run executor, update skill state."""

from __future__ import annotations

from typing import Any

from app.mas.skills.registry import get_skill_registry
from app.mas.skills.state import (
    CONTACTS_MODULE,
    CREATE_CAMPAIGN_MODULE,
    LIBRARY_RUN_MODULE,
    MONITORING_MODULE,
    REPORTS_MODULE,
    WHATSAPP_APPROVED_MODULE,
    SkillStateStore,
    apply_skill_pick,
    get_active_skill_id,
)
from app.mas.skills.types import SkillSpec

_COMPLETION_TOOLS: dict[str, frozenset[str]] = {
    "contact_creation": frozenset(
        {"CREATE_SINGLE_CONTACT", "CREATE_BULK_CONTACT", "CREATE_CONTACT"}
    ),
    "contact_update": frozenset(
        {"UPDATE_SINGLE_CONTACT", "UPDATE_BULK_CONTACT", "UPDATE_CONTACT"}
    ),
    "contact_view": frozenset({"VIEW_CONTACT", "QUERY_CONTACTS"}),
    "monitor_list": frozenset({"LIST_MONITOR_CAMPAIGNS"}),
    "monitor_report": frozenset({"GET_CAMPAIGN_REPORT", "GET_CAMPAIGN_AUDIENCE"}),
    "monitor_recovery": frozenset({"STOP_CAMPAIGN", "STOP_CHANNEL", "RESUME_CHANNEL"}),
    "monitor_ab": frozenset({"PICK_AB_WINNER"}),
    "report_kpis": frozenset(
        {
            "GET_PORTFOLIO_PERFORMANCE",
            "query_analytics",
            "ask_semantic_layer",
            "GET_ACTIVITY_SERIES",
        }
    ),
    "report_ontology": frozenset({"ask_ontology"}),
    "report_campaigns": frozenset(
        {"LIST_MONITOR_CAMPAIGNS", "GET_CAMPAIGN_REPORT", "GET_CAMPAIGN_AUDIENCE"}
    ),
    "events_report": frozenset({"LIST_EVENTS", "GET_EVENT_DETAIL"}),
    "dashboard-live-ops": frozenset(
        {"GET_CAMPAIGN_LIVE_STATUS", "GET_RECENT_SEND_FAILURES", "GET_OPS_FEED"}
    ),
    "campaign_brief": frozenset(),
    "campaign_audience": frozenset({"create_contact", "upload_temporary_contacts"}),
    "campaign_templates": frozenset({"build_campaign"}),
    "campaign_launch": frozenset({"launch_campaign"}),
    "library_brief": frozenset(),
    "library_audience": frozenset({"create_contact", "upload_temporary_contacts"}),
    "library_templates": frozenset({"build_campaign"}),
    "library_launch": frozenset({"launch_campaign"}),
    "approved_run_brief": frozenset(),
    "approved_audience": frozenset(
        {"SET_AUDIENCE", "FILTER_CONTACTS", "UPLOAD_TEMPORARY_CONTACTS"}
    ),
    "approved_launch": frozenset(
        {"SEND_APPROVED_TEMPLATE", "LAUNCH_APPROVED_CAMPAIGN"}
    ),
}

_MONITORING_SKILL_IDS = frozenset(
    {"monitor_list", "monitor_report", "monitor_recovery", "monitor_ab"}
)
_REPORTS_SKILL_IDS = frozenset(
    {
        "report_kpis",
        "report_ontology",
        "report_campaigns",
        "events_report",
        "dashboard-live-ops",
    }
)
_CREATE_CAMPAIGN_SKILL_IDS = frozenset(
    {
        "campaign_brief",
        "campaign_audience",
        "campaign_templates",
        "campaign_launch",
    }
)
_LIBRARY_RUN_SKILL_IDS = frozenset(
    {
        "library_brief",
        "library_audience",
        "library_templates",
        "library_launch",
    }
)


def _recovery_tool_complete(name: str, tr: dict[str, Any]) -> bool:
    """STOP_CAMPAIGN first probe (needs_reason) is not completion."""
    if name in ("STOP_CHANNEL", "RESUME_CHANNEL"):
        return True
    if name != "STOP_CAMPAIGN":
        return False
    if tr.get("needs_reason"):
        return False
    if tr.get("already_finished") or tr.get("stopped"):
        return True
    # Inspect-only or ambiguous — keep skill active for reason / retry
    return bool(tr.get("stopped"))


def evaluate_skill_outcome(
    skill_id: str,
    *,
    tool_results: list[tuple[str, dict[str, Any]]],
    user_text: str = "",
    ui_events: list | None = None,
) -> dict[str, Any]:
    """Derive completion / needs_input from tool results — not scripted field order."""
    sid = str(skill_id or "").strip().lower()
    complete_tools = _COMPLETION_TOOLS.get(sid, frozenset())
    last_tools = [name for name, _ in tool_results]
    complete = False
    for name, tr in tool_results:
        if name not in complete_tools or not isinstance(tr, dict) or not tr.get("ok"):
            continue
        if sid == "monitor_recovery":
            if _recovery_tool_complete(name, tr):
                complete = True
                break
            continue
        complete = True
        break

    draft_updated = any(
        isinstance(e, dict) and e.get("type") == "draft_updated"
        for e in (ui_events or [])
    )
    set_draft_ok = any(
        name == "SET_DRAFT_FIELDS" and isinstance(tr, dict) and tr.get("ok")
        for name, tr in tool_results
    )
    contact_needs = sid in ("contact_creation", "contact_update", "contact_view")
    recovery_waiting = sid == "monitor_recovery" and any(
        name == "STOP_CAMPAIGN"
        and isinstance(tr, dict)
        and tr.get("ok")
        and tr.get("needs_reason")
        for name, tr in tool_results
    )
    needs_input = False
    if not complete:
        if recovery_waiting:
            needs_input = True
        elif bool(str(user_text or "").strip()) and (
            (contact_needs and not draft_updated and not set_draft_ok)
            or (sid in _MONITORING_SKILL_IDS and not last_tools)
            or (sid in _REPORTS_SKILL_IDS and not last_tools)
            or (sid in _CREATE_CAMPAIGN_SKILL_IDS and not last_tools)
            or (sid in _LIBRARY_RUN_SKILL_IDS and not last_tools)
        ):
            needs_input = True
    return {
        "complete": complete,
        "needs_input": needs_input,
        "last_tools": last_tools,
    }


def _apply_post_turn_skill_state(
    session: dict[str, Any],
    *,
    module: str,
    executor_id: str,
    skill_id: str,
    outcome: dict[str, Any],
) -> dict[str, Any]:
    """Mark skill complete and resume paused skill when appropriate."""
    meta: dict[str, Any] = {"skill_outcome": outcome}
    if not outcome.get("complete"):
        return meta

    apply_skill_pick(
        session,
        module=module,
        executor_id=executor_id,
        skill_id=skill_id,
        skill_action="complete",
    )
    meta["completed_skill"] = skill_id
    store = SkillStateStore()
    resumed = store.resume_top_paused(session, module)
    if resumed:
        meta["resumed_skill"] = resumed
        registry = get_skill_registry()
        resumed_spec = registry.get(module, resumed)
        resume_eid = (
            resumed_spec.executor_id if resumed_spec else executor_id
        )
        apply_skill_pick(
            session,
            module=module,
            executor_id=resume_eid,
            skill_id=resumed,
            skill_action="continue",
        )
    return meta


async def run_contact_skill(
    *,
    session: dict[str, Any],
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """
    Harness path for contact executor with an active skill.
    run_executor: audience runner's _run_executor callable.
    """
    skill_id = str(
        task_spec.get("skill_id")
        or get_active_skill_id(session, CONTACTS_MODULE)
        or ""
    ).strip().lower()
    if not skill_id:
        skill_id = "contact_creation"
        task_spec["skill_id"] = skill_id

    registry = get_skill_registry()
    spec = registry.get(CONTACTS_MODULE, skill_id)
    if not spec:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "domain",
            "domain_id": "audience",
            "error": f"Unknown skill {skill_id!r}",
            "agent_md_loaded": not meta.get("missing"),
        }

    result = await run_executor(
        session=session,
        executor_id="contact",
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

    nested = result.get("result") if isinstance(result.get("result"), dict) else {}
    tool_results = list(nested.get("tool_results") or [])
    ui_events = list(result.get("ui_events") or nested.get("ui_events") or [])
    user_text = str(task_spec.get("query") or ctx.get("query") or "").strip()

    outcome = evaluate_skill_outcome(
        skill_id,
        tool_results=tool_results,
        user_text=user_text,
        ui_events=ui_events,
    )
    state_meta = _apply_post_turn_skill_state(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id=skill_id,
        outcome=outcome,
    )
    result["skill_outcome"] = outcome
    result.update(state_meta)
    if outcome.get("needs_input") and not outcome.get("complete"):
        result["action_status"] = "needs_input"
    result.setdefault("skill_id", skill_id)
    return result


async def run_monitoring_skill(
    *,
    session: dict[str, Any],
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Harness path for monitoring/recovery executors with an active skill."""
    skill_id = str(
        task_spec.get("skill_id")
        or get_active_skill_id(session, MONITORING_MODULE)
        or ""
    ).strip().lower()
    if not skill_id:
        skill_id = "monitor_list"
        task_spec["skill_id"] = skill_id

    registry = get_skill_registry()
    spec = registry.get(MONITORING_MODULE, skill_id)
    if not spec:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "domain",
            "domain_id": "optimization",
            "error": f"Unknown skill {skill_id!r}",
            "agent_md_loaded": not meta.get("missing"),
        }

    executor_id = str(
        task_spec.get("executor_id") or spec.executor_id or "monitoring"
    ).strip().lower()
    if executor_id != spec.executor_id:
        executor_id = spec.executor_id
    task_spec["executor_id"] = executor_id
    task_spec["skill_id"] = skill_id

    result = await run_executor(
        session=session,
        executor_id=executor_id,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

    nested = result.get("result") if isinstance(result.get("result"), dict) else {}
    tool_results = list(nested.get("tool_results") or [])
    ui_events = list(result.get("ui_events") or nested.get("ui_events") or [])
    user_text = str(task_spec.get("query") or ctx.get("query") or "").strip()

    outcome = evaluate_skill_outcome(
        skill_id,
        tool_results=tool_results,
        user_text=user_text,
        ui_events=ui_events,
    )
    state_meta = _apply_post_turn_skill_state(
        session,
        module=MONITORING_MODULE,
        executor_id=executor_id,
        skill_id=skill_id,
        outcome=outcome,
    )
    result["skill_outcome"] = outcome
    result.update(state_meta)
    if outcome.get("needs_input") and not outcome.get("complete"):
        result["action_status"] = "needs_input"
    result.setdefault("skill_id", skill_id)
    return result


async def run_reports_skill(
    *,
    session: dict[str, Any],
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Harness path for analytics executor with an active reports skill."""
    skill_id = str(
        task_spec.get("skill_id")
        or get_active_skill_id(session, REPORTS_MODULE)
        or ""
    ).strip().lower()
    if not skill_id:
        skill_id = "report_kpis"
        task_spec["skill_id"] = skill_id

    registry = get_skill_registry()
    spec = registry.get(REPORTS_MODULE, skill_id)
    if not spec:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "domain",
            "domain_id": "optimization",
            "error": f"Unknown skill {skill_id!r}",
            "agent_md_loaded": not meta.get("missing"),
        }

    task_spec["executor_id"] = "analytics"
    task_spec["skill_id"] = skill_id
    if skill_id == "events_report":
        task_spec["surface"] = "events_report"
    elif not str(task_spec.get("surface") or "").strip():
        task_spec["surface"] = "reports"

    result = await run_executor(
        session=session,
        executor_id="analytics",
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

    nested = result.get("result") if isinstance(result.get("result"), dict) else {}
    tool_results = list(nested.get("tool_results") or [])
    ui_events = list(result.get("ui_events") or nested.get("ui_events") or [])
    user_text = str(task_spec.get("query") or ctx.get("query") or "").strip()

    outcome = evaluate_skill_outcome(
        skill_id,
        tool_results=tool_results,
        user_text=user_text,
        ui_events=ui_events,
    )
    state_meta = _apply_post_turn_skill_state(
        session,
        module=REPORTS_MODULE,
        executor_id="analytics",
        skill_id=skill_id,
        outcome=outcome,
    )
    result["skill_outcome"] = outcome
    result.update(state_meta)
    if outcome.get("needs_input") and not outcome.get("complete"):
        result["action_status"] = "needs_input"
    result.setdefault("skill_id", skill_id)
    return result


async def run_create_campaign_skill(
    *,
    session: dict[str, Any],
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Harness path for create-campaign executors with an active skill."""
    from app.mas.skills.create_campaign import default_skill_for_executor

    skill_id = str(
        task_spec.get("skill_id")
        or get_active_skill_id(session, CREATE_CAMPAIGN_MODULE)
        or ""
    ).strip().lower()
    executor_hint = str(
        task_spec.get("executor_id") or ctx.get("executor_id") or "brief_validation"
    ).strip().lower()
    if not skill_id:
        skill_id = default_skill_for_executor(executor_hint) or "campaign_brief"
        task_spec["skill_id"] = skill_id

    registry = get_skill_registry()
    spec = registry.get(CREATE_CAMPAIGN_MODULE, skill_id)
    if not spec:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "domain",
            "domain_id": "creation",
            "error": f"Unknown skill {skill_id!r}",
            "agent_md_loaded": not meta.get("missing"),
        }

    executor_id = str(
        task_spec.get("executor_id") or spec.executor_id or "brief_validation"
    ).strip().lower()
    if executor_id != spec.executor_id:
        executor_id = spec.executor_id
    task_spec["executor_id"] = executor_id
    task_spec["skill_id"] = skill_id

    result = await run_executor(
        session=session,
        executor_id=executor_id,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

    nested = result.get("result") if isinstance(result.get("result"), dict) else {}
    tool_results = list(nested.get("tool_results") or [])
    ui_events = list(result.get("ui_events") or nested.get("ui_events") or [])
    user_text = str(task_spec.get("query") or ctx.get("query") or "").strip()

    outcome = evaluate_skill_outcome(
        skill_id,
        tool_results=tool_results,
        user_text=user_text,
        ui_events=ui_events,
    )
    state_meta = _apply_post_turn_skill_state(
        session,
        module=CREATE_CAMPAIGN_MODULE,
        executor_id=executor_id,
        skill_id=skill_id,
        outcome=outcome,
    )
    result["skill_outcome"] = outcome
    result.update(state_meta)
    if outcome.get("needs_input") and not outcome.get("complete"):
        result["action_status"] = "needs_input"
    result.setdefault("skill_id", skill_id)
    return result


async def run_library_run_skill(
    *,
    session: dict[str, Any],
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Harness path for library_run executors with an active library_* skill."""
    from app.mas.skills.library_run import default_library_skill_for_executor

    skill_id = str(
        task_spec.get("skill_id")
        or get_active_skill_id(session, LIBRARY_RUN_MODULE)
        or ""
    ).strip().lower()
    executor_hint = str(
        task_spec.get("executor_id") or ctx.get("executor_id") or "brief_validation"
    ).strip().lower()
    if not skill_id:
        skill_id = default_library_skill_for_executor(executor_hint) or "library_brief"
        task_spec["skill_id"] = skill_id

    registry = get_skill_registry()
    spec = registry.get(LIBRARY_RUN_MODULE, skill_id)
    if not spec:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "domain",
            "domain_id": "library_run",
            "error": f"Unknown skill {skill_id!r}",
            "agent_md_loaded": not meta.get("missing"),
        }

    executor_id = str(
        task_spec.get("executor_id") or spec.executor_id or "brief_validation"
    ).strip().lower()
    if executor_id != spec.executor_id:
        executor_id = spec.executor_id
    task_spec["executor_id"] = executor_id
    task_spec["skill_id"] = skill_id

    result = await run_executor(
        session=session,
        executor_id=executor_id,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

    nested = result.get("result") if isinstance(result.get("result"), dict) else {}
    tool_results = list(nested.get("tool_results") or [])
    ui_events = list(result.get("ui_events") or nested.get("ui_events") or [])
    user_text = str(task_spec.get("query") or ctx.get("query") or "").strip()

    outcome = evaluate_skill_outcome(
        skill_id,
        tool_results=tool_results,
        user_text=user_text,
        ui_events=ui_events,
    )
    state_meta = _apply_post_turn_skill_state(
        session,
        module=LIBRARY_RUN_MODULE,
        executor_id=executor_id,
        skill_id=skill_id,
        outcome=outcome,
    )
    result["skill_outcome"] = outcome
    result.update(state_meta)
    if outcome.get("needs_input") and not outcome.get("complete"):
        result["action_status"] = "needs_input"
    result.setdefault("skill_id", skill_id)
    return result


async def run_audience_executor_via_harness(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Route to skill harness for contact+skill; pass-through for other executors."""
    eid = str(executor_id or "").strip().lower()
    if eid == "contact":
        return await run_contact_skill(
            session=session,
            task_spec=task_spec,
            ctx=ctx,
            run_executor=run_executor,
            meta=meta,
        )
    return await run_executor(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )


async def run_whatsapp_approved_skill(
    *,
    session: dict[str, Any],
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Harness path for whatsapp_approved_send with an active approved_* skill."""
    from app.mas.skills.whatsapp_approved import default_skill_for_executor

    skill_id = str(
        task_spec.get("skill_id")
        or get_active_skill_id(session, WHATSAPP_APPROVED_MODULE)
        or ""
    ).strip().lower()
    executor_hint = str(
        task_spec.get("executor_id") or ctx.get("executor_id") or "whatsapp_approved_send"
    ).strip().lower()
    if not skill_id:
        skill_id = default_skill_for_executor(executor_hint) or "approved_audience"
        task_spec["skill_id"] = skill_id

    registry = get_skill_registry()
    spec = registry.get(WHATSAPP_APPROVED_MODULE, skill_id)
    if not spec:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "domain",
            "domain_id": "whatsapp_approved_run",
            "error": f"Unknown skill {skill_id!r}",
            "agent_md_loaded": not meta.get("missing"),
        }

    executor_id = str(
        task_spec.get("executor_id") or spec.executor_id or "whatsapp_approved_send"
    ).strip().lower()
    if executor_id != spec.executor_id:
        executor_id = spec.executor_id
    task_spec["executor_id"] = executor_id
    task_spec["skill_id"] = skill_id

    result = await run_executor(
        session=session,
        executor_id=executor_id,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

    nested = result.get("result") if isinstance(result.get("result"), dict) else {}
    tool_results = list(nested.get("tool_results") or [])
    ui_events = list(result.get("ui_events") or nested.get("ui_events") or [])
    user_text = str(task_spec.get("query") or ctx.get("query") or "").strip()

    outcome = evaluate_skill_outcome(
        skill_id,
        tool_results=tool_results,
        user_text=user_text,
        ui_events=ui_events,
    )
    state_meta = _apply_post_turn_skill_state(
        session,
        module=WHATSAPP_APPROVED_MODULE,
        executor_id=executor_id,
        skill_id=skill_id,
        outcome=outcome,
    )
    result["skill_outcome"] = outcome
    result.update(state_meta)
    if outcome.get("needs_input") and not outcome.get("complete"):
        result["action_status"] = "needs_input"
    result.setdefault("skill_id", skill_id)
    return result


async def run_whatsapp_approved_executor_via_harness(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Skill harness for whatsapp_approved_send; pass-through for other executors."""
    eid = str(executor_id or "").strip().lower()
    if eid == "whatsapp_approved_send":
        return await run_whatsapp_approved_skill(
            session=session,
            task_spec=task_spec,
            ctx=ctx,
            run_executor=run_executor,
            meta=meta,
        )
    return await run_executor(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )


async def run_creation_executor_via_harness(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Skill harness for create-campaign stage executors; pass-through for recommendation."""
    eid = str(executor_id or "").strip().lower()
    if eid in (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
    ):
        return await run_create_campaign_skill(
            session=session,
            task_spec=task_spec,
            ctx=ctx,
            run_executor=run_executor,
            meta=meta,
        )
    return await run_executor(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )


async def run_library_run_executor_via_harness(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Skill harness for library_run stage executors."""
    eid = str(executor_id or "").strip().lower()
    if eid in (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
    ):
        return await run_library_run_skill(
            session=session,
            task_spec=task_spec,
            ctx=ctx,
            run_executor=run_executor,
            meta=meta,
        )
    return await run_executor(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )


async def run_optimization_executor_via_harness(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    run_executor: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Skill harness for monitoring/recovery/analytics; pass-through otherwise."""
    eid = str(executor_id or "").strip().lower()
    if eid in ("monitoring", "recovery"):
        return await run_monitoring_skill(
            session=session,
            task_spec=task_spec,
            ctx=ctx,
            run_executor=run_executor,
            meta=meta,
        )
    if eid == "analytics":
        return await run_reports_skill(
            session=session,
            task_spec=task_spec,
            ctx=ctx,
            run_executor=run_executor,
            meta=meta,
        )
    return await run_executor(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )


def completion_tools_for_spec(spec: SkillSpec | None) -> frozenset[str]:
    if not spec:
        return frozenset()
    if spec.completion_tool_names:
        return frozenset(spec.completion_tool_names)
    return _COMPLETION_TOOLS.get(spec.skill_id, frozenset())


__all__ = [
    "evaluate_skill_outcome",
    "run_audience_executor_via_harness",
    "run_contact_skill",
    "run_create_campaign_skill",
    "run_whatsapp_approved_executor_via_harness",
    "run_whatsapp_approved_skill",
    "run_creation_executor_via_harness",
    "run_monitoring_skill",
    "run_reports_skill",
    "run_optimization_executor_via_harness",
    "completion_tools_for_spec",
]

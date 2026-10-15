"""Optimization Domain Agent — Skill Selector + Harness → Executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.catalog import executors_for_domain
from app.mas.executors.registry import get_executor_runner
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import (
    append_step,
    get_mas_task,
    set_active_domain,
    set_active_executor,
)
from app.mas.runtime.turn import apply_routing_hint, ensure_verbatim_task_spec, routing_query
from app.mas.skills import (
    MONITORING_MODULE,
    REPORTS_MODULE,
    bind_monitoring_skill_if_changed,
    bind_reports_skill_if_changed,
    get_active_skill_id,
    get_skill_registry,
    run_optimization_executor_via_harness,
    select_optimization_skill,
)
from app.mas.skills.monitoring import map_hub_skill
from app.mas.skills.reports import map_reports_surface

_PACKAGE = Path(__file__).resolve().parent


def _bind_monitoring_skill_to_task(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
    executor_id: str | None = None,
) -> None:
    bind_monitoring_skill_if_changed(
        session,
        task_spec,
        skill_id=skill_id,
        skill_action=skill_action,
        executor_id=executor_id,
    )


def _bind_reports_skill_to_task(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
) -> None:
    bind_reports_skill_if_changed(
        session,
        task_spec,
        skill_id=skill_id,
        skill_action=skill_action,
        executor_id="analytics",
    )


def _bind_active_monitoring_skill(
    session: dict[str, Any],
    task_spec: dict[str, Any],
) -> str:
    skill = get_active_skill_id(session, MONITORING_MODULE) or "monitor_list"
    _bind_monitoring_skill_to_task(
        session,
        task_spec,
        skill_id=skill,
        skill_action=str(task_spec.get("skill_action") or "continue"),
    )
    return skill


def _bind_active_reports_skill(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    hint: str = "",
) -> str:
    default = "events_report" if hint == "events_report" else "report_kpis"
    skill = get_active_skill_id(session, REPORTS_MODULE) or default
    _bind_reports_skill_to_task(
        session,
        task_spec,
        skill_id=skill,
        skill_action=str(task_spec.get("skill_action") or "continue"),
    )
    return skill


def _normalize_reports_hint(task_spec: dict[str, Any], ctx: dict[str, Any]) -> str:
    hint = str(ctx.get("module_hint") or task_spec.get("module") or "").strip().lower()
    if hint == "dashboard":
        hint = "reports"
    return hint


def _is_reports_surface(task_spec: dict[str, Any], ctx: dict[str, Any]) -> bool:
    hint = _normalize_reports_hint(task_spec, ctx)
    return hint in ("reports", "events_report")


def _pass_through_executor(
    session: dict[str, Any],
    allowed: frozenset[str],
    *,
    hint: str = "",
) -> str | None:
    """Session-state safety when Domain LLM fails — not chat intent parsing."""
    task = get_mas_task(session)
    sticky = str(task.get("active_executor") or "").strip().lower()
    if sticky in allowed:
        return sticky
    if hint in ("reports", "events_report") and "analytics" in allowed:
        return "analytics"
    active_skill = get_active_skill_id(session, MONITORING_MODULE)
    if active_skill:
        spec = get_skill_registry().get(MONITORING_MODULE, active_skill)
        if spec and spec.executor_id in allowed:
            return spec.executor_id
        if "monitoring" in allowed:
            return "monitoring"
    reports_skill = get_active_skill_id(session, REPORTS_MODULE)
    if reports_skill and "analytics" in allowed:
        return "analytics"
    return None


def _resolve_hub_binding(
    task_spec: dict[str, Any], ctx: dict[str, Any]
) -> tuple[str, str] | None:
    """Deterministic Hub/cron bindings only (not chat intent)."""
    intent = (
        str(task_spec.get("intent") or task_spec.get("action") or "")
        .strip()
        .lower()
        .replace("-", "_")
    )
    mapped = map_hub_skill(intent)
    if mapped:
        return mapped
    if task_spec.get("hub_monitoring") or task_spec.get("hub_entry"):
        hub_skill = str(
            task_spec.get("hub_skill") or ctx.get("hub_skill") or intent or ""
        ).replace("-", "_")
        mapped = map_hub_skill(hub_skill)
        if mapped:
            return mapped
        if any(x in hub_skill for x in ("stop_channel", "resume_channel", "stop_campaign")):
            return ("recovery", "monitor_recovery")
        if hub_skill in (
            "campaign_report",
            "monitoring_report",
            "analyze_campaign",
            "monitoring",
        ):
            return ("monitoring", "monitor_report")
    return None


async def _run_executor(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    meta: dict[str, Any],
) -> dict[str, Any]:
    set_active_executor(session, executor_id)
    result = await get_executor_runner(executor_id)(
        {
            "session": session,
            "executor_id": executor_id,
            "domain_id": "optimization",
            "task_spec": task_spec,
            "entry": ctx.get("entry") or "interactive",
            "token": ctx.get("token") or "",
            "session_id": ctx.get("session_id") or "",
            "organization_id": ctx.get("organization_id") or "",
            "event_callback": ctx.get("event_callback"),
            "intent": ctx.get("intent") or task_spec.get("intent"),
            "query": task_spec.get("query") or ctx.get("query") or "",
            "verbatim_user_text": ctx.get("verbatim_user_text") or task_spec.get("query") or "",
            "mas_transcript_managed": bool(ctx.get("mas_transcript_managed")),
            "module_hint": ctx.get("module_hint") or task_spec.get("module") or "",
            "hub_skill": ctx.get("hub_skill") or task_spec.get("hub_skill") or "",
        }
    )
    status = str(
        result.get("action_status") or ("completed" if result.get("ok") else "failed")
    )
    append_step(
        session,
        executor_id=executor_id,
        action_status=status,
        result=result if isinstance(result, dict) else {},
        message=str(result.get("message") or result.get("reply") or ""),
    )
    out = dict(result) if isinstance(result, dict) else {"ok": False}
    out.setdefault("domain_id", "optimization")
    out.setdefault("executor_id", executor_id)
    if task_spec.get("skill_id"):
        out.setdefault("skill_id", task_spec.get("skill_id"))
    out.setdefault("agent_md_loaded", not meta.get("missing"))
    if "reply" not in out and out.get("message"):
        out["reply"] = out["message"]
    return out


async def _dispatch_executor(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    meta: dict[str, Any],
) -> dict[str, Any]:
    return await run_optimization_executor_via_harness(
        session=session,
        executor_id=executor_id,
        task_spec=task_spec,
        ctx=ctx,
        run_executor=_run_executor,
        meta=meta,
    )


async def _route_via_domain_llm(
    *,
    session: dict[str, Any],
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    meta: dict[str, Any],
    verbatim: str,
    allowed: frozenset[str],
    hint: str = "",
) -> dict[str, Any]:
    pick = await select_optimization_skill(
        package_dir=_PACKAGE,
        query=routing_query(task_spec, verbatim),
        session=session,
        module_hint=str(ctx.get("module_hint") or task_spec.get("module") or hint or ""),
        task_spec=task_spec,
    )

    reports_surface = _is_reports_surface(task_spec, ctx)
    if pick.ok and pick.direct_reply and not reports_surface:
        append_step(
            session,
            executor_id="",
            action_status="completed",
            result={"direct_reply": True},
            message=pick.direct_reply,
        )
        return {
            "ok": True,
            "action_status": "completed",
            "kind": "domain",
            "agent_id": "optimization",
            "domain_id": "optimization",
            "message": pick.direct_reply,
            "reply": pick.direct_reply,
            "agent_md_loaded": not meta.get("missing"),
            "llm": pick.llm,
        }
    if pick.ok and pick.direct_reply and reports_surface:
        hint = _normalize_reports_hint(task_spec, ctx)
        _bind_active_reports_skill(session, task_spec, hint=hint)
        return await _dispatch_executor(
            session=session,
            executor_id="analytics",
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    if not pick.ok:
        fallback = _pass_through_executor(session, allowed, hint=hint)
        if fallback:
            if fallback in ("monitoring", "recovery"):
                skill = get_active_skill_id(session, MONITORING_MODULE) or (
                    "monitor_recovery" if fallback == "recovery" else "monitor_list"
                )
                _bind_monitoring_skill_to_task(
                    session,
                    task_spec,
                    skill_id=skill,
                    skill_action="continue",
                    executor_id=fallback,
                )
            elif fallback == "analytics":
                _bind_active_reports_skill(session, task_spec, hint=hint)
            return await _dispatch_executor(
                session=session,
                executor_id=fallback,
                task_spec=task_spec,
                ctx=ctx,
                meta=meta,
            )
        return {
            "ok": True,
            "action_status": "needs_input",
            "kind": "domain",
            "agent_id": "optimization",
            "domain_id": "optimization",
            "message": (
                "I can help with campaign monitoring, analytics reports, "
                "or stop/resume actions. What would you like?"
            ),
            "reply": "",
            "agent_md_loaded": not meta.get("missing"),
            "llm": pick.llm,
        }

    eid = pick.executor_id
    if eid not in allowed:
        fallback = _pass_through_executor(session, allowed, hint=hint)
        if fallback:
            if fallback in ("monitoring", "recovery"):
                _bind_active_monitoring_skill(session, task_spec)
            elif fallback == "analytics":
                _bind_active_reports_skill(session, task_spec, hint=hint)
            return await _dispatch_executor(
                session=session,
                executor_id=fallback,
                task_spec=task_spec,
                ctx=ctx,
                meta=meta,
            )
        eid = "analytics" if hint in ("reports", "events_report") else "monitoring"

    if pick.restated_query:
        apply_routing_hint(task_spec, pick.restated_query, verbatim)
    if pick.user_confirmed is not None:
        task_spec["user_confirmed"] = bool(pick.user_confirmed)

    if eid in ("monitoring", "recovery"):
        if pick.skill_id:
            _bind_monitoring_skill_to_task(
                session,
                task_spec,
                skill_id=pick.skill_id,
                skill_action=pick.skill_action,
                executor_id=eid,
            )
            eid = str(task_spec.get("executor_id") or eid)
        elif not task_spec.get("skill_id"):
            _bind_active_monitoring_skill(session, task_spec)
            eid = str(task_spec.get("executor_id") or eid)
    elif eid == "analytics":
        if pick.skill_id:
            _bind_reports_skill_to_task(
                session,
                task_spec,
                skill_id=pick.skill_id,
                skill_action=pick.skill_action,
            )
        elif not task_spec.get("skill_id"):
            _bind_active_reports_skill(session, task_spec, hint=hint)

    return await _dispatch_executor(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )


async def run_optimization_domain(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    set_active_domain(session, "optimization")

    task_spec = dict(ctx.get("task_spec") or {})
    verbatim = ensure_verbatim_task_spec(ctx, task_spec)
    query = verbatim
    allowed = frozenset(executors_for_domain("optimization"))
    default_executor = "monitoring"
    hint = _normalize_reports_hint(task_spec, ctx)
    if hint == "events_report":
        task_spec["surface"] = "events_report"
    elif hint == "reports" and not str(task_spec.get("surface") or "").strip():
        task_spec["surface"] = "reports"

    preferred = str(
        task_spec.get("executor_id")
        or task_spec.get("preferred_executor")
        or ""
    ).strip().lower()
    pref_skill = str(task_spec.get("skill_id") or "").strip().lower()
    if preferred in allowed:
        if preferred in ("monitoring", "recovery"):
            if pref_skill:
                _bind_monitoring_skill_to_task(
                    session,
                    task_spec,
                    skill_id=pref_skill,
                    skill_action=str(task_spec.get("skill_action") or "continue"),
                    executor_id=preferred,
                )
            else:
                _bind_active_monitoring_skill(session, task_spec)
            preferred = str(task_spec.get("executor_id") or preferred)
        elif preferred == "analytics":
            if pref_skill:
                _bind_reports_skill_to_task(
                    session,
                    task_spec,
                    skill_id=pref_skill,
                    skill_action=str(task_spec.get("skill_action") or "continue"),
                )
            else:
                _bind_active_reports_skill(session, task_spec, hint=hint)
        return await _dispatch_executor(
            session=session,
            executor_id=preferred,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    entry = str(ctx.get("entry") or "interactive").strip().lower()
    hubish = entry in ("hub", "hub_autonomous", "cron", "event", "webhook") or bool(
        task_spec.get("hub_entry") or task_spec.get("hub_monitoring")
    )
    hub_bind = _resolve_hub_binding(task_spec, ctx)
    if hubish or hub_bind:
        if hub_bind:
            eid, sid = hub_bind
            _bind_monitoring_skill_to_task(
                session,
                task_spec,
                skill_id=sid,
                skill_action=str(task_spec.get("skill_action") or "new_task"),
                executor_id=eid,
            )
            eid = str(task_spec.get("executor_id") or eid)
        elif hint in ("reports", "events_report"):
            surface_bind = map_reports_surface(hint)
            eid, sid = surface_bind or ("analytics", "report_kpis")
            _bind_reports_skill_to_task(
                session,
                task_spec,
                skill_id=sid,
                skill_action=str(task_spec.get("skill_action") or "new_task"),
            )
            eid = "analytics"
        else:
            eid = default_executor
            if eid in ("monitoring", "recovery") and not task_spec.get("skill_id"):
                _bind_monitoring_skill_to_task(
                    session,
                    task_spec,
                    skill_id="monitor_list",
                    skill_action="new_task",
                    executor_id=eid,
                )
        return await _dispatch_executor(
            session=session,
            executor_id=eid if eid in allowed else default_executor,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    if query and bool(task_spec.get("llm_pick_executor", True)):
        return await _route_via_domain_llm(
            session=session,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
            verbatim=verbatim,
            allowed=allowed,
            hint=hint,
        )

    fallback = _pass_through_executor(session, allowed, hint=hint)
    eid = fallback or (
        "analytics" if hint in ("reports", "events_report") else default_executor
    )
    if eid in ("monitoring", "recovery"):
        _bind_active_monitoring_skill(session, task_spec)
        eid = str(task_spec.get("executor_id") or eid)
    elif eid == "analytics":
        _bind_active_reports_skill(session, task_spec, hint=hint)
    return await _dispatch_executor(
        session=session,
        executor_id=eid if eid in allowed else default_executor,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

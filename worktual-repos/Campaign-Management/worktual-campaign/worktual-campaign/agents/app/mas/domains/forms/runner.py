"""Forms Domain Agent — LLM invoke_executor for interactive chat."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.catalog import executors_for_domain
from app.mas.executors.registry import get_executor_runner
from app.mas.runtime.llm_loop import llm_pick_forms_executor
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import (
    append_step,
    set_active_domain,
    set_active_executor,
)
from app.mas.runtime.turn import apply_routing_hint, ensure_verbatim_task_spec, routing_query

_PACKAGE = Path(__file__).resolve().parent


def _resolve_forced(task_spec: dict[str, Any], ctx: dict[str, Any]) -> str | None:
    """Optional soft hints from task_spec only (not chat regex)."""
    pref = str(task_spec.get("form_focus") or "").strip().lower()
    if pref in ("theme", "form_theme"):
        return "form_theme"
    if pref in ("fields", "form_fields"):
        return "form_fields"
    if pref in ("design", "form_design", "full"):
        return "form_design"
    hint = str(ctx.get("module_hint") or task_spec.get("module") or "").strip().lower()
    if hint == "forms":
        return None
    pref_exec = str(task_spec.get("preferred_executor") or "").strip().lower()
    if pref_exec in executors_for_domain("forms"):
        return pref_exec
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
            "domain_id": "forms",
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
    out.setdefault("domain_id", "forms")
    out.setdefault("executor_id", executor_id)
    out.setdefault("agent_md_loaded", not meta.get("missing"))
    if "reply" not in out and out.get("message"):
        out["reply"] = out["message"]
    return out


async def run_forms_domain(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    set_active_domain(session, "forms")

    task_spec = dict(ctx.get("task_spec") or {})
    verbatim = ensure_verbatim_task_spec(ctx, task_spec)
    query = verbatim
    allowed = frozenset(executors_for_domain("forms"))
    default_executor = "form_theme"

    preferred = str(task_spec.get("executor_id") or "").strip().lower()
    forced = _resolve_forced(task_spec, ctx)

    if preferred in allowed:
        return await _run_executor(
            session=session,
            executor_id=preferred,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )
    if forced and forced in allowed:
        return await _run_executor(
            session=session,
            executor_id=forced,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    entry = str(ctx.get("entry") or "interactive").strip().lower()
    if entry in ("hub", "hub_autonomous", "cron", "event", "webhook") or task_spec.get(
        "hub_entry"
    ):
        eid = forced or default_executor
        return await _run_executor(
            session=session,
            executor_id=eid if eid in allowed else default_executor,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    if query and bool(task_spec.get("llm_pick_executor", True)):
        pick = await llm_pick_forms_executor(
            package_dir=_PACKAGE,
            query=routing_query(task_spec, verbatim),
            session=session,
            module_hint=str(ctx.get("module_hint") or task_spec.get("module") or ""),
            task_spec=task_spec,
        )
        if not pick.get("ok"):
            return {
                "ok": True,
                "action_status": "needs_input",
                "kind": "domain",
                "agent_id": "forms",
                "domain_id": "forms",
                "message": (
                    "I can adjust form theme, fields, or full design. What would you like?"
                ),
                "reply": "",
                "agent_md_loaded": not meta.get("missing"),
                "llm": pick.get("llm"),
            }
        eid = str(pick.get("executor_id") or default_executor).strip().lower()
        if eid not in allowed:
            eid = default_executor
        if pick.get("restated_query"):
            apply_routing_hint(task_spec, pick["restated_query"], verbatim)
        return await _run_executor(
            session=session,
            executor_id=eid,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    return await _run_executor(
        session=session,
        executor_id=default_executor,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

"""Shared domain runner helpers (no skills)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.mas.catalog import executors_for_domain
from app.mas.executors.registry import get_executor_runner
from app.mas.runtime.llm_loop import llm_pick_executor
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import (
    append_step,
    set_active_domain,
    set_active_executor,
)
from app.mas.runtime.turn import apply_routing_hint, ensure_verbatim_task_spec, routing_query

ResolvePreferred = Callable[[dict[str, Any], dict[str, Any]], str | None]


async def run_domain_with_executor_pick(
    *,
    domain_id: str,
    package_dir: Path,
    ctx: dict[str, Any],
    default_executor: str,
    resolve_preferred: ResolvePreferred | None = None,
) -> dict[str, Any]:
    """
    Common Domain flow:
    1) Prefer task_spec.executor_id
    2) Module/hub hints via resolve_preferred
    3) Else LLM pick when query present
    4) Else default_executor
    """
    meta = package_agent_md(package_dir)
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    set_active_domain(session, domain_id)

    task_spec = dict(ctx.get("task_spec") or {})
    verbatim = ensure_verbatim_task_spec(ctx, task_spec)
    query = verbatim
    allowed = frozenset(executors_for_domain(domain_id))

    preferred = str(task_spec.get("executor_id") or "").strip().lower()
    hinted: str | None = None
    pref_exec = str(task_spec.get("preferred_executor") or "").strip().lower()
    if pref_exec in allowed:
        hinted = pref_exec
    if resolve_preferred is not None and not hinted:
        raw_hint = resolve_preferred(task_spec, ctx)
        if raw_hint and raw_hint in allowed:
            hinted = raw_hint

    if preferred in allowed:
        executor_id = preferred
    elif hinted:
        executor_id = hinted
    elif ctx.get("entry") in ("hub", "hub_autonomous", "cron", "event", "webhook") or task_spec.get(
        "hub_entry"
    ):
        if hinted:
            executor_id = hinted
        elif resolve_preferred is not None:
            raw_hint = resolve_preferred(task_spec, ctx)
            executor_id = raw_hint if raw_hint and raw_hint in allowed else default_executor
        else:
            executor_id = default_executor
    elif query and bool(task_spec.get("llm_pick_executor", True)):
        executor_id = await llm_pick_executor(
            domain_id=domain_id,
            package_dir=package_dir,
            query=routing_query(task_spec, verbatim),
            default_executor=default_executor,
        )
    else:
        executor_id = default_executor

    set_active_executor(session, executor_id)
    result = await get_executor_runner(executor_id)(
        {
            "session": session,
            "executor_id": executor_id,
            "domain_id": domain_id,
            "task_spec": task_spec,
            "entry": ctx.get("entry") or "interactive",
            "token": ctx.get("token") or "",
            "session_id": ctx.get("session_id") or "",
            "organization_id": ctx.get("organization_id") or "",
            "event_callback": ctx.get("event_callback"),
            "intent": ctx.get("intent") or task_spec.get("intent"),
            "query": query,
            "verbatim_user_text": ctx.get("verbatim_user_text") or query,
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
    out.setdefault("domain_id", domain_id)
    out.setdefault("executor_id", executor_id)
    out.setdefault("agent_md_loaded", not meta.get("missing"))
    if "reply" not in out and out.get("message"):
        out["reply"] = out["message"]
    return out

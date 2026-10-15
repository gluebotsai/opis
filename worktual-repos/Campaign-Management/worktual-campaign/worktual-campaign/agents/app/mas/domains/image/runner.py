"""Image Domain Agent — LLM invoke_executor for interactive chat."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.catalog import executors_for_domain
from app.mas.executors.registry import get_executor_runner
from app.mas.runtime.creation_context import has_templates_for_channels
from app.mas.runtime.llm_loop import llm_pick_image_executor
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import (
    append_step,
    get_mas_task,
    set_active_domain,
    set_active_executor,
    set_needs_domain,
)
from app.mas.runtime.turn import apply_routing_hint, ensure_verbatim_task_spec, routing_query

_PACKAGE = Path(__file__).resolve().parent


def _resolve_forced(task_spec: dict[str, Any], ctx: dict[str, Any]) -> str | None:
    """Deterministic hints from task_spec only (not chat regex)."""
    pref = str(task_spec.get("image_action") or task_spec.get("action") or "").strip().lower()
    if pref in ("generate", "image_generate", "new"):
        return "image_generate"
    if pref in ("refine", "edit", "image_refine"):
        return "image_refine"
    if pref in ("attach", "image_attach"):
        return "image_attach"
    if pref in ("campaign_images", "batch", "multi_channel"):
        return "campaign_images"
    pref_exec = str(task_spec.get("preferred_executor") or "").strip().lower()
    if pref_exec in executors_for_domain("image"):
        return pref_exec
    hint = str(ctx.get("module_hint") or task_spec.get("module") or "").strip().lower()
    if hint == "image":
        return None
    if task_spec.get("template_id") and task_spec.get("attach_after_generate"):
        return "image_attach"
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
            "domain_id": "image",
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
    out.setdefault("domain_id", "image")
    out.setdefault("executor_id", executor_id)
    out.setdefault("agent_md_loaded", not meta.get("missing"))
    if "reply" not in out and out.get("message"):
        out["reply"] = out["message"]
    return out


def _defer_to_campaign_content(
    restated: str, *, change_summary: str
) -> dict[str, Any]:
    return {
        "ok": True,
        "action_status": "needs_domain",
        "kind": "domain",
        "agent_id": "image",
        "domain_id": "image",
        "needs_domain": {
            "domain_id": "creation",
            "restated_query": restated,
            "preferred_executor": "campaign_content",
            "change_summary": change_summary,
        },
        "message": restated,
        "reply": "",
    }


def _needs_creation_build(
    *,
    session: dict[str, Any],
    executor_id: str,
    query: str,
    task_spec: dict[str, Any],
) -> dict[str, Any] | None:
    """Create-chat images go through build_campaign (new cards), never live-card attach."""
    _ = query
    eid = str(executor_id or "").strip().lower()
    if eid not in ("campaign_images", "image_attach"):
        return None
    mod = str(task_spec.get("module") or session.get("module") or "").strip().lower()
    if mod not in ("create_campaign", "recommendations", ""):
        return None
    if str(task_spec.get("chat_context") or "").strip().lower() == "edit":
        return None
    if has_templates_for_channels(session):
        restated = (
            "User wants a new template including any hero/image extras. "
            "Call plan_campaign_images if needed, then build_campaign with "
            "user_confirmed=true. That mints NEW cards. Do not attach or patch "
            "existing chat cards. Copy/layout of one existing card belongs in View/edit."
        )
        set_needs_domain(
            session,
            "creation",
            restated_query=restated,
            preferred_executor="campaign_content",
        )
        return _defer_to_campaign_content(
            restated,
            change_summary="New generate for images; existing cards frozen",
        )
    restated = (
        "Build and persist channel templates first (plan_campaign_images if needed, "
        "then build_campaign with user_confirmed=true). Heroes attach on those new cards."
    )
    set_needs_domain(
        session,
        "creation",
        restated_query=restated,
        preferred_executor="campaign_content",
    )
    return _defer_to_campaign_content(
        restated,
        change_summary="Templates required before image attach",
    )


async def run_image_domain(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    set_active_domain(session, "image")

    task_spec = dict(ctx.get("task_spec") or {})
    verbatim = ensure_verbatim_task_spec(ctx, task_spec)
    session_dict = session if isinstance(session, dict) else {}
    from app.agents.image.enhance import merge_image_slots_from_session

    task_spec = merge_image_slots_from_session(session_dict, task_spec)
    module_name = str(
        ctx.get("module_hint")
        or task_spec.get("module")
        or session_dict.get("module")
        or ""
    ).strip().lower()
    if (
        session_dict.get("template_id")
        and not task_spec.get("template_id")
        and module_name not in ("create_campaign", "recommendations")
        and str(task_spec.get("chat_context") or "").strip().lower() != "edit"
    ):
        task_spec["template_id"] = session_dict["template_id"]
    query = verbatim
    allowed = frozenset(executors_for_domain("image"))
    default_executor = "image_generate"

    preferred = str(task_spec.get("executor_id") or "").strip().lower()
    forced = _resolve_forced(task_spec, ctx)

    if preferred in allowed:
        blocked = _needs_creation_build(
            session=session,
            executor_id=preferred,
            query=query,
            task_spec=task_spec,
        )
        if blocked:
            return blocked
        return await _run_executor(
            session=session,
            executor_id=preferred,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )
    if forced and forced in allowed:
        blocked = _needs_creation_build(
            session=session,
            executor_id=forced,
            query=query,
            task_spec=task_spec,
        )
        if blocked:
            return blocked
        return await _run_executor(
            session=session,
            executor_id=forced,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    task = get_mas_task(session)
    sticky_exec = str(task.get("active_executor") or "").strip().lower()
    if (
        ctx.get("entry") == "sticky_domain"
        and sticky_exec in allowed
        and not preferred
        and not forced
        and query
        and bool(task_spec.get("llm_pick_executor", True))
    ):
        return await _run_executor(
            session=session,
            executor_id=sticky_exec,
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
        pick = await llm_pick_image_executor(
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
                "agent_id": "image",
                "domain_id": "image",
                "message": (
                    "I can generate a new image, refine the last one, or attach it "
                    "to a template. What would you like?"
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
        blocked = _needs_creation_build(
            session=session,
            executor_id=eid,
            query=query,
            task_spec=task_spec,
        )
        if blocked:
            return blocked
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

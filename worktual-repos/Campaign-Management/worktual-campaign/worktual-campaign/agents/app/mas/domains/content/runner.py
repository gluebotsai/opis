"""Content Domain Agent — LLM invoke_executor for interactive chat."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.catalog import executors_for_domain
from app.mas.executors.registry import get_executor_runner
from app.mas.runtime.llm_loop import llm_pick_content_executor
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.creation_context import has_templates_for_channels
from app.mas.runtime.task_memory import (
    append_step,
    set_active_domain,
    set_active_executor,
    set_needs_domain,
)
from app.mas.runtime.turn import apply_routing_hint, ensure_verbatim_task_spec, routing_query

_PACKAGE = Path(__file__).resolve().parent

_MODULE_EXEC = {
    "whatsapp_rejected": "content_verification",
    "template_coach": "template_coach",
    "template_library": "email_content",
}
_CHANNEL_EXEC = {
    "email": "email_content",
    "whatsapp": "whatsapp_content",
    "push": "app_push_content",
    "app_push": "app_push_content",
    "web": "web_push_content",
    "web_push": "web_push_content",
}


def _resolve_forced(task_spec: dict[str, Any], ctx: dict[str, Any]) -> str | None:
    """Deterministic module/hub bindings only (not chat intent)."""
    hint = str(ctx.get("module_hint") or task_spec.get("module") or "").strip().lower()
    if hint in _MODULE_EXEC:
        return _MODULE_EXEC[hint]
    ch = str(task_spec.get("channel") or "").strip().lower()
    if ch in _CHANNEL_EXEC:
        return _CHANNEL_EXEC[ch]
    channels = task_spec.get("channels")
    if isinstance(channels, list) and channels:
        first = str(channels[0] or "").strip().lower()
        if first in _CHANNEL_EXEC:
            return _CHANNEL_EXEC[first]
    pref = str(task_spec.get("preferred_executor") or "").strip().lower()
    if pref in executors_for_domain("content"):
        return pref
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
            "domain_id": "content",
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
    out.setdefault("domain_id", "content")
    out.setdefault("executor_id", executor_id)
    out.setdefault("agent_md_loaded", not meta.get("missing"))
    if "reply" not in out and out.get("message"):
        out["reply"] = out["message"]
    return out


async def run_content_domain(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    set_active_domain(session, "content")

    task_spec = dict(ctx.get("task_spec") or {})
    verbatim = ensure_verbatim_task_spec(ctx, task_spec)
    query = verbatim
    allowed = frozenset(executors_for_domain("content"))
    default_executor = "email_content"

    mod = str(ctx.get("module_hint") or task_spec.get("module") or session.get("module") or "").strip().lower()
    if mod in ("create_campaign", "recommendations") and not has_templates_for_channels(session):
        restated = query or (
            "Build and persist channel templates via build_campaign (plan_campaign_images "
            "first when hero images were requested)."
        )
        set_needs_domain(
            session,
            "creation",
            restated_query=restated,
            preferred_executor="campaign_content",
        )
        return {
            "ok": True,
            "action_status": "needs_domain",
            "kind": "domain",
            "agent_id": "content",
            "domain_id": "content",
            "needs_domain": {
                "domain_id": "creation",
                "restated_query": restated,
                "preferred_executor": "campaign_content",
            },
            "message": "Redirecting template build to Creation domain.",
            "reply": "",
            "agent_md_loaded": not meta.get("missing"),
        }

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
        pick = await llm_pick_content_executor(
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
                "agent_id": "content",
                "domain_id": "content",
                "message": (
                    "I can generate channel templates, fix rejected WhatsApp copy, "
                    "send approved templates, or help edit templates. What do you need?"
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

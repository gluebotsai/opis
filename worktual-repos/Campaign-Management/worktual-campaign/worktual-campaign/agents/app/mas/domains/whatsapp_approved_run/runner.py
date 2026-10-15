"""WhatsApp Approved Run Domain Agent — create executors + approved send."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.catalog import executors_for_domain
from app.mas.executors.registry import get_executor_runner
from app.mas.runtime.flags import is_domain_enabled
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import (
    append_step,
    get_mas_task,
    set_active_domain,
    set_active_executor,
    set_needs_domain,
)
from app.mas.runtime.turn import apply_routing_hint, ensure_verbatim_task_spec, routing_query
from app.mas.skills import (
    CREATE_CAMPAIGN_MODULE,
    WHATSAPP_APPROVED_MODULE,
    bind_create_campaign_skill_if_changed,
    bind_whatsapp_approved_skill_if_changed,
    get_active_skill_id,
    run_creation_executor_via_harness,
    run_whatsapp_approved_executor_via_harness,
    select_whatsapp_approved_run_skill,
)
from app.mas.skills.create_campaign import default_skill_for_executor as create_default_skill
from app.mas.skills.whatsapp_approved import default_skill_for_executor as wa_default_skill

_PACKAGE = Path(__file__).resolve().parent
_DOMAIN_ID = "whatsapp_approved_run"

_CREATE_SKILLED = frozenset(
    {
        "brief_validation",
        "campaign_audience",
        "launch_scheduling",
    }
)
_WA_SEND = "whatsapp_approved_send"


def _bind_skill_for_executor(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    executor_id: str,
    *,
    skill_id: str | None = None,
    skill_action: str = "continue",
) -> str:
    eid = str(executor_id or "").strip().lower()
    sid = str(skill_id or "").strip().lower()
    if eid in _CREATE_SKILLED:
        if not sid:
            sid = (
                get_active_skill_id(session, CREATE_CAMPAIGN_MODULE)
                or create_default_skill(eid)
                or "campaign_brief"
            )
        bind_create_campaign_skill_if_changed(
            session,
            task_spec,
            skill_id=sid,
            skill_action=skill_action,
            executor_id=eid,
        )
        return str(task_spec.get("executor_id") or eid)
    if eid == _WA_SEND:
        if not sid:
            sid = (
                get_active_skill_id(session, WHATSAPP_APPROVED_MODULE)
                or wa_default_skill(eid)
                or "approved_audience"
            )
        bind_whatsapp_approved_skill_if_changed(
            session,
            task_spec,
            skill_id=sid,
            skill_action=skill_action,
            executor_id=eid,
        )
        return str(task_spec.get("executor_id") or eid)
    return eid


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
            "domain_id": _DOMAIN_ID,
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
            "module_hint": ctx.get("module_hint") or task_spec.get("module") or "whatsapp_approved",
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
    out.setdefault("domain_id", _DOMAIN_ID)
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
    eid = str(executor_id or "").strip().lower()
    if eid == _WA_SEND:
        out = await run_whatsapp_approved_executor_via_harness(
            session=session,
            executor_id=eid,
            task_spec=task_spec,
            ctx=ctx,
            run_executor=_run_executor,
            meta=meta,
        )
        if isinstance(out, dict):
            out.setdefault("domain_id", _DOMAIN_ID)
        return out
    out = await run_creation_executor_via_harness(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        run_executor=_run_executor,
        meta=meta,
    )
    if isinstance(out, dict):
        out.setdefault("domain_id", _DOMAIN_ID)
    return out


async def run_whatsapp_approved_run_domain(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    set_active_domain(session, _DOMAIN_ID)
    session["whatsapp_approved_run"] = True

    task_spec = dict(ctx.get("task_spec") or {})
    verbatim = ensure_verbatim_task_spec(ctx, task_spec)
    query = verbatim
    allowed = frozenset(executors_for_domain(_DOMAIN_ID))
    default_executor = "campaign_audience"

    preferred = str(task_spec.get("executor_id") or "").strip().lower()
    pref_hint = str(task_spec.get("preferred_executor") or "").strip().lower()
    pref_skill = str(task_spec.get("skill_id") or "").strip().lower()

    if preferred in allowed:
        preferred = _bind_skill_for_executor(
            session,
            task_spec,
            preferred,
            skill_id=pref_skill or None,
            skill_action=str(task_spec.get("skill_action") or "continue"),
        )
        return await _dispatch_executor(
            session=session,
            executor_id=preferred,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )
    if pref_hint in allowed and task_spec.get("hub_entry"):
        pref_hint = _bind_skill_for_executor(
            session,
            task_spec,
            pref_hint,
            skill_id=pref_skill or None,
            skill_action=str(task_spec.get("skill_action") or "new_task"),
        )
        return await _dispatch_executor(
            session=session,
            executor_id=pref_hint,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    if ctx.get("entry") == "sticky_domain":
        sticky = str(get_mas_task(session).get("active_executor") or "").strip().lower()
        if sticky in allowed:
            sticky = _bind_skill_for_executor(
                session,
                task_spec,
                sticky,
                skill_action="continue",
            )
            return await _dispatch_executor(
                session=session,
                executor_id=sticky,
                task_spec=task_spec,
                ctx=ctx,
                meta=meta,
            )

    if query and bool(task_spec.get("llm_pick_executor", True)):
        pick = await select_whatsapp_approved_run_skill(
            package_dir=_PACKAGE,
            query=routing_query(task_spec, verbatim),
            session=session,
            default_executor=default_executor,
        )
        if pick.needs_domain:
            target = pick.needs_domain
            restated = pick.restated_query or query
            if is_domain_enabled(target):
                pref_exec = pick.preferred_executor or None
                set_needs_domain(
                    session,
                    target,
                    restated_query=restated,
                    preferred_executor=pref_exec if pref_exec else None,
                )
                return {
                    "ok": True,
                    "action_status": "needs_domain",
                    "kind": "domain",
                    "agent_id": _DOMAIN_ID,
                    "domain_id": _DOMAIN_ID,
                    "needs_domain": {
                        "domain_id": target,
                        "restated_query": restated,
                        "preferred_executor": pref_exec,
                        "change_summary": pick.change_summary or "",
                    },
                    "message": f"Handing off to {target} domain for: {restated}",
                    "reply": "",
                    "agent_md_loaded": not meta.get("missing"),
                    "llm": pick.llm,
                }
            eid = _bind_skill_for_executor(
                session,
                task_spec,
                default_executor,
                skill_action="continue",
            )
            return await _dispatch_executor(
                session=session,
                executor_id=eid,
                task_spec=task_spec,
                ctx=ctx,
                meta=meta,
            )

        if pick.direct_reply:
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
                "agent_id": _DOMAIN_ID,
                "domain_id": _DOMAIN_ID,
                "message": pick.direct_reply,
                "reply": pick.direct_reply,
                "agent_md_loaded": not meta.get("missing"),
                "llm": pick.llm,
            }

        eid = pick.executor_id if pick.executor_id in allowed else default_executor
        if pick.restated_query:
            apply_routing_hint(task_spec, pick.restated_query, verbatim)
        if pick.user_confirmed is not None:
            task_spec["user_confirmed"] = bool(pick.user_confirmed)
        eid = _bind_skill_for_executor(
            session,
            task_spec,
            eid,
            skill_id=pick.skill_id or None,
            skill_action=pick.skill_action or "continue",
        )
        return await _dispatch_executor(
            session=session,
            executor_id=eid,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    eid = _bind_skill_for_executor(
        session,
        task_spec,
        default_executor,
        skill_action="continue",
    )
    return await _dispatch_executor(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )

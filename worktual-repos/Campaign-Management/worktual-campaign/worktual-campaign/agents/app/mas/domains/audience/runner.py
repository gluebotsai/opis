"""Audience Domain Agent — Skill Selector + Harness → Executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.catalog import executors_for_domain
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import (
    append_step,
    get_mas_task,
    set_active_domain,
    set_active_executor,
)
from app.mas.runtime.turn import apply_routing_hint, ensure_verbatim_task_spec, routing_query
from app.mas.skills import (
    CONTACTS_MODULE,
    bind_contact_skill_if_changed,
    get_active_skill_id,
    run_audience_executor_via_harness,
    select_audience_skill,
)

_PACKAGE = Path(__file__).resolve().parent


def _pass_through_executor(
    session: dict[str, Any],
    allowed: frozenset[str],
) -> str | None:
    """Session-state safety when Domain LLM fails — not chat intent parsing."""
    task = get_mas_task(session)
    sticky = str(task.get("active_executor") or "").strip().lower()
    if sticky in allowed:
        return sticky
    active_skill = get_active_skill_id(session, CONTACTS_MODULE)
    if active_skill and "contact" in allowed:
        return "contact"
    return None


def _looks_like_create_identity_value(text: str) -> bool:
    """True when the turn is mainly an email or phone (format check, not chat intent)."""
    raw = (text or "").strip()
    if not raw or len(raw) > 80:
        return False
    from app.agents.contacts.draft_ingest import EMAIL_FIND_RE
    from app.agents.contacts.validation import (
        digits_only,
        is_valid_email,
        looks_like_email_attempt,
        parse_and_validate_phone,
    )

    if looks_like_email_attempt(raw):
        return True
    em = EMAIL_FIND_RE.search(raw)
    if em and is_valid_email(em.group(0).strip().lower()):
        # Whole message is basically the email (optional "email:" label).
        remainder = EMAIL_FIND_RE.sub("", raw).strip(" :,-")
        if not remainder or remainder.lower() in ("email", "mail", "e-mail"):
            return True
    ph = parse_and_validate_phone(raw)
    if ph.get("ok") and len(raw.split()) <= 4:
        return True
    # Digit-heavy phone attempts (with or without +) stay on create mid-flow.
    digits = digits_only(raw)
    if (
        digits
        and len(digits) >= 8
        and len(raw.split()) <= 4
        and not any(c.isalpha() for c in raw)
    ):
        return True
    return False


def _bind_contact_skill_to_task(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
) -> None:
    bind_contact_skill_if_changed(
        session,
        task_spec,
        skill_id=skill_id,
        skill_action=skill_action,
    )


def _bind_active_contact_skill(session: dict[str, Any], task_spec: dict[str, Any]) -> str:
    skill = get_active_skill_id(session, CONTACTS_MODULE) or "contact_creation"
    _bind_contact_skill_to_task(
        session,
        task_spec,
        skill_id=skill,
        skill_action=str(task_spec.get("skill_action") or "continue"),
    )
    return skill


async def _run_executor(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    ctx: dict[str, Any],
    meta: dict[str, Any],
) -> dict[str, Any]:
    from app.mas.executors.registry import get_executor_runner

    set_active_executor(session, executor_id)
    result = await get_executor_runner(executor_id)(
        {
            "session": session,
            "executor_id": executor_id,
            "domain_id": "audience",
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
            "module_hint": ctx.get("module_hint") or task_spec.get("module") or "contacts",
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
    out.setdefault("domain_id", "audience")
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
    """Skill harness for contact; direct executor for selection/pull."""
    return await run_audience_executor_via_harness(
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
    query: str,
    verbatim: str,
    allowed: frozenset[str],
) -> dict[str, Any]:
    """Domain Skill Selector every turn; Harness runs executor."""
    pick = await select_audience_skill(
        package_dir=_PACKAGE,
        query=routing_query(task_spec, verbatim),
        session=session,
        module_hint=str(ctx.get("module_hint") or task_spec.get("module") or "contacts"),
    )

    if pick.ok and pick.direct_reply:
        from app.mas.skills.state import is_active_contact_creation

        # Mid-flow contact work must reach the executor — never Domain-only chat.
        skill_busy = bool(get_active_skill_id(session, CONTACTS_MODULE))
        create_busy = is_active_contact_creation(session)
        if not skill_busy and not create_busy:
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
                "agent_id": "audience",
                "domain_id": "audience",
                "message": pick.direct_reply,
                "reply": pick.direct_reply,
                "agent_md_loaded": not meta.get("missing"),
                "llm": pick.llm,
            }
        skill = get_active_skill_id(session, CONTACTS_MODULE) or "contact_creation"
        _bind_contact_skill_to_task(
            session,
            task_spec,
            skill_id=skill,
            skill_action="continue",
        )
        return await _dispatch_executor(
            session=session,
            executor_id="contact",
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    if not pick.ok:
        fallback = _pass_through_executor(session, allowed)
        if fallback:
            if fallback == "contact":
                skill = get_active_skill_id(session, CONTACTS_MODULE) or "contact_creation"
                _bind_contact_skill_to_task(
                    session,
                    task_spec,
                    skill_id=skill,
                    skill_action="continue",
                )
            return await _dispatch_executor(
                session=session,
                executor_id=fallback,
                task_spec=task_spec,
                ctx=ctx,
                meta=meta,
            )
        if "contact" in allowed:
            _bind_contact_skill_to_task(
                session,
                task_spec,
                skill_id="contact_creation",
                skill_action="new_task",
            )
            return await _dispatch_executor(
                session=session,
                executor_id="contact",
                task_spec=task_spec,
                ctx=ctx,
                meta=meta,
            )
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "domain",
            "agent_id": "audience",
            "domain_id": "audience",
            "message": "",
            "reply": "",
            "agent_md_loaded": not meta.get("missing"),
            "llm": pick.llm,
        }

    eid = pick.executor_id
    if eid not in allowed:
        fallback = _pass_through_executor(session, allowed)
        if fallback:
            if fallback == "contact":
                skill = get_active_skill_id(session, CONTACTS_MODULE) or "contact_creation"
                _bind_contact_skill_to_task(
                    session,
                    task_spec,
                    skill_id=skill,
                    skill_action="continue",
                )
            return await _dispatch_executor(
                session=session,
                executor_id=fallback,
                task_spec=task_spec,
                ctx=ctx,
                meta=meta,
            )
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "domain",
            "agent_id": "audience",
            "domain_id": "audience",
            "message": "",
            "reply": "",
            "agent_md_loaded": not meta.get("missing"),
            "llm": pick.llm,
        }

    if pick.restated_query:
        apply_routing_hint(task_spec, pick.restated_query, verbatim)
    if pick.user_confirmed is not None:
        task_spec["user_confirmed"] = bool(pick.user_confirmed)

    from app.mas.skills.state import is_active_contact_creation

    # Mid-create must stay on contact — never filter/SQL/list mid-interview.
    if eid in ("audience_selection", "audience_pull") and is_active_contact_creation(
        session
    ):
        eid = "contact"
        _bind_contact_skill_to_task(
            session,
            task_spec,
            skill_id="contact_creation",
            skill_action="continue",
        )
    elif eid == "contact" and pick.skill_id:
        skill_id = str(pick.skill_id or "").strip()
        skill_action = str(pick.skill_action or "continue").strip().lower() or "continue"
        # Sticky create: keep interview for field values, but allow Domain to leave
        # create when it explicitly switches/starts view or update (show/list/edit).
        _leave_create = frozenset(
            {"switch", "pause_and_switch", "complete", "cancelled", "new_task"}
        )
        if (
            is_active_contact_creation(session)
            and skill_id in ("contact_view", "contact_update")
            and skill_action in _leave_create
        ):
            pass  # Domain chose to leave create — honor it
        elif (
            is_active_contact_creation(session)
            and skill_id != "contact_creation"
            and skill_action not in _leave_create
        ):
            skill_id = "contact_creation"
            skill_action = "continue"
        _bind_contact_skill_to_task(
            session,
            task_spec,
            skill_id=skill_id,
            skill_action=skill_action,
        )
    elif eid == "contact" and not task_spec.get("skill_id"):
        _bind_active_contact_skill(session, task_spec)

    return await _dispatch_executor(
        session=session,
        executor_id=eid,
        task_spec=task_spec,
        ctx=ctx,
        meta=meta,
    )


async def run_audience_domain(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    session.setdefault("module", "contacts")
    set_active_domain(session, "audience")

    task_spec = dict(ctx.get("task_spec") or {})
    task_spec.setdefault("module", "contacts")
    verbatim = ensure_verbatim_task_spec(ctx, task_spec)
    query = verbatim
    allowed = frozenset(executors_for_domain("audience"))

    pref = str(
        task_spec.get("preferred_executor") or task_spec.get("executor_id") or ""
    ).strip().lower()
    if task_spec.get("hub_create"):
        pref = "contact"
        _bind_contact_skill_to_task(
            session,
            task_spec,
            skill_id=str(task_spec.get("skill_id") or "contact_creation"),
            skill_action=str(task_spec.get("skill_action") or "new_task"),
        )
    if pref in allowed:
        if pref == "contact" and not task_spec.get("skill_id"):
            _bind_active_contact_skill(session, task_spec)
        return await _dispatch_executor(
            session=session,
            executor_id=pref,
            task_spec=task_spec,
            ctx=ctx,
            meta=meta,
        )

    if task_spec.get("tool") or task_spec.get("tool_name"):
        eid = str(task_spec.get("executor_id") or "contact").strip().lower()
        if eid not in allowed:
            eid = "contact"
        if eid == "contact" and not task_spec.get("skill_id"):
            _bind_active_contact_skill(session, task_spec)
        return await _dispatch_executor(
            session=session,
            executor_id=eid,
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
            query=query,
            verbatim=verbatim,
            allowed=allowed,
        )

    fallback = _pass_through_executor(session, allowed)
    if fallback:
        if fallback == "contact":
            _bind_active_contact_skill(session, task_spec)
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
        "agent_id": "audience",
        "domain_id": "audience",
        "message": "",
        "reply": "",
        "agent_md_loaded": not meta.get("missing"),
    }

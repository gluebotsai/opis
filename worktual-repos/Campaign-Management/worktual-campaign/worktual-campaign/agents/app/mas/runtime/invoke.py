"""mas.invoke — single entry for interactive and skip-Super paths."""

from __future__ import annotations

from typing import Any

from app.mas.catalog import (
    domain_for_executor,
    normalize_domain,
    normalize_executor,
)
from app.mas.runtime.bindings import resolve_cron_binding, resolve_hub_binding
from app.mas.runtime.handoffs import invoke_executor_result, route_to_domain_result
from app.mas.runtime.task_memory import (
    append_step,
    get_mas_task,
    set_active_domain,
    set_active_executor,
)
from app.mas.runtime.transcript import record_assistant_turn, record_user_turn
from app.mas.runtime.turn import MasTurn, executor_ctx_base, should_manage_transcript
from app.request_context import mas_transcript_scope


def _apply_hub_binding_hints(
    raw: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    hub_skill: str | None,
) -> None:
    """Hub bindings are Super/Domain hints — not auto skip-Super shortcuts."""
    if not hub_skill:
        return
    bound = resolve_hub_binding(str(hub_skill))
    if not bound:
        return
    task_spec.setdefault("hub_skill", str(hub_skill).strip())
    task_spec.setdefault("hub_entry", True)
    if not task_spec.get("preferred_domain"):
        task_spec["preferred_domain"] = bound["domain_id"]
    if not task_spec.get("preferred_executor"):
        task_spec["preferred_executor"] = bound["executor_id"]
    if not raw.get("domain_id"):
        raw["domain_id"] = bound["domain_id"]


def _prepare_turn_context(
    raw: dict[str, Any],
    task_spec: dict[str, Any],
    session: dict[str, Any],
) -> MasTurn:
    turn = MasTurn.from_payload(raw, task_spec, session)
    raw["verbatim_user_text"] = turn.verbatim_user_text
    task_spec["query"] = turn.verbatim_user_text
    return turn


async def _dispatch_mas(
    *,
    raw: dict[str, Any],
    task_spec: dict[str, Any],
    session: dict[str, Any],
    entry: str,
    skip_super: bool,
    force_super: bool,
    domain_id: str | None,
    executor_id: str | None,
) -> dict[str, Any]:
    if executor_id and skip_super:
        return await _run_executor(
            session=session,
            executor_id=executor_id,
            task_spec=task_spec,
            entry=entry,
            raw=raw,
        )

    if skip_super and domain_id:
        return await _run_domain(
            session=session,
            domain_id=domain_id,
            task_spec=task_spec,
            entry=entry,
            raw=raw,
        )

    if not skip_super:
        from app.mas.super_agent.runner import run_super

        return await run_super(
            session=session,
            query=str(raw.get("verbatim_user_text") or task_spec.get("query") or ""),
            task_spec=task_spec,
            preferred_domain=domain_id,
            raw=raw,
        )

    return {
        "ok": False,
        "status": "failed",
        "error": "mas_invoke requires domain_id or executor_id when skip_super is true",
        "entry": entry,
    }


async def mas_invoke(payload: dict[str, Any] | None) -> dict[str, Any]:
    """
    Invoke MAS.

    payload keys:
      entry: interactive | sticky_domain | hub | hub_autonomous | cron | event | webhook
      skip_super: bool
      domain_id / executor_id: optional targets
      hub_skill / cron_event: optional binding keys
      task_spec: dict
      session: mutable session dict (optional)
      query / verbatim_user_text: str (never use restated_query for chat)
      session_id / token / correlation_id: optional
    """
    raw = dict(payload or {})
    entry = str(raw.get("entry") or "interactive").strip().lower()
    task_spec = dict(raw.get("task_spec") or {})
    force_super = bool(task_spec.get("force_super") or task_spec.get("hub_entry"))
    skip_super = bool(raw.get("skip_super"))

    if not force_super and entry in ("sticky_domain", "cron", "event", "webhook"):
        skip_super = True

    if entry in ("hub", "hub_autonomous") and not force_super and not raw.get("skip_super"):
        entry = "interactive"
        skip_super = False
        task_spec.setdefault("hub_entry", True)

    session = raw.get("session")
    if not isinstance(session, dict):
        session = {}

    hub_skill = raw.get("hub_skill") or raw.get("intent") or task_spec.get("hub_skill")
    cron_event = raw.get("cron_event") or raw.get("event_id")

    if hub_skill and not raw.get("skip_super"):
        _apply_hub_binding_hints(raw, task_spec, hub_skill=str(hub_skill))

    if not force_super and entry in ("cron", "event", "webhook") and cron_event:
        bound = resolve_cron_binding(str(cron_event))
        if bound:
            raw.setdefault("domain_id", bound["domain_id"])
            raw.setdefault("executor_id", bound["executor_id"])
            skip_super = True

    turn = _prepare_turn_context(raw, task_spec, session)

    correlation_id = str(raw.get("correlation_id") or "")
    task = get_mas_task(session)
    if correlation_id:
        task["correlation_id"] = correlation_id

    domain_id = normalize_domain(raw.get("domain_id"))
    executor_id = normalize_executor(raw.get("executor_id"))

    if not should_manage_transcript(turn, session):
        return await _dispatch_mas(
            raw=raw,
            task_spec=task_spec,
            session=session,
            entry=entry,
            skip_super=skip_super,
            force_super=force_super,
            domain_id=domain_id,
            executor_id=executor_id,
        )

    persist_chat = bool(task_spec.get("persist_chat", True))
    raw["mas_transcript_managed"] = True
    if not persist_chat:
        return await _dispatch_mas(
            raw=raw,
            task_spec=task_spec,
            session=session,
            entry=entry,
            skip_super=skip_super,
            force_super=force_super,
            domain_id=domain_id,
            executor_id=executor_id,
        )

    with mas_transcript_scope(managed=True):
        await record_user_turn(turn)
        result = await _dispatch_mas(
            raw=raw,
            task_spec=task_spec,
            session=session,
            entry=entry,
            skip_super=skip_super,
            force_super=force_super,
            domain_id=domain_id,
            executor_id=executor_id,
        )
        await record_assistant_turn(turn, result)
        return result


async def _run_domain(
    *,
    session: dict[str, Any],
    domain_id: str,
    task_spec: dict[str, Any],
    entry: str,
    raw: dict[str, Any],
    follow_hops: bool = True,
) -> dict[str, Any]:
    set_active_domain(session, domain_id)
    from app.mas.domains.registry import get_domain_runner

    ctx_base = executor_ctx_base(raw, task_spec)
    runner = get_domain_runner(domain_id)
    result = await runner(
        {
            "session": session,
            "domain_id": domain_id,
            "task_spec": task_spec,
            "entry": entry,
            "query": ctx_base["verbatim_user_text"],
            "token": raw.get("token") or "",
            "session_id": raw.get("session_id") or "",
            "organization_id": raw.get("organization_id") or "",
            "event_callback": raw.get("event_callback"),
            "module_hint": raw.get("module_hint") or "",
            "hub_skill": raw.get("hub_skill") or task_spec.get("hub_skill") or "",
            **ctx_base,
        }
    )
    if not follow_hops:
        return result if isinstance(result, dict) else {"ok": False}
    from app.mas.runtime.handoffs import follow_needs_domain_hops

    return await follow_needs_domain_hops(
        initial=result if isinstance(result, dict) else {"ok": False},
        session=session,
        raw=raw,
        max_hops=3,
    )


async def _run_executor(
    *,
    session: dict[str, Any],
    executor_id: str,
    task_spec: dict[str, Any],
    entry: str,
    raw: dict[str, Any],
) -> dict[str, Any]:
    did = domain_for_executor(executor_id)
    if did:
        set_active_domain(session, did)
    set_active_executor(session, executor_id)

    handoff = invoke_executor_result(executor_id=executor_id, task_spec=task_spec)
    if not handoff.get("ok"):
        return handoff

    from app.mas.executors.registry import get_executor_runner

    ctx_base = executor_ctx_base(raw, task_spec)
    runner = get_executor_runner(executor_id)
    result = await runner(
        {
            "session": session,
            "executor_id": executor_id,
            "domain_id": did,
            "task_spec": task_spec,
            "entry": entry,
            "token": raw.get("token") or "",
            "session_id": raw.get("session_id") or "",
            "organization_id": raw.get("organization_id") or "",
            "event_callback": raw.get("event_callback"),
            "query": ctx_base["verbatim_user_text"],
            **ctx_base,
        }
    )
    status = str(result.get("action_status") or ("completed" if result.get("ok") else "failed"))
    append_step(
        session,
        executor_id=executor_id,
        action_status=status,
        result=result if isinstance(result, dict) else {},
        message=str(result.get("message") or ""),
    )
    return result


# Re-export for callers that want structured handoff without running.
__all__ = ["mas_invoke", "route_to_domain_result", "invoke_executor_result", "_run_domain"]

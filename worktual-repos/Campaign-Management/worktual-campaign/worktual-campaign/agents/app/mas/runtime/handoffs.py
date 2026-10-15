"""Handoff helpers — route_to_domain / invoke_executor / needs_domain follow."""

from __future__ import annotations

from typing import Any

from app.mas.catalog import (
    DOMAIN_IDS,
    executors_for_domain,
    normalize_domain,
    normalize_executor,
)
from app.mas.runtime.flags import is_domain_enabled
from app.mas.runtime.task_memory import get_mas_task, set_needs_domain, set_active_domain, set_active_executor


def route_to_domain_result(
    *,
    domain_id: str,
    restated_query: str = "",
    context_refs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    did = normalize_domain(domain_id)
    if not did:
        return {
            "ok": False,
            "error": f"Unknown domain '{domain_id}'. Use one of: {', '.join(DOMAIN_IDS)}.",
        }
    return {
        "ok": True,
        "status": "routed",
        "domain_id": did,
        "restated_query": str(restated_query or "").strip(),
        "context_refs": dict(context_refs or {}),
        "executors": list(executors_for_domain(did)),
        "message": f"Routed to domain '{did}'.",
    }


def invoke_executor_result(
    *,
    executor_id: str,
    task_spec: dict[str, Any] | None = None,
    user_confirmed: bool | None = None,
) -> dict[str, Any]:
    eid = normalize_executor(executor_id)
    if not eid:
        return {
            "ok": False,
            "error": f"Unknown executor '{executor_id}'.",
        }
    spec = dict(task_spec or {})
    if user_confirmed is not None:
        spec["user_confirmed"] = bool(user_confirmed)
    return {
        "ok": True,
        "status": "invoke",
        "executor_id": eid,
        "task_spec": spec,
        "message": f"Invoke executor '{eid}'.",
    }


def extract_needs_domain(
    result: dict[str, Any] | None,
    session: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Normalize needs_domain from a domain/executor result or session task."""
    if isinstance(result, dict):
        raw = result.get("needs_domain")
        if isinstance(raw, dict) and raw.get("domain_id"):
            did = normalize_domain(raw.get("domain_id"))
            if did:
                return {
                    "domain_id": did,
                    "restated_query": str(raw.get("restated_query") or ""),
                    "preferred_executor": normalize_executor(
                        raw.get("preferred_executor")
                    ),
                    "change_summary": str(raw.get("change_summary") or ""),
                }
        if isinstance(raw, str) and normalize_domain(raw):
            return {
                "domain_id": normalize_domain(raw),
                "restated_query": str(result.get("query") or ""),
                "preferred_executor": None,
                "change_summary": "",
            }
    task = get_mas_task(session if isinstance(session, dict) else {})
    pending = task.get("needs_domain")
    if isinstance(pending, dict) and pending.get("domain_id"):
        did = normalize_domain(pending.get("domain_id"))
        if did:
            return {
                "domain_id": did,
                "restated_query": str(pending.get("restated_query") or ""),
                "preferred_executor": normalize_executor(
                    pending.get("preferred_executor")
                ),
                "change_summary": "",
            }
    return None


async def follow_needs_domain_hops(
    *,
    initial: dict[str, Any],
    session: dict[str, Any],
    raw: dict[str, Any],
    max_hops: int = 4,
) -> dict[str, Any]:
    """
    After a domain returns needs_domain, run the target domain (skip Super)
    when that domain is MAS-enabled. Max hops per turn.
    """
    from app.mas.runtime.invoke import _run_domain

    out = initial
    hops: list[dict[str, Any]] = []
    for _ in range(max_hops):
        needs = extract_needs_domain(out, session)
        if not needs:
            break
        target = needs["domain_id"]
        if not is_domain_enabled(target):
            break
        set_needs_domain(session, None)
        verbatim = str(
            raw.get("verbatim_user_text")
            or (raw.get("task_spec") or {}).get("query")
            or raw.get("query")
            or ""
        ).strip()
        restated = str(needs.get("restated_query") or "").strip()
        src_module = str(
            (raw.get("task_spec") or {}).get("module")
            or raw.get("module_hint")
            or session.get("module")
            or "create_campaign"
        ).strip().lower()
        src_domain = str(
            out.get("domain_id")
            or (raw.get("domain_id") if isinstance(raw, dict) else "")
            or session.get("mas_task", {}).get("active_domain")
            or "creation"
        ).strip().lower()
        task_spec: dict[str, Any] = {
            "query": verbatim,
            "module": src_module,
            "from_domain_handoff": True,
            "handoff_source_domain": src_domain,
        }
        if restated:
            task_spec["routing_hint"] = restated
        pref = needs.get("preferred_executor")
        if pref:
            task_spec["executor_id"] = pref
        hopped = await _run_domain(
            session=session,
            domain_id=target,
            task_spec=task_spec,
            entry="sticky_domain",
            raw={**raw, "module_hint": src_module},
            follow_hops=False,
        )
        hops.append(
            {
                "domain_id": target,
                "restated_query": restated,
                "preferred_executor": pref,
            }
        )
        out = dict(hopped) if isinstance(hopped, dict) else {"ok": False}
        out["handoff_hops"] = list(hops)
        # Return sticky routing to Creation on the next create-campaign turn.
        if src_module in ("create_campaign", "recommendations"):
            set_active_domain(session, target)
            pref_exec = needs.get("preferred_executor")
            if pref_exec:
                set_active_executor(session, str(pref_exec).strip().lower())
    return out

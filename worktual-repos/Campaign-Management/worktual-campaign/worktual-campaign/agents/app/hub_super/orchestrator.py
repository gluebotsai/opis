"""Hub Super Agent orchestrator — route + sequential execute, one hub response."""

from __future__ import annotations

from typing import Any

from app.hub_super.executor import run_sequential
from app.hub_super.router import route_pipeline
from app.hub_super.schemas import hub_task_result, normalize_hub_request
from app.hub_super.skill_catalog import agent_card


def _aggregate_result(prior: dict[str, Any], pipeline: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {"by_skill": {}}
    for skill_id in pipeline:
        data = prior.get(skill_id)
        if isinstance(data, dict):
            cleaned = {
                k: v
                for k, v in data.items()
                if k not in {"raw", "ok", "skill", "status"}
            }
            out["by_skill"][skill_id] = cleaned
            # Promote common keys for convenience.
            for key in (
                "campaign_id",
                "contact_id",
                "contact",
                "templates",
                "report",
                "launch",
                "action",
                "message",
            ):
                if key in cleaned and key not in out:
                    out[key] = cleaned[key]
    return out


def _unknown_hub_query(request: dict[str, Any]) -> str:
    intent = str(request.get("intent") or "").strip()
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else {}
    campaign_id = str(payload.get("campaign_id") or "").strip()
    parts = [intent.replace("_", " ") if intent else "Hub task"]
    if campaign_id:
        parts.append(f"campaign {campaign_id}")
    for key in ("action", "channel", "email", "first_name", "campaign_name"):
        val = str(payload.get(key) or "").strip()
        if val:
            parts.append(val)
    return " ".join(parts).strip() or "Hub autonomous task"


async def _unknown_intent_via_mas(request: dict[str, Any]) -> dict[str, Any]:
    """Unknown hub intent — route through Campaign Super → Domain → Executor."""
    from app.mas.runtime.invoke import mas_invoke

    payload = request.get("payload") if isinstance(request.get("payload"), dict) else {}
    intent = str(request.get("intent") or "").strip()
    query = _unknown_hub_query(request)
    out = await mas_invoke(
        {
            "entry": "hub",
            "skip_super": False,
            "query": query,
            "hub_skill": intent or None,
            "intent": intent,
            "token": request.get("token") or "",
            "organization_id": request.get("organization_id") or "",
            "session_id": payload.get("session_id") or "",
            "task_spec": {
                "hub_entry": True,
                "hub_skill": intent,
                "query": query,
                "intent": intent,
                "payload": payload,
                "organization_id": request.get("organization_id"),
            },
            "session": {},
        }
    )
    domain_result = (
        out.get("domain_result") if isinstance(out.get("domain_result"), dict) else out
    )
    ok = bool(out.get("ok") and domain_result.get("action_status") != "failed")
    return {
        "ok": ok,
        "mas": True,
        "message": out.get("message") or domain_result.get("message") or domain_result.get("reply"),
        "domain_id": out.get("domain_id") or domain_result.get("domain_id"),
        "raw": out,
    }


async def run_hub_task(raw: dict[str, Any] | None) -> dict[str, Any]:
    """
    Entry point for hub A2A tasks.

    - Validates envelope
    - Routes to sequential skill pipeline
    - Never returns needs_clarification
    """
    request = normalize_hub_request(raw)
    task_id = request["task_id"]
    correlation_id = request.get("correlation_id") or ""

    if request["validation_errors"]:
        return hub_task_result(
            task_id=task_id,
            correlation_id=correlation_id,
            status="failed",
            pipeline=[],
            step_results=[],
            errors=request["validation_errors"],
        )

    routed = route_pipeline(request)
    if not routed.get("ok"):
        mas_out = await _unknown_intent_via_mas(request)
        if mas_out.get("ok"):
            return hub_task_result(
                task_id=task_id,
                correlation_id=correlation_id,
                status="completed",
                pipeline=["mas_super"],
                step_results=[
                    {
                        "skill": "mas_super",
                        "status": "ok",
                        "data": {
                            k: v
                            for k, v in mas_out.items()
                            if k not in {"raw", "ok"}
                        },
                    }
                ],
                result={
                    "message": mas_out.get("message"),
                    "domain_id": mas_out.get("domain_id"),
                    "mas": True,
                },
                warnings=[],
                errors=[],
            )
        return hub_task_result(
            task_id=task_id,
            correlation_id=correlation_id,
            status="failed",
            pipeline=[],
            step_results=[],
            errors=list(routed.get("errors") or [])
            + (
                [{"code": "MAS_SUPER_FAILED", "message": mas_out.get("message") or "Super routing failed"}]
                if not mas_out.get("ok")
                else []
            ),
        )

    pipeline = list(routed.get("pipeline") or [])
    constraints = request.get("constraints") or {}
    allow_partial = bool(constraints.get("allow_partial"))

    executed = await run_sequential(
        pipeline=pipeline,
        token=request["token"],
        organization_id=request.get("organization_id") or "",
        intent=request.get("intent") or "",
        payload=request.get("payload") or {},
        allow_partial=allow_partial,
    )

    status = str(executed.get("status") or "failed")
    if executed.get("ok") and executed.get("warnings"):
        status = "partial" if allow_partial else "completed"

    return hub_task_result(
        task_id=task_id,
        correlation_id=correlation_id,
        status=status if executed.get("ok") else "failed",
        pipeline=pipeline,
        step_results=list(executed.get("step_results") or []),
        result=_aggregate_result(executed.get("prior") or {}, pipeline),
        warnings=list(executed.get("warnings") or []),
        errors=list(executed.get("errors") or []),
    )


__all__ = ["run_hub_task", "agent_card"]

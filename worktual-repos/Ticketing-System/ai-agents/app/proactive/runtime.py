"""Dispatch: event/schedule → named LLM agent → ASGA → rec/approval/tools."""

from __future__ import annotations

import logging
import os
import re
import threading
from typing import Any

from app.proactive.asga import gate
from app.proactive.contract import Proposal
from app.proactive.executor import execute_tool
from app.proactive.registry_agents import agents_for_event, harness_binding_for
from app.proactive.store import (
    already_audited_event,
    dedupe_hours_for_agent,
    get_approval,
    insert_approval,
    insert_recommendation,
    list_approvals,
    list_recommendations,
    mark_event_processed,
    pending_outbox,
    recent_actions_for_ticket,
    recent_similar_recommendation,
    recommendation_dedupe_key,
    set_approval_status,
    write_audit,
)

_worker_started = False
_stop = threading.Event()
_log = logging.getLogger(__name__)


def _clean_args(args: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in (args or {}).items() if k != "steal_assignment"}


def apply_decision(result, *, execute: bool = True) -> dict[str, Any]:
    p: Proposal = result.proposal
    write_audit(
        {
            "organization_id": p.organization_id,
            "agent_id": p.agent_id,
            "ticket_id": p.ticket_id,
            "event_id": p.event_id,
            "decision": result.decision,
            "reason": result.reason,
            "tool_name": p.tool_name,
            "payload": p.payload,
        }
    )
    if result.decision == "reject":
        return {"status": "rejected", "reason": result.reason, "agent_id": p.agent_id}
    if result.decision == "recommend":
        dedupe_key = recommendation_dedupe_key(p.summary or "", p.payload)
        dedupe_hours = dedupe_hours_for_agent(p.agent_id, p.event_type)
        if recent_similar_recommendation(
            p.organization_id,
            p.agent_id,
            p.summary or "",
            dedupe_key=dedupe_key,
            ticket_number=p.ticket_number,
            hours=dedupe_hours,
        ):
            return {
                "status": "skipped",
                "reason": "duplicate_recommendation",
                "agent_id": p.agent_id,
            }
        rec = insert_recommendation(
            {
                "organization_id": p.organization_id,
                "agent_id": p.agent_id,
                "ticket_id": p.ticket_id,
                "ticket_number": p.ticket_number,
                "summary": p.summary,
                "payload": {
                    **p.payload,
                    "dedupe_key": dedupe_key,
                    "reason": result.reason,
                },
            }
        )
        out: dict[str, Any] = {
            "status": "recommendation",
            "id": rec["id"],
            "agent_id": p.agent_id,
        }
        if p.agent_id == "dssa":
            out["summary"] = p.summary
            out["deflect"] = bool((p.payload or {}).get("deflect"))
            out["confidence"] = p.confidence
        return out
    if result.decision == "approve":
        # Defense: staff inbox pings must never sit in Approvals Confirm/Reject.
        agent = (p.agent_id or "").strip().lower()
        tool = (p.tool_name or "").strip()
        if agent == "pna" or tool == "send_staff_notification":
            tool_result = None
            if execute and tool:
                tool_result = execute_tool(
                    p.agent_id,
                    tool,
                    _clean_args(p.tool_args),
                    idempotency_key=p.event_id or None,
                )
                if _tool_failed(tool_result):
                    return {
                        "status": "failed",
                        "agent_id": p.agent_id,
                        "tool": tool,
                        "tool_result": tool_result,
                        "reason": "tool_failed",
                    }
            return {
                "status": "executed",
                "agent_id": p.agent_id,
                "tool": tool,
                "tool_result": tool_result,
                "reason": "inbox_notification_bypass",
            }
        item = insert_approval(
            {
                "organization_id": p.organization_id,
                "agent_id": p.agent_id,
                "ticket_id": p.ticket_id,
                "ticket_number": p.ticket_number,
                "summary": p.summary,
                "tool_name": p.tool_name,
                "tool_args": _clean_args(p.tool_args),
                "payload": p.payload,
            }
        )
        return {"status": "queued", "id": item["id"], "agent_id": p.agent_id}
    tool_result = None
    if execute and p.tool_name:
        tool_result = execute_tool(
            p.agent_id,
            p.tool_name,
            _clean_args(p.tool_args),
            idempotency_key=p.event_id or None,
        )
        if _tool_failed(tool_result):
            return {
                "status": "failed",
                "agent_id": p.agent_id,
                "tool": p.tool_name,
                "tool_result": tool_result,
                "reason": "tool_failed",
            }
    return {
        "status": "executed",
        "agent_id": p.agent_id,
        "tool": p.tool_name,
        "tool_result": tool_result,
    }


def handle_proposal(proposal: Proposal | None) -> dict[str, Any] | None:
    if proposal is None:
        return None
    binding = harness_binding_for(proposal.agent_id)
    if not binding:
        raise ValueError(f"unregistered proactive Harness agent: {proposal.agent_id}")
    from app.skills.catalog import load_skill_definition
    from app.workflow_schemas import task_definition_for

    task = task_definition_for(binding["task_id"])
    skill = load_skill_definition(binding["skill_name"])
    if not task or not task.active or not skill.active:
        raise ValueError(f"inactive proactive Harness binding: {proposal.agent_id}")
    proposal.payload = {
        **(proposal.payload or {}),
        "harness": {
            **binding,
            "task_version": task.version,
            "skill_version": skill.version,
            "approval_mode": "proactive_asga",
        },
    }
    result = gate(
        proposal,
        recent_count=recent_actions_for_ticket(proposal.agent_id, proposal.ticket_id or ""),
        already_handled=already_audited_event(
            proposal.agent_id,
            proposal.event_id or "",
            proposal.organization_id or "",
        ),
    )
    return apply_decision(result)


_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _org_actor_user_id(organization_id: str) -> str:
    org = (organization_id or "").strip()
    # Ticketing orgs are bigint ids (and legacy UUID orgs still match).
    if not org or not (org.isdigit() or _UUID_RE.match(org)):
        return ""
    try:
        from app.db import fetch_all

        rows = fetch_all(
            """
            SELECT ag.id::text AS id
              FROM ticketing.agents ag
             WHERE ag.organization_id = %s::bigint
               AND COALESCE(ag.status, 'Active') = 'Active'
             ORDER BY CASE lower(ag.role)
                        WHEN 'admin' THEN 0
                        WHEN 'agent' THEN 1
                        ELSE 2
                      END
             LIMIT 1
            """,
            (org,),
        )
        if rows and rows[0].get("id"):
            return str(rows[0]["id"])
    except Exception:
        return ""
    return ""


def _actor_for_event(event: dict[str, Any]):
    from app.tools.express_client import ToolActor

    org = str(event.get("organization_id") or "").strip()
    if not org:
        return None
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    user_id = str(event.get("actor") or payload.get("actor_id") or "").strip()
    if not user_id:
        user_id = _org_actor_user_id(org)
    if not user_id:
        return None
    role = str(payload.get("actor_role") or "admin").strip() or "admin"
    name = str(payload.get("actor_name") or "").strip() or None
    return ToolActor(
        user_id=user_id,
        organization_id=org,
        user_role=role,
        user_name=name,
    )


_LEAN_TRIAGE_DOMAIN = "triage_routing_domain"
_LEAN_RESOLUTION_DOMAIN = "resolution_lifecycle_domain"

# Ordered Domain plan for lean ticket.created (Super not involved).
_LEAN_TRIAGE_STEPS: tuple[dict[str, str], ...] = (
    {
        "executor_id": "classification_priority_executor",
        "task_id": "ticket.classify.prioritize",
        "skill_name": "ticket-classify-prioritize",
        "label": "classify/enrich",
    },
    {
        "executor_id": "intelligent_assignment_executor",
        "task_id": "ticket.assign.best",
        "skill_name": "ticket-assign-best",
        "label": "assign L1/L2",
    },
)

# Create-time resolution Domain only (summary then notify).
_LEAN_RESOLUTION_STEPS: tuple[dict[str, str], ...] = (
    {
        "executor_id": "investigation_summary_executor",
        "task_id": "ticket.investigation.summary",
        "skill_name": "ticket-investigation-summary",
        "label": "investigation summary",
    },
    {
        "executor_id": "personalized_notification_executor",
        "task_id": "notification.personalize.deliver",
        "skill_name": "notification-personalize-deliver",
        "label": "personalized notify",
    },
)


def _first_tool_call(result: dict[str, Any], name: str) -> dict[str, Any] | None:
    for call in result.get("tool_calls") or []:
        if str(call.get("name") or "") == name:
            arguments = call.get("arguments")
            return dict(arguments) if isinstance(arguments, dict) else {}
    return None


def _lean_ticket_facts(event: dict[str, Any]) -> str:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    org = str(event.get("organization_id") or "").strip()
    tn = str(
        event.get("ticket_number") or payload.get("ticket_number") or ""
    ).strip()
    subject = str(payload.get("subject") or "").strip()
    description = str(payload.get("description") or "").strip()
    return (
        "Proactive lean ticket.created — Super Agent is not involved.\n"
        f"organization_id={org}\n"
        f"ticket_number={tn}\n"
        f"subject={subject or '(none)'}\n"
        f"description={description or '(none)'}\n"
        f"domain_triage_owned={bool(payload.get('domain_triage_owned'))}\n"
        f"triage_complete={payload.get('triage_complete')!r}\n"
    )


def _lean_domain_context(event: dict[str, Any]) -> str:
    return (
        _lean_ticket_facts(event)
        + "You own post-insert triage for triage_routing_domain.\n"
        "Required plan order: (1) classify/enrich via classification_priority_executor "
        "/ ticket-classify-prioritize / ticket.classify.prioritize, then "
        "(2) assign via intelligent_assignment_executor / ticket-assign-best / "
        "ticket.assign.best.\n"
        "Do not call workload or learning executors on this path.\n"
        "On each turn call delegate_to_executor exactly once for the next required step."
    )


def _lean_resolution_context(event: dict[str, Any]) -> str:
    return (
        _lean_ticket_facts(event)
        + "Triage (classify + assign) already completed for this ticket.\n"
        "You own post-insert resolution_lifecycle_domain create-time work.\n"
        "Required plan order: (1) investigation summary via "
        "investigation_summary_executor / ticket-investigation-summary / "
        "ticket.investigation.summary, then (2) personalized notify via "
        "personalized_notification_executor / notification-personalize-deliver / "
        "notification.personalize.deliver.\n"
        "Do not delegate SLA, reply-draft, autonomous resolution, resolution "
        "quality, ticket lifecycle CRUD, or analytics on this create path.\n"
        "On each turn call delegate_to_executor exactly once for the next required step."
    )


def _executor_rows_for_domain(domain_id: str) -> list[dict[str, Any]]:
    from app.runtime.supervisor import executors_for_domain
    from app.skills.catalog import skills_for_executor

    rows: list[dict[str, Any]] = []
    for executor_id in executors_for_domain(domain_id):
        for skill in skills_for_executor(executor_id):
            rows.append(
                {
                    "executor_id": executor_id,
                    "skill_name": skill.name,
                    "description": skill.description,
                    "task_ids": list(skill.task_ids or []),
                }
            )
    return rows


def _domain_delegate_once(
    messages: list[dict[str, Any]],
    *,
    domain_id: str = _LEAN_TRIAGE_DOMAIN,
) -> dict[str, Any] | None:
    """Ask Domain LLM for one delegate_to_executor; None on refuse/failure."""
    import json

    from app.contracts.tools import ToolDefinition
    from app.llm import get_llm
    from app.mcp.catalog import delegate_to_executor_tool
    from app.prompts.builder import load_agent_definition

    refuse = ToolDefinition(
        name="refuse_capability",
        description=(
            "Return a typed capability refusal when the request is unsupported."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "code": {"type": "string"},
                "message": {"type": "string"},
            },
            "required": ["code", "message"],
        },
        kind="route",
        risk="low",
    )
    try:
        domain_manifest = load_agent_definition(domain_id)
        domain_prompt = (
            domain_manifest.prompt
            + "\n\n## Eligible Executor and Skill summaries\n"
            + json.dumps(_executor_rows_for_domain(domain_id), ensure_ascii=False)
            + "\nCall delegate_to_executor exactly once for the next required step. "
            "Do not refuse lean post-insert work owned by this Domain."
        )
        full_messages = [{"role": "system", "content": domain_prompt}, *messages]
        tools = [
            delegate_to_executor_tool(domain_id).to_openai_tool(),
            refuse.to_openai_tool(),
        ]
        result = get_llm().run(full_messages, tools=tools)
    except Exception:  # noqa: BLE001
        return None
    if _first_tool_call(result, "refuse_capability") is not None:
        return None
    return _first_tool_call(result, "delegate_to_executor")


def _validate_lean_delegate(
    delegate: dict[str, Any] | None,
    expected: dict[str, str],
    *,
    domain_id: str = _LEAN_TRIAGE_DOMAIN,
) -> bool:
    if not isinstance(delegate, dict):
        return False
    from app.workflow_schemas import task_definition_for

    executor_id = str(delegate.get("executor_id") or "").strip()
    skill_name = str(delegate.get("skill_name") or "").strip()
    task_id = str(delegate.get("task_id") or "").strip()
    if executor_id != expected["executor_id"]:
        return False
    if skill_name and skill_name != expected["skill_name"]:
        return False
    if task_id and task_id != expected["task_id"]:
        task = task_definition_for(task_id)
        if (
            not task
            or task.domain != domain_id
            or task.executor != expected["executor_id"]
            or task.skill_name != expected["skill_name"]
        ):
            return False
    return True


def _propose_for_lean_executor(executor_id: str):
    from app.proactive import icpa, itra, pna, tsaa

    if executor_id == "classification_priority_executor":
        return icpa.propose
    if executor_id == "intelligent_assignment_executor":
        return itra.propose
    if executor_id == "investigation_summary_executor":
        return tsaa.propose
    if executor_id == "personalized_notification_executor":
        return pna.propose
    return None


def _run_ordered_domain_plan(
    event: dict[str, Any],
    *,
    run_proposal_pipeline,
    domain_id: str,
    steps: tuple[dict[str, str], ...],
    context: str,
    banner: str,
) -> list[dict[str, Any]]:
    """Domain LLM plans ordered create-time steps via delegate_to_executor."""
    results: list[dict[str, Any]] = []
    step_trace: list[dict[str, Any]] = []
    completed_notes: list[str] = []
    tn = str(
        event.get("ticket_number")
        or (event.get("payload") or {}).get("ticket_number")
        or ""
    )
    org = str(event.get("organization_id") or "").strip()
    _log.info(
        "lean domain plan start domain=%s ticket=%s steps=%s",
        domain_id,
        tn,
        [s["executor_id"] for s in steps],
    )

    def _emit_visible_trace() -> None:
        try:
            from app.observability.turn_log import log_proactive_domain_triage

            log_proactive_domain_triage(
                ticket_number=tn,
                organization_id=org,
                event_type=str(event.get("event_type") or "ticket.created"),
                domain_id=domain_id,
                steps=step_trace,
                title=banner,
            )
        except Exception:  # noqa: BLE001
            pass

    def _fallback(from_step: int) -> list[dict[str, Any]]:
        outs: list[dict[str, Any]] = []
        _log.info(
            "lean domain fallback domain=%s from_step=%s ticket=%s via=domain-fallback",
            domain_id,
            from_step,
            tn,
        )
        for step in steps[from_step:]:
            propose = _propose_for_lean_executor(step["executor_id"])
            if propose is None:
                continue
            out = run_proposal_pipeline(propose(event))
            if out:
                if isinstance(out, dict):
                    out = {**out, "via": "domain-fallback"}
                outs.append(out)
        return outs

    for idx, step in enumerate(steps):
        user = (
            context
            + "\n\nCompleted steps:\n"
            + ("\n".join(completed_notes) if completed_notes else "(none)")
            + f"\n\nNext required step: {step['label']} "
            f"(executor={step['executor_id']}, skill={step['skill_name']}, "
            f"task={step['task_id']}). "
            "Call delegate_to_executor for that Executor/Skill/task now."
        )
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        delegate = _domain_delegate_once(messages, domain_id=domain_id)
        if not _validate_lean_delegate(delegate, step, domain_id=domain_id):
            retry_user = (
                f"Previous delegation was invalid or missing. "
                f"Call delegate_to_executor now with executor_id="
                f"{step['executor_id']}, skill_name={step['skill_name']}, "
                f"task_id={step['task_id']}."
            )
            messages = [
                {"role": "user", "content": user},
                {
                    "role": "assistant",
                    "content": "Need a valid delegate_to_executor for the next step.",
                },
                {"role": "user", "content": retry_user},
            ]
            delegate = _domain_delegate_once(messages, domain_id=domain_id)
        if not _validate_lean_delegate(delegate, step, domain_id=domain_id):
            fallback_outs = _fallback(idx)
            results.extend(fallback_outs)
            for j, fout in enumerate(fallback_outs):
                rem = steps[idx + j] if idx + j < len(steps) else None
                step_trace.append(
                    {
                        "executor_id": (rem or {}).get("executor_id"),
                        "skill_name": (rem or {}).get("skill_name"),
                        "task_id": (rem or {}).get("task_id"),
                        "agent_id": fout.get("agent_id") if isinstance(fout, dict) else None,
                        "status": fout.get("status") if isinstance(fout, dict) else None,
                        "via": "domain-fallback",
                    }
                )
            _emit_visible_trace()
            return results

        via = "domain-delegate"
        propose = _propose_for_lean_executor(step["executor_id"])
        if propose is None:
            fallback_outs = _fallback(idx)
            results.extend(fallback_outs)
            for j, fout in enumerate(fallback_outs):
                rem = steps[idx + j] if idx + j < len(steps) else None
                step_trace.append(
                    {
                        "executor_id": (rem or {}).get("executor_id"),
                        "skill_name": (rem or {}).get("skill_name"),
                        "task_id": (rem or {}).get("task_id"),
                        "agent_id": fout.get("agent_id") if isinstance(fout, dict) else None,
                        "status": fout.get("status") if isinstance(fout, dict) else None,
                        "via": "domain-fallback",
                    }
                )
            _emit_visible_trace()
            return results
        out = run_proposal_pipeline(propose(event))
        if out:
            if isinstance(out, dict):
                out = {
                    **out,
                    "via": via,
                    "domain_id": domain_id,
                    "executor_id": step["executor_id"],
                }
            results.append(out)
            status = str(out.get("status") or "done") if isinstance(out, dict) else "done"
            agent_id = out.get("agent_id") if isinstance(out, dict) else None
        else:
            status = "no_output"
            agent_id = None
        step_trace.append(
            {
                "executor_id": step["executor_id"],
                "skill_name": step["skill_name"],
                "task_id": step["task_id"],
                "agent_id": agent_id,
                "status": status,
                "via": via,
            }
        )
        completed_notes.append(
            f"- {step['label']} via {step['executor_id']}: {status}"
        )
    _emit_visible_trace()
    return results


def _run_lean_domain_triage(
    event: dict[str, Any],
    *,
    run_proposal_pipeline,
) -> list[dict[str, Any]]:
    """Triage Domain LLM: classify then assign."""
    return _run_ordered_domain_plan(
        event,
        run_proposal_pipeline=run_proposal_pipeline,
        domain_id=_LEAN_TRIAGE_DOMAIN,
        steps=_LEAN_TRIAGE_STEPS,
        context=_lean_domain_context(event),
        banner="PROACTIVE DOMAIN TRIAGE  (post-insert — Super Agent not involved)",
    )


def _run_lean_domain_resolution(
    event: dict[str, Any],
    *,
    run_proposal_pipeline,
) -> list[dict[str, Any]]:
    """Resolution Domain LLM: summary then notify (create-time only)."""
    return _run_ordered_domain_plan(
        event,
        run_proposal_pipeline=run_proposal_pipeline,
        domain_id=_LEAN_RESOLUTION_DOMAIN,
        steps=_LEAN_RESOLUTION_STEPS,
        context=_lean_resolution_context(event),
        banner=(
            "PROACTIVE DOMAIN RESOLUTION  "
            "(post-triage create-time — Super Agent not involved)"
        ),
    )


def _dispatch_event_body(event: dict[str, Any]) -> list[dict[str, Any]]:
    et = str(event.get("event_type") or "")
    results: list[dict[str, Any]] = []
    from app.proactive.native_pipeline import run_proposal_pipeline

    if et == "inbound.message":
        from app.proactive import dssa, tcaa
        from app.proactive.dssa import SPEC as DSSA_SPEC

        dssa_proposal = dssa.propose(event)
        dssa_out = run_proposal_pipeline(dssa_proposal)
        if dssa_out:
            results.append(dssa_out)
        deflect = bool(
            dssa_proposal
            and dssa_proposal.confidence >= DSSA_SPEC.confidence_threshold
            and bool((dssa_proposal.payload or {}).get("deflect"))
        )
        if not deflect:
            tcaa_out = run_proposal_pipeline(tcaa.propose(event))
            if tcaa_out:
                results.append(tcaa_out)
        return results

    # Lean create: triage Domain (classify→assign) then resolution Domain
    # (summary→notify). Super not involved. Suppresses duplicate fan-out.
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    domain_triage = et == "ticket.created" and (
        bool(payload.get("domain_triage_owned"))
        or (
            payload.get("triage_complete") is False
            and not payload.get("harness_triage_complete")
        )
    )
    if domain_triage:
        results.extend(
            _run_lean_domain_triage(
                event, run_proposal_pipeline=run_proposal_pipeline
            )
        )
        # Resolution Domain LLM: summary then notify (Super not involved).
        results.extend(
            _run_lean_domain_resolution(
                event, run_proposal_pipeline=run_proposal_pipeline
            )
        )
        for agent_id, propose in agents_for_event(et):
            # Domain plans already ran ICPA/ITRA/TSAA/PNA — skip duplicates.
            if agent_id in {"icpa", "itra", "tsaa", "pna"}:
                continue
            out = run_proposal_pipeline(propose(event))
            if out:
                results.append(out)
        return results

    for _agent_id, propose in agents_for_event(et):
        if et == "inbound.message":
            continue
        out = run_proposal_pipeline(propose(event))
        if out:
            results.append(out)
    return results


def dispatch_event(event: dict[str, Any]) -> list[dict[str, Any]]:
    eid = str(event.get("id") or event.get("event_id") or "")
    if eid and not mark_event_processed(eid, str(event.get("organization_id") or "")):
        return [{"status": "skipped", "reason": "idempotent"}]
    from app.tools.express_client import tool_actor_scope

    actor = _actor_for_event(event)
    if actor is None:
        return _dispatch_event_body(event)
    with tool_actor_scope(actor):
        return _dispatch_event_body(event)


def _parse_tool_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        import json

        try:
            parsed = json.loads(raw)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _tool_failed(result: Any) -> bool:
    return isinstance(result, dict) and result.get("success") is False


def confirm_approval(
    organization_id: str,
    approval_id: str,
    *,
    accept: bool,
    actor_id: str | None = None,
    actor_role: str | None = None,
    actor_name: str | None = None,
    tool_args_override: dict[str, Any] | None = None,
    edited_text: str | None = None,
) -> dict[str, Any]:
    item = get_approval(organization_id, approval_id)
    if not item:
        return {"ok": False, "error": "not_found"}
    if item.get("status") != "pending":
        return {"ok": False, "error": "already_decided"}
    if not accept:
        set_approval_status(organization_id, approval_id, "rejected")
        return {"ok": True, "status": "rejected"}
    tool = item.get("tool_name")
    args = _parse_tool_args(item.get("tool_args"))
    if isinstance(tool_args_override, dict) and tool_args_override:
        args = {**args, **{k: v for k, v in tool_args_override.items() if v is not None}}
    edited = str(edited_text or "").strip()
    if edited:
        args["text"] = edited
        if "body" in args:
            args["body"] = edited
    result = None
    if tool:
        from app.tools.express_client import tool_actor_scope

        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        if isinstance(payload, str):
            import json

            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = {}
        if not isinstance(payload, dict):
            payload = {}
        confirm_payload = {
            **payload,
            "actor_id": (actor_id or payload.get("actor_id") or "").strip() or None,
            "actor_role": (actor_role or payload.get("actor_role") or "admin").strip()
            or "admin",
            "actor_name": (actor_name or payload.get("actor_name") or "").strip() or None,
        }
        actor = _actor_for_event(
            {
                "organization_id": organization_id,
                "actor": actor_id or item.get("actor"),
                "payload": confirm_payload,
            }
        )
        if actor is None:
            # Stale PNA Approvals drain may lack an actor; still deliver + clear.
            if str(tool) == "send_staff_notification":
                result = execute_tool(
                    str(item["agent_id"]),
                    str(tool),
                    dict(args),
                    idempotency_key=str(item.get("id") or "") or None,
                )
                set_approval_status(organization_id, approval_id, "approved")
                return {"ok": True, "status": "approved", "tool_result": result}
            return {
                "ok": False,
                "error": "no_actor",
                "detail": "Confirm needs an admin actor to run ticket tools.",
            }
        with tool_actor_scope(actor):
            result = execute_tool(
                str(item["agent_id"]),
                str(tool),
                dict(args),
                idempotency_key=str(item.get("id") or "") or None,
            )
        if _tool_failed(result):
            err = ""
            if isinstance(result, dict):
                payload_err = result.get("payload")
                nested = (
                    payload_err.get("error")
                    if isinstance(payload_err, dict)
                    else None
                )
                err = str(
                    result.get("message")
                    or result.get("error")
                    or nested
                    or ""
                )
            return {
                "ok": False,
                "error": "tool_failed",
                "detail": err or "Tool failed",
                "tool_result": result,
            }
    set_approval_status(organization_id, approval_id, "approved")
    return {"ok": True, "status": "approved", "tool_result": result}


def _is_inbox_approval_row(item: dict[str, Any]) -> bool:
    agent = str(item.get("agent_id") or "").strip().lower()
    tool = str(item.get("tool_name") or "").strip()
    return agent == "pna" or tool == "send_staff_notification"


def list_org_approvals(organization_id: str) -> list[dict[str, Any]]:
    """Pending high-risk actions only. Auto-deliver stale PNA rows to the bell inbox."""
    items = list_approvals(organization_id)
    kept: list[dict[str, Any]] = []
    for item in items:
        if not _is_inbox_approval_row(item):
            kept.append(item)
            continue
        approval_id = str(item.get("id") or "")
        if not approval_id:
            continue
        try:
            confirm_approval(organization_id, approval_id, accept=True)
        except Exception:
            try:
                set_approval_status(organization_id, approval_id, "approved")
            except Exception:
                pass
    return kept


def list_org_recommendations(
    organization_id: str, ticket_number: str | None = None
) -> list[dict[str, Any]]:
    items = list_recommendations(organization_id, ticket_number=ticket_number)
    return [
        r
        for r in items
        if str(r.get("agent_id") or "").strip().lower() != "tsaa"
    ]


def poll_outbox_once() -> int:
    n = 0
    for row in pending_outbox():
        event = {
            "id": row.get("id"),
            "organization_id": row.get("organization_id"),
            "event_type": row.get("event_type"),
            "ticket_id": row.get("ticket_id"),
            "ticket_number": row.get("ticket_number"),
            "payload": row.get("payload") or {},
        }
        if isinstance(event["payload"], str):
            import json

            try:
                event["payload"] = json.loads(event["payload"])
            except json.JSONDecodeError:
                event["payload"] = {}
        dispatch_event(event)
        n += 1
    return n


def _org_ids_for_schedule() -> list[str]:
    if os.getenv("PROACTIVE_VIA_API", "1").strip().lower() not in {"0", "false", "no", "off"}:
        try:
            from app.proactive.proactive_api_client import api_list_organizations

            return api_list_organizations()
        except Exception:
            pass
    try:
        from app.db import fetch_all

        rows = fetch_all(
            """
            SELECT organization_id::text AS id
              FROM ticketing.org_settings
             ORDER BY organization_id
             LIMIT 50
            """
        )
        return [r["id"] for r in rows if r.get("id")]
    except Exception:
        return []


def run_schedule(kind: str) -> list[dict[str, Any]]:
    outs: list[dict[str, Any]] = []
    for org in _org_ids_for_schedule():
        outs.extend(
            dispatch_event(
                {
                    "event_type": f"schedule.{kind}",
                    "organization_id": org,
                    "payload": {},
                }
            )
        )
    return outs


def _worker_loop() -> None:
    ticks = 0
    while not _stop.wait(15):
        try:
            poll_outbox_once()
            ticks += 1
            if ticks % 4 == 0:
                run_schedule("sema")
            if ticks % 20 == 0:
                run_schedule("wloa")
            if ticks % 40 == 0:
                run_schedule("tiaa")
            if ticks % 240 == 0:
                run_schedule("rcaa")
        except Exception:
            continue


def start_worker() -> None:
    global _worker_started
    if _worker_started:
        return
    if os.getenv("PYTEST_CURRENT_TEST"):
        return
    if os.getenv("PROACTIVE_WORKER", "1").strip() in {"0", "false", "no"}:
        return
    _worker_started = True
    threading.Thread(target=_worker_loop, name="proactive-worker", daemon=True).start()

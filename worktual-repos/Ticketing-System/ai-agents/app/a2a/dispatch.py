"""Route Hub skillId → existing MAS (coworker / proactive / super-agent)."""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.a2a.access_token import new_task_id
from app.a2a.catalog import (
    PROACTIVE_HUB_EVENT_AGENT,
    is_coworker_skill,
    is_hub_card_skill,
    is_proactive_skill,
    is_super_agent,
    resolve_hub_skill,
)
from app.a2a.log import log_event
from app.a2a.payload import (
    PayloadError,
    focused_entity_from_cdp,
    instruction_text,
    parse_hub_payload,
)
from app.a2a.store import insert_task
from app.contracts.execution import ActorContext, RunBudgets, RunRequest
from app.mcp.authorization import issue_mcp_token
from app.tools.express_client import ToolActor, tool_actor_scope

COWORKER_SKILL_IDS = frozenset(
    {"tickets", "customers", "teams", "kb", "macros", "admin", "general"}
)


def _hub_actor(client_id: str, organization_id: str) -> ToolActor:
    cid = str(client_id or "hub").strip() or "hub"
    return ToolActor(
        user_id=f"hub:{cid}",
        organization_id=str(organization_id),
        user_role="admin",
        user_name="Hub",
    )


def _hub_message_for_skill(*, advertised_skill: str, message: str) -> str:
    text = str(message or "").strip()
    adv = str(advertised_skill or "").strip()
    if adv.startswith("tk.") and text:
        return f"[Hub skill: {adv}] {text}"
    if adv.startswith("tk.") and not text:
        return f"Execute Hub skill {adv}."
    return text


def _run_coworker_hub(
    *,
    skill_id: str,
    organization_id: str,
    message: str,
    cdp_id: str | None,
    channel: str,
    client_id: str,
    advertised_skill: str | None = None,
    coworker_agent: str | None = None,
    module: str | None = None,
    start_super: bool = False,
    task_id: str | None = None,
    executor_id: str | None = None,
    skill_name: str | None = None,
    skill_version: str | None = None,
    harness_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.runtime.orchestrator import run_native_turn

    actor = _hub_actor(client_id, organization_id)
    agent = str(coworker_agent or skill_id or "general").strip().lower()
    adv = str(advertised_skill or skill_id or "").strip()
    start_agent = "ticketing_coworker" if (start_super or task_id) else agent
    if task_id and executor_id and skill_name:
        from app.skills.catalog import tools_for_skill

        allowed = sorted(tools_for_skill(skill_name, executor_id))
    else:
        allowed = []
    run_id = str(uuid.uuid4())
    mod = module if module in COWORKER_SKILL_IDS else None
    mcp_token = issue_mcp_token(
        organization_id=organization_id,
        actor_id=actor.user_id,
        role="admin",
        module=mod,
        run_id=run_id,
        allowed_tools=allowed,
        agent_id=executor_id,
        task_id=task_id,
        skill_name=skill_name,
        skill_version=skill_version,
        route_mode="trusted_structured" if task_id else "delegation",
        ttl_seconds=600,
    )
    hub_message = _hub_message_for_skill(advertised_skill=adv, message=message)
    request = RunRequest(
        message=hub_message,
        run_id=run_id,
        request_id=str(uuid.uuid4()),
        session_id=f"hub:{client_id}:{uuid.uuid4()}",
        actor=ActorContext(
            user_id=actor.user_id,
            organization_id=organization_id,
            user_role="admin",
            user_name="Hub",
        ),
        module=mod,
        channel=channel,
        focused_entity=focused_entity_from_cdp(cdp_id),
        session_memory={
            "source": "hub",
            "hubExecute": True,
            "hubSkillId": adv,
            "start_agent": start_agent,
            "harnessTaskId": task_id,
            "harnessFields": dict(harness_fields or {}),
            "trustedStructured": bool(task_id),
            "idempotencyKey": run_id,
        },
        mcp_token=mcp_token,
        budgets=RunBudgets(deadline_ms=120_000),
    )
    with tool_actor_scope(actor):
        result = run_native_turn(request)
    envelope = result.to_agent_turn_envelope()
    proposals = list(envelope.get("toolProposals") or [])
    return {
        "kind": "coworker",
        "skill_id": adv,
        "agent": result.agent,
        "assistant_text": envelope.get("assistantText") or result.assistant_text,
        "tool_proposals": proposals,
        "auto_executed": [],
        "error": result.error.model_dump() if result.error else None,
    }


def _run_proactive_hub_event(
    *,
    organization_id: str,
    instruction: Any,
    cdp_id: str | None,
    client_id: str,
    advertised_skill: str,
) -> dict[str, Any]:
    """tk.proactive.run — Hub supplies eventType (+ optional agentId) in instruction."""
    from app.proactive.registry_agents import AGENTS
    from app.proactive.runtime import dispatch_event

    text = instruction_text(instruction)
    instr_dict = instruction if isinstance(instruction, dict) else {}
    event_type = str(
        instr_dict.get("eventType") or instr_dict.get("event_type") or ""
    ).strip()
    agent_id = str(
        instr_dict.get("agentId") or instr_dict.get("agent_id") or ""
    ).strip().lower()

    if agent_id and agent_id in AGENTS:
        event_type = event_type or f"hub.{agent_id}"
    elif not event_type:
        return {
            "kind": "proactive",
            "skill_id": advertised_skill,
            "status": "input-required",
            "message": "instruction.eventType or instruction.agentId is required for tk.proactive.run",
            "missing": ["eventType"],
        }

    event: dict[str, Any] = {
        "organization_id": organization_id,
        "event_type": event_type,
        "payload": {
            **instr_dict,
            "cdp_id": cdp_id,
            "text": text or instr_dict.get("text") or "",
            "body": text or instr_dict.get("body") or "",
        },
    }
    if instr_dict.get("ticket_number"):
        event["ticket_number"] = instr_dict["ticket_number"]
    if instr_dict.get("ticket_id"):
        event["ticket_id"] = instr_dict["ticket_id"]

    actor = _hub_actor(client_id, organization_id)
    with tool_actor_scope(actor):
        if agent_id and agent_id in AGENTS:
            from app.proactive.native_pipeline import run_proposal_pipeline

            mod = AGENTS[agent_id]
            proposal = mod.propose(event) if hasattr(mod, "propose") else None
            outcomes = [run_proposal_pipeline(proposal)] if proposal else []
            outcomes = [o for o in outcomes if o]
        else:
            outcomes = dispatch_event(event)

    return {
        "kind": "proactive",
        "skill_id": advertised_skill,
        "event_type": event_type,
        "agent_id": agent_id or None,
        "outcomes": outcomes,
        "status": "executed" if outcomes else "input-required",
    }


def _run_proactive_hub(
    *,
    skill_id: str,
    organization_id: str,
    instruction: Any,
    cdp_id: str | None,
    client_id: str,
    advertised_skill: str | None = None,
    proactive_agent: str | None = None,
    default_event_type: str | None = None,
) -> dict[str, Any]:
    from app.proactive.registry_agents import AGENTS
    from app.proactive.native_pipeline import run_proposal_pipeline

    agent_id = str(proactive_agent or skill_id or "").strip().lower()
    adv = str(advertised_skill or skill_id or "").strip()
    mod = AGENTS.get(agent_id)
    if not mod or not hasattr(mod, "propose"):
        return {"kind": "proactive", "error": f"Unknown proactive agent {agent_id}"}

    text = instruction_text(instruction)
    instr_dict = instruction if isinstance(instruction, dict) else {}
    event = {
        "organization_id": organization_id,
        "event_type": str(
            instr_dict.get("eventType") or default_event_type or f"hub.{agent_id}"
        ),
        "payload": {
            **instr_dict,
            "cdp_id": cdp_id,
            "text": text or instr_dict.get("text") or "",
            "body": text or instr_dict.get("body") or "",
        },
    }
    if instr_dict.get("ticket_number"):
        event["ticket_number"] = instr_dict["ticket_number"]
    if instr_dict.get("ticket_id"):
        event["ticket_id"] = instr_dict["ticket_id"]

    actor = _hub_actor(client_id, organization_id)
    with tool_actor_scope(actor):
        proposal = mod.propose(event)
        if proposal is None:
            return {
                "kind": "proactive",
                "skill_id": adv,
                "status": "input-required",
                "message": "Agent could not derive an action from the instruction",
            }
        outcome = run_proposal_pipeline(proposal)
        return {
            "kind": "proactive",
            "skill_id": adv,
            "agent_id": proposal.agent_id,
            "summary": proposal.summary,
            "outcome": outcome,
            "status": str((outcome or {}).get("status") or "input-required"),
        }


def dispatch_hub_message(
    *,
    flat_payload: dict[str, Any],
    client_id: str,
    message_id: str,
) -> dict[str, Any]:
    parsed = parse_hub_payload(flat_payload)
    skill_id = parsed["skill_id"]
    org = parsed["organization_id"]
    cdp_id = parsed.get("cdp_id")
    channel = parsed.get("channel") or "chat"
    message = instruction_text(parsed.get("instruction"))
    if not is_hub_card_skill(skill_id):
        return {"status": "error", "message": f"Unknown skillId: {skill_id}"}
    if not message and not is_proactive_skill(skill_id):
        return {
            "status": "input-required",
            "message": "instruction is required for coworker skills",
            "missing": ["instruction"],
        }

    log_event(
        "invoke",
        ok=True,
        hub={
            "skillId": skill_id,
            "organizationId": org,
            "cdpId": cdp_id,
            "messageId": message_id,
            "client_id": client_id,
        },
    )

    target = resolve_hub_skill(skill_id)
    if target is None:
        return {"status": "error", "message": f"Unknown skillId: {skill_id}"}
    instruction = parsed.get("instruction")
    instruction_data = instruction if isinstance(instruction, dict) else {}
    requested_task_version = str(
        instruction_data.get("taskVersion")
        or instruction_data.get("task_version")
        or ""
    ).strip()
    requested_skill_version = str(
        instruction_data.get("skillVersion")
        or instruction_data.get("skill_version")
        or ""
    ).strip()
    if (
        target.task_version
        and requested_task_version
        and requested_task_version != target.task_version
    ):
        return {
            "status": "input-required",
            "message": "stale task version",
            "expectedTaskVersion": target.task_version,
        }
    if (
        target.skill_version
        and requested_skill_version
        and requested_skill_version != target.skill_version
    ):
        return {
            "status": "input-required",
            "message": "stale Skill version",
            "expectedSkillVersion": target.skill_version,
        }

    if target.kind == "proactive":
        if target.agent_id == PROACTIVE_HUB_EVENT_AGENT:
            body = _run_proactive_hub_event(
                organization_id=org,
                instruction=parsed.get("instruction"),
                cdp_id=cdp_id,
                client_id=client_id,
                advertised_skill=target.advertised_id or skill_id,
            )
        else:
            body = _run_proactive_hub(
                skill_id=target.agent_id,
                organization_id=org,
                instruction=parsed.get("instruction"),
                cdp_id=cdp_id,
                client_id=client_id,
                advertised_skill=target.advertised_id or skill_id,
                proactive_agent=target.agent_id,
                default_event_type=target.default_event_type,
            )
    elif target.kind in {"coworker", "super"}:
        body = _run_coworker_hub(
            skill_id=target.agent_id,
            organization_id=org,
            message=message or f"Execute hub task for skill {skill_id}",
            cdp_id=cdp_id,
            channel=channel,
            client_id=client_id,
            advertised_skill=target.advertised_id or skill_id,
            coworker_agent=target.agent_id if target.kind == "coworker" else None,
            module=target.module,
            start_super=target.kind == "super",
            task_id=target.task_id,
            executor_id=target.executor,
            skill_name=target.skill_name,
            skill_version=target.skill_version,
            harness_fields=instruction_data,
        )
    else:
        return {"status": "error", "message": f"Unknown skillId: {skill_id}"}

    task_id = new_task_id()
    status = str(body.get("status") or "completed")
    if body.get("error"):
        status = "failed"
    elif body.get("status") == "input-required":
        status = "input-required"

    insert_task(
        organization_id=org,
        task_id=task_id,
        message_id=message_id,
        skill_id=skill_id,
        cdp_id=cdp_id,
        client_id=client_id,
        status=status,
        request_json=parsed.get("raw") or flat_payload,
        response_json=body,
    )

    log_event(
        "receipt",
        ok=status not in ("failed", "error"),
        hub={"skillId": skill_id, "messageId": message_id, "client_id": client_id},
        ticketing={"task_id": task_id, "status": status, "skill_id": skill_id},
    )

    receipt_text = (
        body.get("assistant_text")
        or body.get("summary")
        or body.get("message")
        or json.dumps(body, default=str)[:2000]
    )
    return {
        "id": task_id,
        "status": {"state": status},
        "artifacts": [
            {
                "artifactId": task_id,
                "parts": [
                    {"kind": "text", "text": str(receipt_text or "")[:8000]},
                    {"kind": "data", "data": body},
                ],
            }
        ],
    }


def dispatch_from_message(
    message: dict[str, Any] | None,
    *,
    client_id: str,
) -> dict[str, Any]:
    from app.a2a.payload import flatten_message_parts

    try:
        flat = flatten_message_parts(message)
    except PayloadError as exc:
        return {
            "status": "input-required",
            "message": exc.message,
            "missing": exc.missing,
        }
    message_id = str((message or {}).get("messageId") or uuid.uuid4())
    try:
        return dispatch_hub_message(
            flat_payload=flat,
            client_id=client_id,
            message_id=message_id,
        )
    except PayloadError as exc:
        return {
            "status": "input-required",
            "message": exc.message,
            "missing": exc.missing,
        }

"""Deterministic Hub skill → existing get_agent dispatch."""

from __future__ import annotations

import inspect
import re
import uuid
from typing import Any, Callable, Mapping

from app.a2a.catalog import SpokeSkill, get_spoke_skill
from app.a2a.errors import InputRequiredError, SpokeRejectError, receipt
from app.a2a.log import hub_instruction, log_a2a
from app.a2a.mcp_token import issue_hub_mcp_token
from app.a2a.org import assert_skill_allowed, resolve_business_type
from app.a2a.hydrate import hydrate_hub_payload
from app.a2a.orchestrate import run_hub_supervised_task
from app.a2a.payload import (
    hub_activity_draft,
    hub_execute_text,
    lookup,
    normalize_payload,
    require_organization,
    resolve_skill_id,
)

HIGH_RISK_PREFIXES = ("propose_delete", "propose_merge", "propose_send", "propose_mark")
_HUB_FOLLOW_UP = (
    r"\b(what would you like|what do you want|who is this|shall i save|"
    r"which contact|could you (clarify|confirm)|what type|how can i help)\b"
)


def _is_high_risk(tool: Mapping[str, Any]) -> bool:
    if str(tool.get("risk") or "").lower() == "high":
        return True
    name = str(tool.get("name") or "")
    return name.startswith(HIGH_RISK_PREFIXES) or name.startswith("propose_")


def _hub_surface(skill: SpokeSkill, payload: Mapping[str, Any]) -> str:
    explicit = str(payload.get("surface") or "").strip().lower()
    if explicit in {"create", "detail"}:
        return explicit
    module = skill.coworker_module or ""
    if module == "activities":
        return "detail" if lookup(payload, "activity_id") else "create"
    if module == "sales":
        return "detail" if lookup(payload, "deal_id") else "create"
    if module in {"quotes", "proposal"}:
        return "detail" if lookup(payload, "deal_id") else "create"
    if module == "finance":
        return "detail" if lookup(payload, "invoice_id") else "create"
    if module == "contact":
        return "detail" if lookup(payload, "contact_id") else "create"
    if module == "company":
        return "detail" if lookup(payload, "company_id") else "create"
    return "create"


def _hub_entity_id(skill: SpokeSkill, payload: Mapping[str, Any]) -> Any:
    module = skill.coworker_module or ""
    if module == "activities":
        return lookup(payload, "activity_id")
    if module == "sales":
        return lookup(payload, "deal_id")
    if module == "finance":
        return lookup(payload, "invoice_id")
    if module == "company":
        return lookup(payload, "company_id")
    if module == "contact":
        return lookup(payload, "contact_id")
    return (
        lookup(payload, "deal_id")
        or lookup(payload, "invoice_id")
        or lookup(payload, "activity_id")
        or lookup(payload, "company_id")
    )


def _merge_hub_draft(context: dict[str, Any], result: Mapping[str, Any]) -> dict[str, Any]:
    draft = dict(context.get("draft") or {})
    patch = result.get("patch") or result.get("contactDraftPatch")
    if isinstance(patch, dict):
        draft.update({k: v for k, v in patch.items() if v not in (None, "")})
    return {**context, "draft": draft}


def _needs_hub_retry(result: Mapping[str, Any]) -> bool:
    proposals = [
        tool for tool in (result.get("toolProposals") or []) if isinstance(tool, dict)
    ]
    names = {str(tool.get("name") or "") for tool in proposals}
    if "ask_clarification" in names:
        return True
    if any(name.startswith("propose_") or name.startswith("patch_") for name in names):
        return False
    speech = str(result.get("assistantText") or "").strip()
    if not speech:
        return False
    return bool(re.search(_HUB_FOLLOW_UP, speech, re.I)) or speech.endswith("?")


def _ensure_hub_save(
    result: dict[str, Any],
    skill: SpokeSkill,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    proposals = [
        tool for tool in (result.get("toolProposals") or []) if isinstance(tool, dict)
    ]
    names = {str(tool.get("name") or "") for tool in proposals}
    if any(name.startswith("propose_") for name in names):
        return result
    if skill.coworker_module != "activities":
        return result
    draft = hub_activity_draft(payload) or {}
    patch = result.get("patch") if isinstance(result.get("patch"), dict) else {}
    merged = {**draft, **patch}
    contact = str(merged.get("contactId") or lookup(payload, "contact_id") or "").strip()
    subject = str(merged.get("subject") or merged.get("body") or "").strip()
    if not contact or not subject:
        return result
    proposals.append(
        {
            "id": "hub-create-activity",
            "name": "propose_create_activity",
            "label": "Log activity",
            "args": {"auto": True, "confirmed": True},
            "risk": "high",
        }
    )
    return {**result, "toolProposals": proposals}


def _bind_legacy(fn: Callable[..., Any], payload: Mapping[str, Any]) -> dict[str, Any]:
    signature = inspect.signature(fn)
    kwargs: dict[str, Any] = {}
    missing: list[str] = []
    params = list(signature.parameters.values())
    if (
        len(params) == 1
        and params[0].kind
        in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
            inspect.Parameter.VAR_KEYWORD,
        )
        and params[0].name in {"payload", "body", "data"}
    ):
        return {params[0].name: dict(payload)}
    for param in params:
        if param.kind is inspect.Parameter.VAR_POSITIONAL:
            continue
        if param.kind is inspect.Parameter.VAR_KEYWORD:
            continue
        value = lookup(payload, param.name)
        if value is None:
            if param.default is inspect.Parameter.empty:
                missing.append(param.name)
            continue
        kwargs[param.name] = value
    if missing:
        raise InputRequiredError(missing)
    return kwargs


async def _invoke_named(agent_name: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    from app.agents import REGISTRY, get_agent

    if agent_name not in REGISTRY:
        raise SpokeRejectError(f"Unknown agent: {agent_name}", code="unknown_agent")
    kwargs = _bind_legacy(REGISTRY[agent_name], payload)
    agent = get_agent(agent_name)
    result = await agent(**kwargs)
    return result if isinstance(result, dict) else {"result": result}


async def _invoke_coworker(
    skill: SpokeSkill,
    payload: Mapping[str, Any],
    *,
    actor_id: str,
    organization_id: str,
    business_type: str,
) -> dict[str, Any]:
    from app.agents import get_agent
    from app.mcp import server as mcp_server

    user_text = hub_execute_text(payload, skill_id=skill.id)
    module = skill.coworker_module or "contact"
    surface = _hub_surface(skill, payload)
    entity_id = _hub_entity_id(skill, payload)
    draft = hub_activity_draft(payload) if module == "activities" else None
    context = {
        "module": module,
        "surface": surface,
        "entityId": entity_id,
        "businessType": business_type,
        "role": "admin",
        "organizationId": organization_id,
        "actingUserId": actor_id,
        "source": "hub",
        "hubExecute": True,
        "noFollowUp": True,
        "skillId": skill.id,
    }
    if draft:
        context["draft"] = draft
    if isinstance(payload.get("context"), dict):
        context.update(payload["context"])
        context["source"] = "hub"
        context["hubExecute"] = True
        context["noFollowUp"] = True
        if draft and not context.get("draft"):
            context["draft"] = draft
    run_id = str(payload.get("runId") or payload.get("run_id") or uuid.uuid4())
    trace_id = str(payload.get("traceId") or payload.get("trace_id") or uuid.uuid4())
    token = issue_hub_mcp_token(
        organization_id=organization_id,
        actor_id=actor_id,
        business_type=business_type,
        agent_name="crm-agent",
        module=module,
        surface=surface,
        run_id=run_id,
        trace_id=trace_id,
        idempotency_key=str(payload.get("idempotencyKey") or run_id),
    )

    # Hub activities with a ready draft: write immediately (no LLM chat turn).
    if module == "activities" and isinstance(draft, dict) and draft.get("contactId") and draft.get("subject"):
        mcp_server.begin_agent_mcp_context(
            acting_user_id=actor_id,
            organization_id=organization_id,
            role="admin",
            agent_name="crm-agent",
            execution_mode="native",
            business_type=business_type,
            module="activities",
            surface="create",
            run_id=run_id,
            trace_id=trace_id,
            idempotency_key=str(payload.get("idempotencyKey") or run_id),
            execution_token=token or "",
            entity_id=str(draft.get("contactId")),
            draft=draft,
        )
        try:
            created = await mcp_server.call_coworker_tool(
                "propose_create_activity",
                {"confirmed": True, "auto": True, "label": "Log activity"},
                context={
                    "actingUserId": actor_id,
                    "organizationId": organization_id,
                    "role": "admin",
                    "businessType": business_type,
                    "module": "activities",
                    "surface": "create",
                    "executionToken": token or "",
                    "draft": draft,
                    "entityId": str(draft.get("contactId")),
                },
            )
        finally:
            mcp_server.end_agent_mcp_context()
        log_a2a(
            step="auto_confirm",
            hub=hub_instruction(payload),
            crm={"tool": "propose_create_activity", "actorId": actor_id, "direct": True},
        )
        if isinstance(created, dict) and created.get("ok"):
            return {
                "ok": True,
                "source": "hub",
                "assistantText": str(created.get("assistantText") or "Activity logged."),
                "data": created.get("data") if isinstance(created.get("data"), dict) else {},
            }
        return {
            "ok": False,
            "source": "hub",
            "assistantText": "Failed to log Hub activity.",
            "error": str((created or {}).get("error") or "Tool failed")
            if isinstance(created, dict)
            else "Tool failed",
        }

    agent = get_agent("crm-agent")
    catalog = {"businessType": business_type, "role": "admin"}
    if draft:
        catalog["currentDraft"] = draft
    kwargs = {
        "intent": "agent_turn",
        "messages": [{"role": "user", "text": user_text}],
        "context": context,
        "catalog": catalog,
        "organizationId": organization_id,
        "role": "admin",
        "businessType": business_type,
        "actingUserId": actor_id,
        "mcpExecutionToken": token,
        "runId": run_id,
        "traceId": trace_id,
        "idempotencyKey": str(payload.get("idempotencyKey") or run_id),
    }
    result = await agent(**kwargs)
    if not isinstance(result, dict):
        return {"result": result}
    if _needs_hub_retry(result):
        log_a2a(
            step="hub_retry",
            hub=hub_instruction(payload),
            crm={"skillId": skill.id, "reason": "follow_up_blocked"},
        )
        result = await agent(
            **{
                **kwargs,
                "messages": [
                    {"role": "user", "text": user_text},
                    {
                        "role": "assistant",
                        "text": str(result.get("assistantText") or ""),
                    },
                    {
                        "role": "user",
                        "text": (
                            "Hub will not reply. Execute the instruction now with tools. "
                            "Do not ask questions. Save immediately."
                        ),
                    },
                ],
            }
        )
        if not isinstance(result, dict):
            return {"result": result}
    result = _ensure_hub_save(result, skill, payload)
    kwargs["context"] = _merge_hub_draft(kwargs["context"], result)
    confirmed = 0
    while confirmed < 3:
        proposals = [
            tool
            for tool in (result.get("toolProposals") or [])
            if isinstance(tool, dict) and _is_high_risk(tool) and tool.get("name")
        ]
        if not proposals:
            break
        tool = proposals[0]
        args = tool.get("args") if isinstance(tool.get("args"), dict) else {}
        result = await agent(
            **{
                **kwargs,
                "confirmTool": {
                    "name": str(tool.get("name")),
                    "args": {**args, "confirmed": True, "auto": True},
                },
            }
        )
        log_a2a(
            step="auto_confirm",
            hub=hub_instruction(payload),
            crm={"tool": str(tool.get("name")), "actorId": actor_id},
        )
        if not isinstance(result, dict):
            return {"result": result}
        kwargs["context"] = _merge_hub_draft(kwargs["context"], result)
        confirmed += 1
    return result


async def dispatch_skill(
    raw: Mapping[str, Any],
    *,
    actor_id: str,
    named_registry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = normalize_payload(raw)
    organization_id = require_organization(payload)
    payload["organization_id"] = organization_id
    payload["organizationId"] = organization_id
    payload = await hydrate_hub_payload(payload, organization_id=organization_id)
    skill_id_hint = resolve_skill_id(payload)
    skill = (
        get_spoke_skill(skill_id_hint, named_registry=named_registry)
        if skill_id_hint
        else None
    )
    if skill_id_hint and skill is None:
        raise SpokeRejectError(f"Unknown skill: {skill_id_hint}", code="unknown_skill")
    business_type = await resolve_business_type(
        organization_id,
        fallback=str(lookup(payload, "business_type") or ""),
    )
    if skill is not None:
        assert_skill_allowed(skill.id, business_type)
        if skill.required_fields:
            missing = [
                field
                for field in skill.required_fields
                if lookup(payload, field) in (None, "")
            ]
            if missing:
                raise InputRequiredError(missing)
    log_a2a(
        step="dispatch",
        hub=hub_instruction(payload),
        crm={
            "skillId": skill.id if skill else skill_id_hint,
            "skillHint": skill_id_hint,
            "agent": skill.agent_name if skill else None,
            "kind": skill.kind if skill else "supervised",
            "businessType": business_type,
        },
    )

    async def _invoke_coworker_for_skill(
        spoke_skill: SpokeSkill, task_payload: Mapping[str, Any]
    ) -> dict[str, Any]:
        return await _invoke_coworker(
            spoke_skill,
            task_payload,
            actor_id=actor_id,
            organization_id=organization_id,
            business_type=business_type,
        )

    result, agent_name = await run_hub_supervised_task(
        skill=skill,
        payload=payload,
        invoke_named=_invoke_named,
        invoke_coworker=_invoke_coworker_for_skill,
    )
    status = "completed"
    if isinstance(result, dict) and result.get("ok") is False:
        status = "failed"
    receipt_skill = skill.id if skill else (skill_id_hint or "hub-supervised")
    return receipt(
        status=status,
        skill_id=receipt_skill,
        agent_name=agent_name,
        result=result,
    )

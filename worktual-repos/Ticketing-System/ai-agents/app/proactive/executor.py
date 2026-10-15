"""Execute catalog tools by name after ASGA (Express remains RBAC)."""

from __future__ import annotations

from typing import Any, Callable

from app.tools.registry import assert_tool_allowed


def _call_update(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ticket_write import update_ticket

    tn = str(args.get("ticket_number") or "")
    kwargs = {
        k: args[k]
        for k in (
            "status",
            "priority",
            "assignee",
            "resolver",
            "subject",
            "description",
            "queue",
            "category",
            "ai_summary",
        )
        if k in args and args[k] is not None
    }
    return update_ticket(tn, **kwargs)


def _call_create(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ticket_write import create_ticket

    return create_ticket(args)


def _call_note(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ticket_write import add_ticket_note

    return add_ticket_note(
        str(args.get("ticket_number") or ""),
        str(args.get("text") or args.get("body") or ""),
        visibility=str(args.get("visibility") or "internal"),
    )


def _call_escalate(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ticket_write import escalate_ticket

    return escalate_ticket(
        str(args.get("ticket_number") or ""),
        assignee=args.get("assignee"),
        assignee_id=args.get("assignee_id"),
        rationale=args.get("rationale"),
    )


def _call_auto_assign(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ticket_write import auto_assign_ticket

    return auto_assign_ticket(str(args.get("ticket_number") or ""))


def _call_notify(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import send_staff_notification

    ids: list[str] = []
    raw = args.get("user_ids")
    if isinstance(raw, (list, tuple)):
        ids.extend(str(x).strip() for x in raw if str(x).strip())
    single = str(args.get("user_id") or "").strip()
    if single:
        ids.append(single)
    ids = list(dict.fromkeys(ids))
    if not ids:
        return send_staff_notification(
            user_id="",
            title=str(args.get("title") or ""),
            message=str(args.get("message") or ""),
            kind=str(args.get("kind") or "update"),
            ticket_uuid=args.get("ticket_uuid"),
            customer_name=args.get("customer_name"),
        )
    results = []
    for uid in ids:
        results.append(
            send_staff_notification(
                user_id=uid,
                title=str(args.get("title") or ""),
                message=str(args.get("message") or ""),
                kind=str(args.get("kind") or "update"),
                ticket_uuid=args.get("ticket_uuid"),
                customer_name=args.get("customer_name"),
            )
        )
    if len(results) == 1:
        return results[0]
    return {"ok": True, "results": results}


def _call_get_ticket(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ticket_read import get_ticket

    return get_ticket(str(args.get("ticket_number") or args.get("id") or ""))


def _call_list_ticket_notes(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ticket_read import list_ticket_notes

    return list_ticket_notes(str(args.get("ticket_number") or args.get("id") or ""))


def _call_list_tickets(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.ticket_read import list_tickets

    allowed = {
        "scope",
        "limit",
        "created_by",
        "assigned_to",
        "status",
        "priority",
        "channel",
        "query",
        "queue",
        "customer",
        "due",
        "created_range",
        "updated_range",
        "sort",
    }
    return list_tickets(**{k: v for k, v in args.items() if k in allowed and v is not None})


def _call_get_analytics(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import get_analytics

    return get_analytics(chart_range=args.get("chart_range") or args.get("range"))


def _call_ask_semantic_layer(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import ask_semantic_layer

    return ask_semantic_layer(
        query=str(args.get("query") or ""),
        organization_id=args.get("organization_id"),
    )


def _call_ask_ontology(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import ask_ontology

    return ask_ontology(
        query=str(args.get("query") or ""),
        organization_id=args.get("organization_id"),
        session_id=args.get("session_id"),
    )


def _call_list_agents(_args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import list_agents

    return list_agents()


def _call_list_queues(_args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import list_queues

    return list_queues()


def _call_list_kb(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import list_kb

    return list_kb(query=args.get("query"), category=args.get("category"))


def _call_list_macros(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import list_macros

    return list_macros(query=args.get("query"))


def _call_get_metrics(_args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import get_metrics

    return get_metrics()


def _call_list_recs(args: dict[str, Any]) -> dict[str, Any]:
    from app.tools.catalog_tools import list_ticket_recommendations

    return list_ticket_recommendations(ticket_number=args.get("ticket_number"))


TOOL_FNS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "create_ticket": _call_create,
    "update_ticket": _call_update,
    "add_ticket_note": _call_note,
    "escalate_ticket": _call_escalate,
    "auto_assign_ticket": _call_auto_assign,
    "send_staff_notification": _call_notify,
    "get_ticket": _call_get_ticket,
    "list_ticket_notes": _call_list_ticket_notes,
    "list_tickets": _call_list_tickets,
    "list_agents": _call_list_agents,
    "list_queues": _call_list_queues,
    "list_kb": _call_list_kb,
    "list_macros": _call_list_macros,
    "get_analytics": _call_get_analytics,
    "ask_semantic_layer": _call_ask_semantic_layer,
    "ask_ontology": _call_ask_ontology,
    "get_metrics": _call_get_metrics,
    "list_ticket_recommendations": _call_list_recs,
}


def execute_tool(
    agent_id: str,
    tool_name: str,
    args: dict[str, Any],
    *,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    assert_tool_allowed(agent_id, tool_name)
    from app.mcp.authorization import issue_mcp_token
    from app.mcp.client import call_mcp_tool
    from app.proactive.registry_agents import harness_binding_for
    from app.skills.catalog import load_skill_definition, tools_for_skill
    from app.tools.express_client import get_tool_actor
    from app.workflow_schemas import task_definition_for

    binding = harness_binding_for(agent_id)
    actor = get_tool_actor()
    if not binding or not actor or not actor.user_id or not actor.organization_id:
        raise PermissionError("proactive Harness execution requires binding and actor")
    executor = binding["executor"]
    skill_name = binding["skill_name"]
    task = task_definition_for(binding["task_id"])
    skill = load_skill_definition(skill_name)
    if not task or not task.active or not skill.active:
        raise PermissionError("proactive Harness task or Skill is inactive")
    allowed = tools_for_skill(skill_name, executor)
    if tool_name not in allowed:
        raise PermissionError(
            f"Tool {tool_name} is outside proactive Skill {skill_name}"
        )
    token = issue_mcp_token(
        organization_id=actor.organization_id,
        actor_id=actor.user_id,
        role=actor.user_role or "admin",
        allowed_tools=sorted(allowed),
        agent_id=executor,
        task_id=task.id,
        skill_name=skill_name,
        skill_version=skill.version,
        route_mode="proactive",
        run_id=idempotency_key,
    )
    tool_args = dict(args or {})
    if idempotency_key and tool_name in {"create_ticket", "portal_create_ticket"}:
        tool_args["_idempotency_key"] = idempotency_key
    return call_mcp_tool(
        tool_name,
        tool_args,
        token=token,
        agent=executor,
    )

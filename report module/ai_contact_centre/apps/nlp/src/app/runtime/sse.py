"""Server-Sent Event (SSE) serialization for streaming Copilot responses."""

import json
import uuid
from datetime import UTC, datetime
from typing import Any


def encode_sse(event: str, data: dict[str, Any]) -> str:
    """Encode an SSE event according to the standard contract."""
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def sse_status(phase: str, label: str | None = None) -> str:
    return encode_sse(
        "status",
        {
            "phase": phase,
            "label": label or phase.replace("_", " ").title(),
        },
    )


def routing_label_for_path(path: str | None) -> str:
    """Human progress copy when navigating to a coworker destination."""
    raw = (path or "").strip().lower()
    if not raw:
        return "Routing you there…"

    checks: list[tuple[tuple[str, ...], str]] = [
        (("live-monitoring", "/monitoring", "monitoring"), "Routing to live monitoring…"),
        (("contacts",), "Routing to contacts…"),
        (("workforce/queues", "/queues", "queue"), "Routing to queues…"),
        (("workforce",), "Routing to workforce…"),
        (("tasks",), "Routing to tasks…"),
        (("inbox", "workspace"), "Routing to inbox…"),
        (("performance", "my-performance"), "Routing to performance…"),
        (("dashboard/analytics",), "Routing to analytics…"),
        (("analytics", "reports", "dashboard"), "Routing to the dashboard…"),
        (("settings",), "Routing to settings…"),
        (("channels",), "Routing to channels…"),
        (("teams",), "Routing to teams…"),
        (("agents",), "Routing to agents…"),
    ]
    for needles, label in checks:
        if any(needle in raw for needle in needles):
            return label
    return "Routing you there…"


def routing_label_for_agent(agent_name: str | None) -> str:
    name = (agent_name or "").strip().lower()
    mapping = {
        "analytics": "Routing to analytics…",
        "contact": "Routing to contacts…",
        "inbox": "Routing to inbox…",
        "task": "Routing to tasks…",
        "queue": "Routing to queues…",
        "general": "Routing to your co-worker…",
    }
    return mapping.get(name, "Routing to the right specialist…")


def sse_thinking(surface: str | None = None) -> str:
    del surface
    return sse_status("understanding", "Understanding your question…")


def sse_understanding() -> str:
    return sse_status("understanding", "Understanding your question…")


def sse_querying() -> str:
    return sse_status("querying", "Writing the analytics query…")


def sse_fetching(label: str = "Fetching data…") -> str:
    return sse_status("fetching", label)


def sse_charting() -> str:
    return sse_status("charting", "Constructing the chart…")


def sse_writing() -> str:
    return sse_status("writing", "Generating response…")


def sse_routing(path: str | None = None, *, agent_name: str | None = None) -> str:
    if path:
        return sse_status("routing", routing_label_for_path(path))
    return sse_status("routing", routing_label_for_agent(agent_name))


def sse_tool_status(tool: str, label: str | None = None) -> str:
    return sse_status("tool", label or tool)


_TOOL_PROGRESS_LABELS: dict[str, str] = {
    "ask_ontology_layer": "Exploring the knowledge graph…",
    "ask_semantic_layer": "Utilizing the semantic layer…",
    "generate_performance_report": "Generating KPI…",
    "get_dashboard_analytics_snapshot": "Loading Analytics…",
    "get_analytics_hourly_volume": "Loading hourly volume…",
    "generate_plot": "Constructing the chart…",
    "sql_analytics": "Writing the analytics query…",
    "get_metrics": "Loading metric definitions…",
    "get_metric": "Loading metric details…",
    "get_metric_schema": "Checking the data schema…",
    "list_metric_domains": "Loading metric domains…",
    "list_active_metrics": "Checking active metrics…",
    "navigate": "Routing you there…",
    "route_to_agent": "Routing to the right specialist…",
    "stage_queue_draft": "Updating the queue preview…",
    "list_queues": "Checking your queues…",
    "list_teams": "Checking which teams are available…",
    "list_business_hours": "Checking business hours options…",
    "list_eligible_agents": "Finding agents who can join this queue…",
    "list_agents": "Checking who's available…",
    "list_presence": "Checking who's online…",
    "create_queue": "Creating your queue…",
    "update_queue": "Updating the queue…",
    "update_queue_status": "Updating the queue…",
    "delete_queue": "Deleting the queue…",
    "stage_contact_draft": "Updating the contact preview…",
    "list_contacts": "Searching contacts…",
    "get_contact": "Opening the contact profile…",
    "create_contact": "Saving the new contact…",
    "update_contact": "Saving contact changes…",
    "list_tasks": "Checking your tasks…",
    "get_task": "Opening task details…",
    "update_task": "Updating the task…",
    "get_conversation_context": "Reading the conversation…",
    "suggest_reply": "Drafting a suggested reply…",
    "summarize_conversation": "Summarizing the conversation…",
    "contact_enrich": "Updating contact details…",
    "get_organization_details": "Looking up organization details…",
    "get_organization_knowledge": "Searching knowledge…",
    "get_skill": "Loading skill guidance…",
    "list_skills": "Checking available skills…",
    "open_task_workspace": "Opening the linked workspace…",
    "get_monitoring_snapshot": "Loading live monitoring…",
    "get_agent_attendance": "Checking agent attendance…",
    "get_not_ready_escalation_insight": "Reading escalation insight…",
    "get_contact_callback_channels": "Checking callback channels…",
}


def sse_tool_progress(
    tool: str,
    *,
    has_presentation: bool = False,
    path: str | None = None,
    agent_name: str | None = None,
) -> list[str]:
    if tool == "ask_ontology_layer":
        return [sse_status("ontology_layer", "Exploring the knowledge graph…")]
    if tool == "ask_semantic_layer":
        return [sse_status("semantic_layer", "Utilizing the semantic layer…")]
    if tool == "sql_analytics":
        events = [sse_querying(), sse_fetching("Fetching data…")]
        if has_presentation:
            events.append(sse_charting())
        return events
    if tool == "generate_performance_report":
        return [sse_status("kpi", "Generating KPI…")]
    if tool == "get_dashboard_analytics_snapshot":
        return [sse_status("fetching", "Loading Analytics…")]
    if tool == "get_analytics_hourly_volume":
        return [sse_charting()]
    if tool == "generate_plot":
        return [sse_charting()]
    if tool == "navigate":
        return [sse_routing(path)]
    if tool == "route_to_agent":
        return [sse_routing(agent_name=agent_name)]
    if tool == "get_organization_knowledge":
        return [sse_status("knowledge", "Searching knowledge…")]
    if tool == "get_organization_details":
        return [sse_status("organization", "Looking up organization details…")]
    if tool in {"suggest_reply", "summarize_conversation", "get_conversation_context"}:
        label = _TOOL_PROGRESS_LABELS[tool]
        return [sse_tool_status(tool, label)]
    label = _TOOL_PROGRESS_LABELS.get(tool)
    if label:
        return [sse_tool_status(tool, label)]
    return [sse_tool_status(tool)]


def sse_text_delta(delta: str) -> str:
    return encode_sse("text_delta", {"delta": delta})


def sse_tool_call(tool: str, args: dict[str, Any]) -> str:
    return encode_sse("tool_call", {"tool": tool, "args": args})


def sse_tool_block(
    tool_call_id: str,
    tool: str,
    status: str,
    args: dict[str, Any],
    *,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> str:
    data: dict[str, Any] = {
        "id": tool_call_id,
        "kind": "tool",
        "tool": tool,
        "status": status,
        "args": args,
        "createdAt": datetime.now(UTC).isoformat(),
    }
    if result is not None:
        data["result"] = result
    if error is not None:
        data["error"] = error
    return encode_sse("block", data)


def sse_contact_draft(draft: dict[str, Any]) -> str:
    return encode_sse("contact_draft", draft)


def sse_queue_draft(draft: dict[str, Any]) -> str:
    return encode_sse("queue_draft", draft)


def sse_assist_state(state: dict[str, Any]) -> str:
    """Emit private passive-assist state separate from customer-facing text."""
    return encode_sse("assist_state", state)


def sse_confirmation_required(data: dict[str, Any]) -> str:
    return encode_sse("confirmation_required", data)


def sse_action(action: str, data: dict[str, Any] | None = None) -> str:
    return encode_sse("action", {"type": action, **(data or {})})


def sse_error(message: str, code: str = "runtime_error") -> str:
    return encode_sse("error", {"code": code, "message": message})


def sse_done(
    turn_id: str | None = None,
    route: str | None = None,
    routing_chain: list[str] | None = None,
    prompt_versions: dict[str, str] | None = None,
) -> str:
    data: dict[str, Any] = {"turnId": turn_id or str(uuid.uuid4())}
    if route:
        data["route"] = route
    if routing_chain:
        data["routingChain"] = routing_chain
    if prompt_versions:
        data["promptVersions"] = prompt_versions
    return encode_sse("done", data)

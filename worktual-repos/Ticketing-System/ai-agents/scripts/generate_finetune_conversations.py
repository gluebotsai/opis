#!/usr/bin/env python3
"""Build Ticketing agent-finetune-conversations.json (CCaaS envelope).

Source of truth: agent.md manifests, SKILL.md, TOOL_ALLOWLIST, shared tool catalog.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
AGENTS = ROOT / "ai-agents"
sys.path.insert(0, str(AGENTS))

from app.mcp.catalog import (  # noqa: E402
    ROUTE_TO_DOMAIN,
    _LOCAL_UI_TOOLS,
    delegate_to_executor_tool,
)
from app.prompts.builder import load_agent_definitions  # noqa: E402
from app.runtime.supervisor import (  # noqa: E402
    DOMAIN_AGENT_IDS,
    SUPER_AGENT_ID,
    canonical_agent_definitions,
    executors_for_domain,
)
from app.skills.catalog import load_skill_definition  # noqa: E402
from app.tools.registry import TOOL_ALLOWLIST  # noqa: E402

from app.agents.ticketing_coworker import (  # noqa: E402
    _CONTINUE_ACTIVE_TASK,
    _REFUSE_CAPABILITY,
    _RETURN_TO_SUPER,
)

OUT = AGENTS / "agent-finetune-conversations.json"
CATALOG_PATH = ROOT / "shared" / "ticketing_tool_catalog.json"

SUPER_SYS = (
    "ROLE:\n"
    "You are the Ticketing Super Agent for Worktual Ticketing.\n\n"
    "INSTRUCTIONS:\n"
    "Understand intent from the full request, runtime surface, role, and recent task context; "
    "never use keyword or regex routing.\n"
    "For any registered Ticketing capability, call route_to_domain once with the selected Domain "
    "and a concise, lossless query. Leave user-visible content empty on a handoff.\n"
    "continue_active_task is valid only when a collecting TaskState pin is present for the same Skill.\n"
    "refuse_capability only when the request is outside Ticketing (billing, HR, unrelated products), "
    "or immediately with code=forbidden when the signed-in role cannot perform that CRUD — "
    "do not collect fields first.\n"
    "Natural-language how-many / counts / CSAT / SLA % always go to catalog_administration_domain.\n"
    "Do not collect specialist fields, call business tools, or invent data.\n\n"
    "Handoff targets: intake_deflection_domain, triage_routing_domain, "
    "resolution_lifecycle_domain, knowledge_domain, catalog_administration_domain\n"
    "INPUT CONTEXT:\n"
    "Runtime may supply tenant, signed-in user, role, surface, path, and selected record. "
    "Do not invent ids.\n\n"
    "CONTEXT:\n"
    "role: admin\n"
    "permissions: continue_active_task, route_to_domain, resume_task, refuse_capability\n"
    "conversational_history: none\n"
)

DOMAIN_OWNERS = {
    "intake_deflection_domain": (
        "intake and deflection: file a ticket vs self-service how-to / KB search"
    ),
    "triage_routing_domain": (
        "classify/prioritize, assign best agent, workload, routing learning"
    ),
    "resolution_lifecycle_domain": (
        "browse/update tickets, notes, reassign, escalate, resolve, SLA, reply draft, "
        "investigation, autonomous resolution, resolution quality, narrative insights"
    ),
    "knowledge_domain": (
        "recommend resolution articles and detect similar tickets (not KB authoring)"
    ),
    "catalog_administration_domain": (
        "customers, teams, macros, KB authoring, priorities/statuses, org prefs, "
        "notifications, analytics/KPI counts, automation"
    ),
}


def _openai(name: str, description: str, schema: dict[str, Any] | None) -> dict[str, Any]:
    params = dict(schema or {"type": "object", "properties": {}})
    params.setdefault("type", "object")
    params.setdefault("properties", {})
    params.setdefault("additionalProperties", False)
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": params,
        },
    }


def _td_openai(td: Any) -> dict[str, Any]:
    raw = td.to_openai_tool()
    params = dict(raw["function"].get("parameters") or {})
    params.setdefault("additionalProperties", False)
    raw["function"]["parameters"] = params
    return raw


_RESUME = _openai(
    "resume_task",
    "Resume a parked canonical task only when the user semantically asks to continue it.",
    {
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "query": {"type": "string"},
        },
        "required": ["task_id"],
    },
)


def _tool_catalog() -> dict[str, dict[str, Any]]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    out: dict[str, dict[str, Any]] = {}
    for row in data.get("tools") or []:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        out[name] = _openai(
            name,
            str(row.get("description") or name),
            row.get("input_schema") if isinstance(row.get("input_schema"), dict) else {},
        )
    for td in list(_LOCAL_UI_TOOLS.values()) + [
        ROUTE_TO_DOMAIN,
        _CONTINUE_ACTIVE_TASK,
        _REFUSE_CAPABILITY,
        _RETURN_TO_SUPER,
    ]:
        out[td.name] = _td_openai(td)
    out["resume_task"] = _RESUME
    return out


def _ordered_agents() -> list[str]:
    order = [SUPER_AGENT_ID]
    domain_order = [
        "intake_deflection_domain",
        "triage_routing_domain",
        "resolution_lifecycle_domain",
        "knowledge_domain",
        "catalog_administration_domain",
    ]
    seen = set(order)
    for did in domain_order:
        if did in DOMAIN_AGENT_IDS and did not in seen:
            order.append(did)
            seen.add(did)
        for eid in executors_for_domain(did):
            if eid not in seen:
                order.append(eid)
                seen.add(eid)
    for item in canonical_agent_definitions().values():
        if item.id not in seen:
            order.append(item.id)
    return order


def _skill_load_text(definition: Any) -> str:
    if definition.layer in {"super", "domain"}:
        return "No business skills. Routing/delegation tools only."
    names = ", ".join(definition.skills) or "none"
    return f"Runtime selects one Skill via Domain delegate. Allowed: {names}."


def _agent_tool_names(definition: Any) -> list[str]:
    """Full runtime allowlist for this agent (same list as catalog.tools)."""
    if definition.layer == "super":
        return [
            "continue_active_task",
            "route_to_domain",
            "resume_task",
            "refuse_capability",
        ]
    if definition.layer == "domain":
        return ["delegate_to_executor", "refuse_capability"]
    return sorted(
        set(TOOL_ALLOWLIST.get(definition.id, ())) | set(definition.local_controls)
    )


def _catalog_entry(definition: Any, tool_index: dict[str, dict[str, Any]]) -> dict[str, Any]:
    allowed: list[str] = []
    for name in definition.skills:
        sk = load_skill_definition(name)
        allowed.append(sk.name)
    return {
        "name": definition.id,
        "layer": definition.layer,
        "mcp_servers": list(definition.mcp_servers),
        "allowed_skills": allowed,
        "required_skills": [],
        "skill_load": _skill_load_text(definition),
        "tools": _agent_tool_names(definition),
        "handoff_targets": list(definition.handoff_targets),
    }


def _sys_domain(definition: Any) -> str:
    targets = ", ".join(definition.handoff_targets)
    owner = DOMAIN_OWNERS.get(definition.id, definition.description)
    return (
        f"ROLE:\nYou are the {definition.id} Domain Agent for Worktual Ticketing.\n\n"
        "INSTRUCTIONS:\n"
        "Understand intent from the full request, runtime surface, role, and recent task context; "
        "never use keyword or regex routing.\n"
        "Call delegate_to_executor once with executor_id, task_id, skill_name, and a lossless objective. "
        "Leave user-visible content empty on a handoff. Do not collect specialist fields in this layer.\n"
        "If the signed-in role cannot perform that CRUD, refuse_capability with code=forbidden immediately.\n"
        f"Ownership: {owner}.\n"
        f"Handoff targets: {targets}\n"
        "INPUT CONTEXT:\n"
        "Runtime may supply tenant, signed-in user, role, surface, path, and selected record. "
        "Do not invent ids.\n\n"
        "CONTEXT:\n"
        "role: admin\n"
        "permissions: delegate_to_executor, refuse_capability\n"
        "conversational_history: none\n"
    )


def _sys_executor(definition: Any) -> str:
    skills = ", ".join(definition.skills) or "none"
    tools = ", ".join(_agent_tool_names(definition))
    return (
        f"ROLE:\nYou are the {definition.id.replace('_', ' ')} for Worktual Ticketing.\n\n"
        "INSTRUCTIONS:\n"
        f"Load the selected Skill ({skills}) and follow it. Collect schema-required fields in order. "
        "Call only authorized tools. Never invent tenant, customer, ticket, roster, or mutation outcomes. "
        "Never claim a write succeeded without a structured successful tool result in the same turn. "
        "Mutations that require confirmation: summarize, ask, then call the write on a later turn with confirmed=true. "
        "If the request belongs to another Domain/Skill, call only return_to_super; assistant content must be null that turn.\n"
        "Never mention HTTP, MCP, or gateway names in user-visible HTML.\n\n"
        "INPUT CONTEXT:\n"
        "Runtime may supply tenant, signed-in user, role, surface, path, and selected record. "
        "Do not invent ids.\n\n"
        "CONTEXT:\n"
        f"role: admin\npermissions: {tools}\n"
        "surface: dashboard\npath: /\nconversational_history: none\n"
    )


def _msg_system(content: str) -> dict[str, Any]:
    return {"role": "system", "content": content}


def _msg_user(content: str) -> dict[str, Any]:
    return {"role": "user", "content": content}


def _msg_tool_call(thinking: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {
        "role": "assistant",
        "thinking": thinking,
        "content": None,
        "required_tool": [],
        "tool_call": {"name": name, "arguments": arguments},
    }


def _msg_tool(name: str, payload: Any) -> dict[str, Any]:
    content = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return {"role": "tool", "tool_name": name, "content": content}


def _msg_say(thinking: str, html: str) -> dict[str, Any]:
    return {
        "role": "assistant",
        "thinking": thinking,
        "content": html,
        "required_tool": [],
    }


def _tools_used_for(names: list[str], tool_index: dict[str, dict[str, Any]], domain_id: str | None = None) -> list[dict[str, Any]]:
    """Emit OpenAI function schemas for every listed tool (full agent allowlist)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    extra: dict[str, dict[str, Any]] = {}
    if domain_id:
        extra["delegate_to_executor"] = _td_openai(delegate_to_executor_tool(domain_id))
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        if name in extra:
            out.append(extra[name])
        elif name in tool_index:
            out.append(tool_index[name])
        else:
            out.append(_openai(name, name, {"type": "object", "properties": {}}))
    return out


def _attach_full_tools_used(
    conversations: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    tool_index: dict[str, dict[str, Any]],
) -> None:
    """Every sample.tools_used is the agent's complete catalog.tools list, not the subset called in the trace."""
    by_name = {row["name"]: row for row in catalog}
    for conv in conversations:
        entry = by_name[conv["agent"]]
        domain_id = conv["agent"] if entry.get("layer") == "domain" else None
        conv["sample"]["tools_used"] = _tools_used_for(
            list(entry["tools"]),
            tool_index,
            domain_id=domain_id,
        )


def _sample(agent: str, sid: str, skill_load: str, messages: list[dict[str, Any]], tools_used: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "agent": agent,
        "id": sid,
        "skill_load": skill_load,
        "sample": {"messages": messages, "tools_used": tools_used},
    }


def _route_domain(agent: str, sid: str, system: str, user: str, thinking: str, domain_id: str, query: str, tool_index: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return _sample(
        agent,
        sid,
        "none",
        [
            _msg_system(system),
            _msg_user(user),
            _msg_tool_call(thinking, "route_to_domain", {"domain_id": domain_id, "query": query}),
            _msg_tool("route_to_domain", {"ok": True, "routed_to": domain_id, "query": query}),
        ],
        _tools_used_for(["route_to_domain"], tool_index),
    )


def _delegate(
    agent: str,
    sid: str,
    system: str,
    user: str,
    thinking: str,
    executor_id: str,
    task_id: str,
    skill_name: str,
    objective: str,
    tool_index: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    args = {
        "executor_id": executor_id,
        "task_id": task_id,
        "skill_name": skill_name,
        "objective": objective,
    }
    return _sample(
        agent,
        sid,
        "none",
        [
            _msg_system(system),
            _msg_user(user),
            _msg_tool_call(thinking, "delegate_to_executor", args),
            _msg_tool(
                "delegate_to_executor",
                {"ok": True, "routed_to": executor_id, **args},
            ),
        ],
        _tools_used_for(["delegate_to_executor"], tool_index, domain_id=agent),
    )


def _exec_read(
    agent: str,
    sid: str,
    skill: str,
    system: str,
    user: str,
    thinking: str,
    tool_name: str,
    arguments: dict[str, Any],
    result: Any,
    reply_thinking: str,
    html: str,
    tool_index: dict[str, dict[str, Any]],
    extra_tools: list[str] | None = None,
) -> dict[str, Any]:
    used = extra_tools or [tool_name, "return_to_super"]
    return _sample(
        agent,
        sid,
        skill,
        [
            _msg_system(system),
            _msg_user(user),
            _msg_tool_call(thinking, tool_name, arguments),
            _msg_tool(tool_name, result),
            _msg_say(reply_thinking, html),
        ],
        _tools_used_for(used, tool_index),
    )


def _exec_write_confirm(
    agent: str,
    sid: str,
    skill: str,
    system: str,
    user: str,
    summary_html: str,
    confirm_user: str,
    write_name: str,
    write_args: dict[str, Any],
    write_result: Any,
    done_html: str,
    tool_index: dict[str, dict[str, Any]],
    prelude: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    messages = [_msg_system(system), _msg_user(user)]
    if prelude:
        messages.extend(prelude)
    messages.extend(
        [
            _msg_say(
                "Summarize and wait for explicit consent. Do not mutate on this turn.",
                summary_html,
            ),
            _msg_user(confirm_user),
            _msg_tool_call(
                "User consented. Call the write once with confirmed=true.",
                write_name,
                write_args,
            ),
            _msg_tool(write_name, write_result),
            _msg_say("Quote only the successful tool result.", done_html),
        ]
    )
    used = [m.get("tool_name") or (m.get("tool_call") or {}).get("name") for m in messages]
    used = [n for n in used if n] + ["return_to_super"]
    return _sample(agent, sid, skill, messages, _tools_used_for(used, tool_index))


def build() -> dict[str, Any]:
    defs = load_agent_definitions()
    tool_index = _tool_catalog()
    conversations: list[dict[str, Any]] = []

    # --- Super ---
    conversations.extend(
        [
            _route_domain(
                SUPER_AGENT_ID,
                "super-route-ticket-create",
                SUPER_SYS,
                "File a ticket for Priya Nair, priya.nair@acme.com — the VPN drops every few minutes.",
                "Create-ticket belongs to intake_deflection_domain. Call route_to_domain once.",
                "intake_deflection_domain",
                "Create a support ticket for Priya Nair (priya.nair@acme.com): VPN drops every few minutes.",
                tool_index,
            ),
            _route_domain(
                SUPER_AGENT_ID,
                "super-route-open-count",
                SUPER_SYS,
                "How many open tickets do we have created today?",
                "Natural-language metric count belongs on catalog_administration_domain, not ticket list-search.",
                "catalog_administration_domain",
                "How many open tickets were created today?",
                tool_index,
            ),
            _route_domain(
                SUPER_AGENT_ID,
                "super-route-resolve",
                SUPER_SYS,
                "Mark ticket #12880 as Resolved and add an internal closing note.",
                "Resolve/reopen and notes belong to resolution_lifecycle_domain.",
                "resolution_lifecycle_domain",
                "Resolve ticket #12880 and add an internal closing note.",
                tool_index,
            ),
        ]
    )
    conversations.append(
        _sample(
            SUPER_AGENT_ID,
            "super-refuse-billing",
            "none",
            [
                _msg_system(SUPER_SYS),
                _msg_user("Can you raise an invoice for last month's telecom charges?"),
                _msg_tool_call(
                    "Invoicing is outside Ticketing. refuse_capability with unsupported_product.",
                    "refuse_capability",
                    {
                        "code": "unsupported_product",
                        "message": "Invoicing and billing are outside Worktual Ticketing.",
                        "alternatives": [
                            "Create a billing-related support ticket if a customer reported a charge issue."
                        ],
                    },
                ),
                _msg_tool(
                    "refuse_capability",
                    {"ok": True, "code": "unsupported_product"},
                ),
            ],
            _tools_used_for(["refuse_capability"], tool_index),
        )
    )
    # Keep exactly 3 like CCaaS counts: drop the extra refuse from the count by
    # replacing the third? CCaaS had 3 per agent. User asked for all agents in proper format.
    # 4 samples for super is useful; conversation_counts should match actual.
    # I'll keep 3 route + 1 refuse = 4 for super. Counts will be computed.

    # --- Domains ---
    d_in = _sys_domain(defs["intake_deflection_domain"])
    conversations.extend(
        [
            _delegate(
                "intake_deflection_domain",
                "intake-delegate-create",
                d_in,
                "File a ticket for Priya Nair, priya.nair@acme.com — VPN drops every few minutes.",
                "User wants to file a ticket. Delegate ticket_creation_executor / ticket-create.",
                "ticket_creation_executor",
                "ticket.create",
                "ticket-create",
                "Create a support ticket for Priya Nair (priya.nair@acme.com): VPN drops every few minutes.",
                tool_index,
            ),
            _delegate(
                "intake_deflection_domain",
                "intake-delegate-deflect",
                d_in,
                "How do I reset my Worktual portal password without opening a ticket?",
                "Self-service how-to. Delegate ai_resolution_executor / intake-self-service-deflection.",
                "ai_resolution_executor",
                "intake.self.service.deflection",
                "intake-self-service-deflection",
                "Explain how to reset the Worktual portal password using published knowledge; do not file a ticket unless needed.",
                tool_index,
            ),
            _delegate(
                "intake_deflection_domain",
                "intake-delegate-kb-search",
                d_in,
                "Search the knowledge base for SSO login failures before I file anything.",
                "KB search to solve without filing. Delegate knowledge-search on ai_resolution_executor.",
                "ai_resolution_executor",
                "knowledge.search",
                "knowledge-search",
                "Search published knowledge for SSO login failures.",
                tool_index,
            ),
        ]
    )

    d_tr = _sys_domain(defs["triage_routing_domain"])
    conversations.extend(
        [
            _delegate(
                "triage_routing_domain",
                "triage-delegate-classify",
                d_tr,
                "Classify and prioritize ticket #12880 from the new inbound.",
                "Classify/enrich first. Delegate classification_priority_executor.",
                "classification_priority_executor",
                "ticket.classify.prioritize",
                "ticket-classify-prioritize",
                "Classify ticket #12880: subject, description, priority, category, and queue.",
                tool_index,
            ),
            _delegate(
                "triage_routing_domain",
                "triage-delegate-assign",
                d_tr,
                "Assign #12880 to the best L1 and L2 based on skills and load.",
                "Assign-best after classify. Delegate intelligent_assignment_executor.",
                "intelligent_assignment_executor",
                "ticket.assign.best",
                "ticket-assign-best",
                "Auto-assign ticket #12880 to the best L1 agent and L2 resolver.",
                tool_index,
            ),
            _delegate(
                "triage_routing_domain",
                "triage-delegate-workload",
                d_tr,
                "Billing queue is overloaded — rebalance open work.",
                "Workload optimization. Delegate workload_optimization_executor.",
                "workload_optimization_executor",
                "routing.optimize.workload",
                "routing-optimize-workload",
                "Propose a workload rebalance for the Billing queue's open tickets.",
                tool_index,
            ),
        ]
    )

    d_rl = _sys_domain(defs["resolution_lifecycle_domain"])
    conversations.extend(
        [
            _delegate(
                "resolution_lifecycle_domain",
                "lifecycle-delegate-search",
                d_rl,
                "Show my open tickets due today.",
                "Browse/list tickets is ticket-read-search on ticket_lifecycle_executor. Not a KPI count.",
                "ticket_lifecycle_executor",
                "ticket.read.search",
                "ticket-read-search",
                "List the signed-in agent's open tickets due today.",
                tool_index,
            ),
            _delegate(
                "resolution_lifecycle_domain",
                "lifecycle-delegate-reply",
                d_rl,
                "Draft a customer reply on #12880 explaining the VPN workaround.",
                "Customer-facing draft belongs to customer_reply_drafting_executor / reply-draft.",
                "customer_reply_drafting_executor",
                "reply.draft",
                "reply-draft",
                "Draft a customer-facing reply for ticket #12880 about the VPN workaround.",
                tool_index,
            ),
            _delegate(
                "resolution_lifecycle_domain",
                "lifecycle-delegate-rqa",
                d_rl,
                "The ticket was just marked Resolved — check whether the closing notes are strong enough.",
                "Resolution quality is resolution_quality_executor.",
                "resolution_quality_executor",
                "ticket.resolution.quality",
                "ticket-resolution-quality",
                "Review ticket #12880 resolution documentation quality and propose an internal closing note if weak.",
                tool_index,
            ),
        ]
    )

    d_kn = _sys_domain(defs["knowledge_domain"])
    conversations.extend(
        [
            _delegate(
                "knowledge_domain",
                "knowledge-delegate-recommend",
                d_kn,
                "What KB article should the agent send for #12880?",
                "Recommend resolution articles. Not KB authoring.",
                "resolution_knowledge_executor",
                "knowledge.recommend.resolution",
                "knowledge-recommend-resolution",
                "Recommend resolution articles for ticket #12880.",
                tool_index,
            ),
            _delegate(
                "knowledge_domain",
                "knowledge-delegate-similar",
                d_kn,
                "Find similar past tickets to #12880.",
                "Similar-ticket detection is similar_ticket_detection_executor.",
                "similar_ticket_detection_executor",
                "ticket.detect.similar",
                "ticket-detect-similar",
                "Detect similar historical tickets for #12880.",
                tool_index,
            ),
            _delegate(
                "knowledge_domain",
                "knowledge-delegate-recommend-wifi",
                d_kn,
                "Recommend a fix article for a guest Wi-Fi outage ticket.",
                "Still recommend-resolution; Executor will collect the ticket id if missing.",
                "resolution_knowledge_executor",
                "knowledge.recommend.resolution",
                "knowledge-recommend-resolution",
                "Recommend a resolution article for the focused guest Wi-Fi outage ticket.",
                tool_index,
            ),
        ]
    )

    d_ca = _sys_domain(defs["catalog_administration_domain"])
    conversations.extend(
        [
            _delegate(
                "catalog_administration_domain",
                "catalog-delegate-team-create",
                d_ca,
                "Create a new team called North America Billing.",
                "Team create is team_queue_crud_executor / team-create. Do not collect the label here.",
                "team_queue_crud_executor",
                "team.create",
                "team-create",
                "Create a team/queue named North America Billing.",
                tool_index,
            ),
            _delegate(
                "catalog_administration_domain",
                "catalog-delegate-analytics",
                d_ca,
                "How many open tickets were created today?",
                "NL metric value is analytics-query on analytics_audit_query_executor (ask_semantic_layer).",
                "analytics_audit_query_executor",
                "analytics.query",
                "analytics-query",
                "How many open tickets were created today?",
                tool_index,
            ),
            _delegate(
                "catalog_administration_domain",
                "catalog-delegate-customer",
                d_ca,
                "Add Jane Cooper to the customer directory, jane.cooper@acme.com.",
                "Directory create is customer_directory_crud_executor / customer-create.",
                "customer_directory_crud_executor",
                "customer.create",
                "customer-create",
                "Create directory customer Jane Cooper with email jane.cooper@acme.com.",
                tool_index,
            ),
        ]
    )

    # --- Executors (representative 3 skills / flows each) ---
    conversations.extend(_executor_samples(defs, tool_index))

    counts: dict[str, int] = {}
    for row in conversations:
        counts[row["agent"]] = counts.get(row["agent"], 0) + 1

    catalog = [_catalog_entry(defs[aid], tool_index) for aid in _ordered_agents() if aid in defs]
    _attach_full_tools_used(conversations, catalog, tool_index)

    return {
        "meta": {
            "product": "Worktual Ticketing",
            "source": "ai-agents harness (agent.md, SKILL.md, TOOL_ALLOWLIST, shared/ticketing_tool_catalog.json)",
            "generated_at": str(date.today()),
            "envelope": "Each sample is {messages, tools_used}. tools_used is the agent's full allowlist (catalog.tools), not only tools called in the trace.",
            "architecture": "1 Super + 5 Domain + 25 Executor Three-Layer Harness MAS",
            "excluded": [
                "Proactive short-codes (TCAA, RQA, CRDA, …) are not separate chat agents; they bind to these Executors.",
                "Coworker specialists (tickets/teams/kb/…) are the same tools under executor allowlists.",
            ],
            "assumptions": [
                "sample.tools_used always equals catalog.tools for that agent (full schemas), even if the trace only calls a subset.",
                "Super routes with route_to_domain (not route_to_agent).",
                "Domains delegate with delegate_to_executor (executor_id, task_id, skill_name, objective).",
                "Create-ticket order: customerName → contact → verify_ticket_customer → issue → confirm → create_ticket confirmed=true. Do not enrich before file.",
                "NL how-many / CSAT / SLA % use ask_semantic_layer on analytics-query, never list_tickets.",
                "KB authoring is catalog_administration_domain; knowledge_domain only recommends/detects.",
                "Resolution Quality Agent (RQA) chat surface is resolution_quality_executor; live trigger remains ticket.updated → Resolved.",
                "Never invent ids, ticket numbers, or mutation success without a tool result.",
            ],
            "conversation_counts": counts,
        },
        "catalog": catalog,
        "conversations": conversations,
    }


def _executor_samples(defs: dict[str, Any], tool_index: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    # ticket_creation — full collect loop (mirrors CCaaS queue-create depth)
    sys_tc = _sys_executor(defs["ticket_creation_executor"])
    out.append(
        _sample(
            "ticket_creation_executor",
            "ticket-create-guided",
            "ticket-create",
            [
                _msg_system(sys_tc),
                _msg_user(
                    "File a ticket for Priya Nair, priya.nair@acme.com — the VPN drops every few minutes."
                ),
                _msg_tool_call(
                    "Start create-ticket. Navigate so the progress panel is visible.",
                    "navigate",
                    {"view": "create-ticket"},
                ),
                _msg_tool("navigate", {"ok": True, "view": "create-ticket"}),
                _msg_tool_call(
                    "Name and email were supplied. Patch draft, then verify before asking for the issue.",
                    "patch_ticket_draft",
                    {
                        "customerName": "Priya Nair",
                        "contact": "priya.nair@acme.com",
                        "customerEmail": "priya.nair@acme.com",
                        "awaiting": "verify",
                    },
                ),
                _msg_tool(
                    "patch_ticket_draft",
                    {
                        "ok": True,
                        "customerName": "Priya Nair",
                        "customerEmail": "priya.nair@acme.com",
                    },
                ),
                _msg_tool_call(
                    "Contact is on the draft. Call verify_ticket_customer immediately.",
                    "verify_ticket_customer",
                    {
                        "customerName": "Priya Nair",
                        "contact": "priya.nair@acme.com",
                    },
                ),
                _msg_tool(
                    "verify_ticket_customer",
                    {
                        "exists": True,
                        "customerId": "c-441",
                        "name": "Priya Nair",
                        "email": "priya.nair@acme.com",
                    },
                ),
                _msg_say(
                    "Verified. Ask only for the issue. Do not ask subject/priority/queue.",
                    "<p>Priya Nair is in the directory. What is the issue you want to file?</p>",
                ),
                _msg_user("VPN drops every few minutes on the office SSID."),
                _msg_tool_call(
                    "Patch issue, then summarize. Do not create_ticket on this turn.",
                    "patch_ticket_draft",
                    {
                        "customerName": "Priya Nair",
                        "customerEmail": "priya.nair@acme.com",
                        "issue": "VPN drops every few minutes on the office SSID.",
                        "awaiting": "confirm",
                    },
                ),
                _msg_tool("patch_ticket_draft", {"ok": True, "ready": True}),
                _msg_say(
                    "Recap name, contact, issue and ask whether to file.",
                    "<p>Ready to file:</p><ul><li><strong>Customer:</strong> Priya Nair</li>"
                    "<li><strong>Contact:</strong> priya.nair@acme.com</li>"
                    "<li><strong>Issue:</strong> VPN drops every few minutes on the office SSID.</li></ul>"
                    "<p>Shall I file this ticket now?</p>",
                ),
                _msg_user("Yes, file it."),
                _msg_tool_call(
                    "Consent is semantic. Call create_ticket with confirmed=true. Do not enrich first.",
                    "create_ticket",
                    {
                        "customerName": "Priya Nair",
                        "customerEmail": "priya.nair@acme.com",
                        "description": "VPN drops every few minutes on the office SSID.",
                        "confirmed": True,
                    },
                ),
                _msg_tool(
                    "create_ticket",
                    {"ok": True, "ticket_number": "12880", "id": "12880"},
                ),
                _msg_say(
                    "Quote the ticket number from the tool result. Triage will enrich after insert.",
                    "<p>Ticket <strong>#12880</strong> is filed for Priya Nair. Subject, priority, and assignment will be completed by triage next.</p>",
                ),
            ],
            _tools_used_for(
                [
                    "navigate",
                    "patch_ticket_draft",
                    "verify_ticket_customer",
                    "create_ticket",
                    "return_to_super",
                ],
                tool_index,
            ),
        )
    )
    out.append(
        _exec_read(
            "ticket_creation_executor",
            "ticket-create-verify-miss",
            "customer-verify",
            sys_tc,
            "The customer is Sam Ortiz, sam.ortiz@example.net — check if they exist before I describe the issue.",
            "Name and email present. Verify directory before asking for the issue.",
            "verify_ticket_customer",
            {"customerName": "Sam Ortiz", "contact": "sam.ortiz@example.net"},
            {
                "exists": False,
                "message": "No matching customer record for sam.ortiz@example.net",
            },
            "Do not ask for issue. Offer to add the customer using collected name and contact.",
            "<p>There is no customer record for <strong>sam.ortiz@example.net</strong>. I can add Sam Ortiz with that email, then continue filing. Shall I add them?</p>",
            tool_index,
            ["verify_ticket_customer", "create_customer", "return_to_super"],
        )
    )
    out.append(
        _sample(
            "ticket_creation_executor",
            "ticket-create-park-howto",
            "ticket-create",
            [
                _msg_system(sys_tc),
                _msg_user("How do I reset my portal password? Don't file a ticket."),
                _msg_tool_call(
                    "How-to is not a create-ticket field. Park and return_to_super so Domain can deflect.",
                    "return_to_super",
                    {
                        "action": "park",
                        "query": "How do I reset my portal password? Don't file a ticket.",
                        "reason": "Self-service deflection is owned by ai_resolution_executor",
                    },
                ),
                _msg_tool("return_to_super", {"ok": True, "action": "park"}),
            ],
            _tools_used_for(["return_to_super"], tool_index),
        )
    )

    sys_ai = _sys_executor(defs["ai_resolution_executor"])
    out.append(
        _exec_read(
            "ai_resolution_executor",
            "deflect-password-reset",
            "intake-self-service-deflection",
            sys_ai,
            "How do I reset my Worktual portal password?",
            "Search published KB rather than inventing reset steps.",
            "list_kb",
            {"query": "portal password reset"},
            {
                "articles": [
                    {
                        "id": "kb-22",
                        "title": "Reset your Worktual portal password",
                        "status": "Published",
                    }
                ]
            },
            "Load the published article before answering.",
            "<p>Use <strong>Reset your Worktual portal password</strong>: open Sign in → Forgot password, enter your work email, then set a new password from the mailed link.</p>",
            tool_index,
            ["list_kb", "get_kb", "return_to_super"],
        )
    )
    out.append(
        _exec_read(
            "ai_resolution_executor",
            "deflect-get-article",
            "knowledge-search",
            sys_ai,
            "Open the SSO login failure article.",
            "Fetch the specific article after search. Do not invent steps.",
            "get_kb",
            {"article_id": "kb-18"},
            {
                "id": "kb-18",
                "title": "SSO login failures",
                "body": "Confirm IdP status, clear browser SSO cookies, retry with company IdP.",
            },
            "Quote only grounded article content.",
            "<p><strong>SSO login failures</strong>: confirm IdP status, clear browser SSO cookies, then retry with the company identity provider.</p>",
            tool_index,
            ["get_kb", "list_kb", "return_to_super"],
        )
    )
    out.append(
        _sample(
            "ai_resolution_executor",
            "deflect-handoff-create",
            "intake-self-service-deflection",
            [
                _msg_system(sys_ai),
                _msg_user("That didn't help — file a ticket for me."),
                _msg_tool_call(
                    "User now wants a ticket. Park and return_to_super for ticket-create.",
                    "return_to_super",
                    {
                        "action": "park",
                        "query": "File a ticket — self-service did not resolve the issue.",
                        "reason": "Create-ticket is owned by ticket_creation_executor",
                    },
                ),
                _msg_tool("return_to_super", {"ok": True, "action": "park"}),
            ],
            _tools_used_for(["return_to_super"], tool_index),
        )
    )

    sys_cp = _sys_executor(defs["classification_priority_executor"])
    out.append(
        _exec_read(
            "classification_priority_executor",
            "classify-12880",
            "ticket-classify-prioritize",
            sys_cp,
            "Classify and prioritize ticket #12880.",
            "Enrich owns subject/description/priority/queue. Call enrich_ticket.",
            "enrich_ticket",
            {"ticket_number": "12880"},
            {
                "ticket_number": "12880",
                "subject": "VPN drops on office SSID",
                "priority": "High",
                "queue": "Network Support",
                "category": "Connectivity",
            },
            "Report only tool fields. Do not invent assignees.",
            "<p>Ticket <strong>#12880</strong> is classified as <strong>High</strong> in Network Support: VPN drops on office SSID.</p>",
            tool_index,
            ["enrich_ticket", "get_ticket", "return_to_super"],
        )
    )
    out.append(
        _exec_read(
            "classification_priority_executor",
            "classify-get-first",
            "ticket-classify-prioritize",
            sys_cp,
            "What priority did triage set on #12880?",
            "Read current ticket before answering.",
            "get_ticket",
            {"ticket_number": "12880"},
            {
                "ticket_number": "12880",
                "priority": "High",
                "status": "Open",
                "queue": "Network Support",
            },
            "Quote priority from get_ticket.",
            "<p>#12880 is <strong>High</strong> priority, Open, on Network Support.</p>",
            tool_index,
        )
    )
    out.append(
        _exec_read(
            "classification_priority_executor",
            "classify-missing-id",
            "ticket-classify-prioritize",
            sys_cp,
            "Re-run classification on the VPN ticket.",
            "Ticket id missing. Ask one focused question; do not invent a number.",
            "list_tickets",
            {"query": "VPN", "limit": 5},
            {
                "tickets": [
                    {"ticket_number": "12880", "subject": "VPN drops on office SSID"},
                    {"ticket_number": "12701", "subject": "VPN client crash"},
                ]
            },
            "Offer only returned tickets.",
            "<p>Which ticket should I classify?</p><ul><li>#12880 — VPN drops on office SSID</li><li>#12701 — VPN client crash</li></ul>",
            tool_index,
            ["list_tickets", "enrich_ticket", "return_to_super"],
        )
    )

    sys_ia = _sys_executor(defs["intelligent_assignment_executor"])
    out.append(
        _exec_read(
            "intelligent_assignment_executor",
            "assign-best-12880",
            "ticket-assign-best",
            sys_ia,
            "Assign #12880 to the best L1 and L2.",
            "Never invent the assignee. Call auto_assign_ticket.",
            "auto_assign_ticket",
            {"ticket_number": "12880"},
            {
                "ticket_number": "12880",
                "assignee": "Alex Chen",
                "resolver": "Morgan Lee",
            },
            "Quote assignee and resolver from the tool result.",
            "<p>#12880 is assigned to <strong>Alex Chen</strong> (L1) with resolver <strong>Morgan Lee</strong>.</p>",
            tool_index,
        )
    )
    out.append(
        _exec_read(
            "intelligent_assignment_executor",
            "assign-list-agents",
            "ticket-assign-best",
            sys_ia,
            "Who is even eligible before we auto-assign #12880?",
            "List live agents; do not invent roster names.",
            "list_agents",
            {},
            {
                "agents": [
                    {"id": "2", "name": "Jane Smith", "role": "admin"},
                    {"id": "8", "name": "Alex Chen", "role": "agent"},
                    {"id": "9", "name": "Morgan Lee", "role": "resolver"},
                ]
            },
            "Offer only returned names. Auto-assign still owns the pick.",
            "<p>Eligible staff from the roster:</p><ul><li>Jane Smith</li><li>Alex Chen</li><li>Morgan Lee</li></ul><p>Shall I auto-assign #12880?</p>",
            tool_index,
            ["list_agents", "auto_assign_ticket", "return_to_super"],
        )
    )
    out.append(
        _exec_write_confirm(
            "intelligent_assignment_executor",
            "assign-confirm",
            "ticket-assign-best",
            sys_ia,
            "Go ahead and auto-assign #12880.",
            "<p>I will auto-assign <strong>#12880</strong> using routing (L1 and L2). Proceed?</p>",
            "Yes, assign it.",
            "auto_assign_ticket",
            {"ticket_number": "12880", "confirmed": True},
            {"ticket_number": "12880", "assignee": "Alex Chen", "resolver": "Morgan Lee"},
            "<p>#12880 is now with <strong>Alex Chen</strong> / resolver <strong>Morgan Lee</strong>.</p>",
            tool_index,
        )
    )

    sys_wl = _sys_executor(defs["workload_optimization_executor"])
    out.append(
        _exec_read(
            "workload_optimization_executor",
            "workload-queues",
            "routing-optimize-workload",
            sys_wl,
            "Billing queue looks overloaded.",
            "Read live queues before proposing a rebalance.",
            "list_queues",
            {},
            {
                "queues": [
                    {"name": "Billing", "open_tickets": 42, "sla_status": "At Risk"},
                    {"name": "Network Support", "open_tickets": 11, "sla_status": "On Track"},
                ]
            },
            "Ground the answer in returned open_tickets. Do not invent moves yet.",
            "<p><strong>Billing</strong> has 42 open tickets and is At Risk. Network Support has 11 and is On Track. I can propose a rebalance next if you want.</p>",
            tool_index,
        )
    )
    out.append(
        _exec_read(
            "workload_optimization_executor",
            "workload-list-open",
            "routing-optimize-workload",
            sys_wl,
            "Show Billing's unassigned tickets.",
            "List unassigned in that queue. Do not invent ticket numbers.",
            "list_tickets",
            {"queue": "Billing", "scope": "unassigned", "limit": 10},
            {
                "tickets": [
                    {"ticket_number": "12901", "subject": "Invoice PDF missing"},
                    {"ticket_number": "12914", "subject": "Duplicate charge"},
                ]
            },
            "Quote only returned rows.",
            "<p>Unassigned on Billing:</p><ul><li>#12901 — Invoice PDF missing</li><li>#12914 — Duplicate charge</li></ul>",
            tool_index,
        )
    )
    out.append(
        _sample(
            "workload_optimization_executor",
            "workload-park-learn",
            "routing-optimize-workload",
            [
                _msg_system(sys_wl),
                _msg_user("Also learn from last week's misroutes while you are at it."),
                _msg_tool_call(
                    "Learning is a different Skill. Park and return_to_super.",
                    "return_to_super",
                    {
                        "action": "park",
                        "query": "Learn from last week's misroutes.",
                        "reason": "routing-learn-from-outcomes is owned by root_cause_learning_executor",
                    },
                ),
                _msg_tool("return_to_super", {"ok": True, "action": "park"}),
            ],
            _tools_used_for(["return_to_super"], tool_index),
        )
    )

    sys_rc = _sys_executor(defs["root_cause_learning_executor"])
    out.extend(
        [
            _exec_read(
                "root_cause_learning_executor",
                "learn-outcomes",
                "routing-learn-from-outcomes",
                sys_rc,
                "What did we learn from recent routing outcomes?",
                "Use ontology/root-cause tools; do not invent drivers.",
                "ask_ontology",
                {"question": "Routing misroute drivers in the last 30 days"},
                {
                    "narrative": "Most misroutes came from Billing vs Collections queue overlap on invoice-PDF tickets."
                },
                "Quote the narrative. Do not mention ontology.",
                "<p>Recent misroutes cluster on invoice-PDF tickets being sent to Billing instead of Collections.</p>",
                tool_index,
                ["ask_ontology", "ask_semantic_layer", "return_to_super"],
            ),
            _exec_read(
                "root_cause_learning_executor",
                "learn-volume",
                "routing-learn-from-outcomes",
                sys_rc,
                "How many tickets were reassigned after first-touch last week?",
                "Counts need ask_semantic_layer.",
                "ask_semantic_layer",
                {"question": "Tickets reassigned after first-touch last week"},
                {"value": 17, "unit": "tickets"},
                "Quote the metric value only.",
                "<p>17 tickets were reassigned after first-touch last week.</p>",
                tool_index,
            ),
            _exec_read(
                "root_cause_learning_executor",
                "learn-ticket",
                "routing-learn-from-outcomes",
                sys_rc,
                "Did #12880 get misrouted?",
                "Read the ticket before judging routing.",
                "get_ticket",
                {"ticket_number": "12880"},
                {
                    "ticket_number": "12880",
                    "queue": "Network Support",
                    "assignee": "Alex Chen",
                    "reassign_count": 0,
                },
                "Grounded: no reassignment on this ticket.",
                "<p>#12880 is on Network Support with Alex Chen and has not been reassigned.</p>",
                tool_index,
            ),
        ]
    )

    sys_tl = _sys_executor(defs["ticket_lifecycle_executor"])
    out.append(
        _exec_read(
            "ticket_lifecycle_executor",
            "lifecycle-list-due-today",
            "ticket-read-search",
            sys_tl,
            "Show my open tickets due today.",
            "Browse rows with list_tickets. This is not a KPI count.",
            "list_tickets",
            {"scope": "assignee", "due": "today", "status": "Open", "limit": 20},
            {
                "tickets": [
                    {"ticket_number": "12880", "subject": "VPN drops", "due_at": "2026-09-09"},
                    {"ticket_number": "12841", "subject": "SSO timeout", "due_at": "2026-09-09"},
                ]
            },
            "List only returned tickets.",
            "<p>Open and due today:</p><ul><li>#12880 — VPN drops</li><li>#12841 — SSO timeout</li></ul>",
            tool_index,
        )
    )
    out.append(
        _exec_write_confirm(
            "ticket_lifecycle_executor",
            "lifecycle-resolve",
            "ticket-resolve-reopen",
            sys_tl,
            "Mark #12880 Resolved.",
            "<p>Mark <strong>#12880</strong> as Resolved? The ticket will stay in the workspace; add a note separately if you want.</p>",
            "Yes, resolve it.",
            "update_ticket",
            {"ticket_number": "12880", "status": "Resolved", "confirmed": True},
            {"ticket_number": "12880", "status": "Resolved"},
            "<p>#12880 is <strong>Resolved</strong>.</p>",
            tool_index,
            prelude=[
                _msg_tool_call(
                    "Read the ticket before mutating.",
                    "get_ticket",
                    {"ticket_number": "12880"},
                ),
                _msg_tool(
                    "get_ticket",
                    {"ticket_number": "12880", "status": "Open", "subject": "VPN drops on office SSID"},
                ),
            ],
        )
    )
    out.append(
        _exec_write_confirm(
            "ticket_lifecycle_executor",
            "lifecycle-note",
            "ticket-note-add",
            sys_tl,
            "Add an internal note on #12880: customer confirmed stable VPN after MTU change.",
            "<p>Internal note on <strong>#12880</strong>:</p><p>Customer confirmed stable VPN after MTU change.</p><p>Post this note?</p>",
            "Post it.",
            "add_ticket_note",
            {
                "ticket_number": "12880",
                "body": "Customer confirmed stable VPN after MTU change.",
                "visibility": "internal",
                "confirmed": True,
            },
            {"ok": True, "note_id": "n-90", "ticket_number": "12880"},
            "<p>Internal note is on #12880.</p>",
            tool_index,
        )
    )

    sys_sla = _sys_executor(defs["sla_escalation_executor"])
    out.extend(
        [
            _exec_read(
                "sla_escalation_executor",
                "sla-overdue",
                "sla-monitor-escalate",
                sys_sla,
                "Which tickets are overdue right now?",
                "List overdue tickets from live filters.",
                "list_tickets",
                {"due": "overdue", "limit": 10},
                {
                    "tickets": [
                        {"ticket_number": "12602", "subject": "SIP trunk down", "priority": "Critical"}
                    ]
                },
                "Quote returned overdue rows only.",
                "<p>Overdue:</p><ul><li>#12602 — SIP trunk down (Critical)</li></ul>",
                tool_index,
            ),
            _exec_write_confirm(
                "sla_escalation_executor",
                "sla-escalate",
                "sla-monitor-escalate",
                sys_sla,
                "Escalate #12602 — SIP has been down past SLA.",
                "<p>Escalate <strong>#12602</strong> for SLA breach on SIP trunk down?</p>",
                "Yes, escalate.",
                "escalate_ticket",
                {
                    "ticket_number": "12602",
                    "rationale": "SLA breached — SIP trunk still down",
                    "confirmed": True,
                },
                {"ticket_number": "12602", "escalated": True},
                "<p>#12602 is escalated for the SLA breach.</p>",
                tool_index,
            ),
            _exec_read(
                "sla_escalation_executor",
                "sla-directory",
                "sla-monitor-escalate",
                sys_sla,
                "Who is on the escalation directory for Network?",
                "Read escalation directory; do not invent names.",
                "list_escalation_directory",
                {"query": "Network"},
                {
                    "teams": [
                        {"name": "Network L2", "members": ["Morgan Lee", "Chris Patel"]}
                    ]
                },
                "Quote returned members.",
                "<p>Network L2 escalation: Morgan Lee, Chris Patel.</p>",
                tool_index,
                ["list_escalation_directory", "escalate_ticket", "return_to_super"],
            ),
        ]
    )

    sys_inv = _sys_executor(defs["investigation_summary_executor"])
    out.extend(
        [
            _exec_read(
                "investigation_summary_executor",
                "summary-progress",
                "ticket-investigation-summary",
                sys_inv,
                "Summarize investigation so far on #12880.",
                "Read progress/history before writing a summary.",
                "get_ticket_progress",
                {"ticket_number": "12880"},
                {
                    "ticket_number": "12880",
                    "events": [
                        "Created — VPN drops on office SSID",
                        "Assigned to Alex Chen",
                        "Note: MTU change pending customer confirm",
                    ],
                },
                "Summarize only returned events. TSAA-style ai_summary is not a human closing note.",
                "<p>#12880: VPN drops on office SSID, assigned to Alex Chen. Latest step is an MTU change waiting on customer confirm.</p>",
                tool_index,
                ["get_ticket_progress", "get_ticket", "list_ticket_notes", "return_to_super"],
            ),
            _exec_read(
                "investigation_summary_executor",
                "summary-notes",
                "ticket-investigation-summary",
                sys_inv,
                "What notes are already on #12880?",
                "List notes; do not invent bodies.",
                "list_ticket_notes",
                {"ticket_number": "12880"},
                {
                    "notes": [
                        {"id": "n-88", "visibility": "internal", "body": "MTU 1400 suggested"}
                    ]
                },
                "Quote returned notes.",
                "<p>Internal note on #12880: MTU 1400 suggested.</p>",
                tool_index,
            ),
            _exec_read(
                "investigation_summary_executor",
                "summary-get",
                "ticket-investigation-summary",
                sys_inv,
                "Give me the current snapshot of #12880.",
                "get_ticket for status/assignee/subject.",
                "get_ticket",
                {"ticket_number": "12880"},
                {
                    "ticket_number": "12880",
                    "status": "Open",
                    "assignee": "Alex Chen",
                    "subject": "VPN drops on office SSID",
                },
                "Quote snapshot fields.",
                "<p>#12880 is Open with Alex Chen — VPN drops on office SSID.</p>",
                tool_index,
            ),
        ]
    )

    sys_cr = _sys_executor(defs["customer_reply_drafting_executor"])
    out.extend(
        [
            _exec_read(
                "customer_reply_drafting_executor",
                "reply-draft-12880",
                "reply-draft",
                sys_cr,
                "Draft a customer reply on #12880 about the VPN workaround.",
                "Read ticket + notes, then draft. Do not send publicly unless asked.",
                "get_ticket",
                {"ticket_number": "12880"},
                {
                    "ticket_number": "12880",
                    "customer": "Priya Nair",
                    "subject": "VPN drops on office SSID",
                    "status": "Open",
                },
                "Ground the draft in ticket facts. Keep it customer-facing.",
                "<p>Draft for Priya Nair on #12880:</p><p>We narrowed this to an MTU issue on the office SSID. Please set the VPN adapter MTU to 1400, reconnect, and tell us if the drops stop.</p><p>Send this reply?</p>",
                tool_index,
                ["get_ticket", "list_ticket_notes", "add_ticket_note", "return_to_super"],
            ),
            _exec_write_confirm(
                "customer_reply_drafting_executor",
                "reply-post-internal",
                "reply-draft",
                sys_cr,
                "Save that VPN workaround as an internal note, don't email the customer yet.",
                "<p>Save this as an <strong>internal</strong> note on #12880 (not a public reply)?</p>",
                "Yes, internal only.",
                "add_ticket_note",
                {
                    "ticket_number": "12880",
                    "body": "Drafted customer reply: set VPN MTU to 1400 and reconnect.",
                    "visibility": "internal",
                    "confirmed": True,
                },
                {"ok": True, "note_id": "n-91"},
                "<p>Internal note saved on #12880. Nothing was sent to the customer.</p>",
                tool_index,
            ),
            _exec_read(
                "customer_reply_drafting_executor",
                "reply-macros",
                "reply-draft",
                sys_cr,
                "Is there a macro I should use instead of a freeform reply?",
                "List macros; do not invent titles.",
                "list_macros",
                {},
                {
                    "macros": [
                        {"id": "m-4", "title": "VPN MTU workaround"},
                        {"id": "m-9", "title": "SSO cookie reset"},
                    ]
                },
                "Offer returned macros only.",
                "<p>Available macros:</p><ul><li>VPN MTU workaround</li><li>SSO cookie reset</li></ul>",
                tool_index,
                ["list_macros", "return_to_super"],
            ),
        ]
    )

    sys_ar = _sys_executor(defs["autonomous_resolution_executor"])
    out.extend(
        [
            _exec_read(
                "autonomous_resolution_executor",
                "auto-res-check",
                "ticket-autonomous-resolution",
                sys_ar,
                "Can #12880 be auto-resolved from matching KB?",
                "Read ticket and recommendations. Do not resolve without evidence + policy.",
                "list_ticket_recommendations",
                {"ticket_number": "12880"},
                {
                    "recommendations": [
                        {"article_id": "kb-22", "title": "VPN MTU workaround", "score": 0.81}
                    ]
                },
                "Recommend; do not call update_ticket yet.",
                "<p>#12880 has a strong match: <strong>VPN MTU workaround</strong>. I can apply that as a suggested resolution, but I will not mark Resolved unless you confirm.</p>",
                tool_index,
            ),
            _exec_write_confirm(
                "autonomous_resolution_executor",
                "auto-res-apply",
                "ticket-autonomous-resolution",
                sys_ar,
                "Apply the KB workaround and resolve #12880.",
                "<p>Apply the VPN MTU workaround and mark <strong>#12880 Resolved</strong>?</p>",
                "Yes, resolve it.",
                "update_ticket",
                {"ticket_number": "12880", "status": "Resolved", "confirmed": True},
                {"ticket_number": "12880", "status": "Resolved"},
                "<p>#12880 is Resolved using the VPN MTU workaround.</p>",
                tool_index,
            ),
            _exec_read(
                "autonomous_resolution_executor",
                "auto-res-kb",
                "ticket-autonomous-resolution",
                sys_ar,
                "Show the matching article body before we resolve.",
                "get_kb for the recommended article.",
                "get_kb",
                {"article_id": "kb-22"},
                {
                    "id": "kb-22",
                    "title": "VPN MTU workaround",
                    "body": "Set adapter MTU to 1400 and reconnect.",
                },
                "Quote article body only.",
                "<p><strong>VPN MTU workaround</strong>: set adapter MTU to 1400 and reconnect.</p>",
                tool_index,
            ),
        ]
    )

    sys_rqa = _sys_executor(defs["resolution_quality_executor"])
    out.extend(
        [
            _exec_read(
                "resolution_quality_executor",
                "rqa-weak-docs",
                "ticket-resolution-quality",
                sys_rqa,
                "Ticket #12880 just moved to Resolved. Are the closing notes good enough?",
                "ai_summary is not enough. Read ticket, notes, and progress.",
                "list_ticket_notes",
                {"ticket_number": "12880"},
                {"notes": []},
                "No human closing note. Do not invent a fix. Ask to draft an internal note.",
                "<p>#12880 is Resolved but has no closing note. I can draft an internal note from the investigation timeline — I will not invent a fix or change the status. Shall I draft it?</p>",
                tool_index,
                ["list_ticket_notes", "get_ticket", "get_ticket_progress", "add_ticket_note", "return_to_super"],
            ),
            _exec_write_confirm(
                "resolution_quality_executor",
                "rqa-post-note",
                "ticket-resolution-quality",
                sys_rqa,
                "Draft and post an internal closing note from what we actually did.",
                "<p>Proposed internal closing note on #12880:</p><p>Customer VPN drops on office SSID. Workaround: set adapter MTU to 1400; customer confirmed stability. Ticket remains Resolved.</p><p>Post this internal note?</p>",
                "Confirm note.",
                "add_ticket_note",
                {
                    "ticket_number": "12880",
                    "body": "Customer VPN drops on office SSID. Workaround: set adapter MTU to 1400; customer confirmed stability.",
                    "visibility": "internal",
                    "confirmed": True,
                },
                {"ok": True, "note_id": "n-92"},
                "<p>Internal closing note posted on #12880. Status stays Resolved.</p>",
                tool_index,
                prelude=[
                    _msg_tool_call(
                        "Ground the draft in progress, never invent a fix.",
                        "get_ticket_progress",
                        {"ticket_number": "12880"},
                    ),
                    _msg_tool(
                        "get_ticket_progress",
                        {
                            "events": [
                                "Assigned to Alex Chen",
                                "MTU 1400 suggested",
                                "Customer confirmed stable VPN",
                            ]
                        },
                    ),
                ],
            ),
            _exec_read(
                "resolution_quality_executor",
                "rqa-strong-docs",
                "ticket-resolution-quality",
                sys_rqa,
                "Check #12755 — it was resolved with a detailed note already.",
                "If notes already document the fix, stay silent / say documentation is sufficient.",
                "list_ticket_notes",
                {"ticket_number": "12755"},
                {
                    "notes": [
                        {
                            "body": "Root cause: expired IdP cert. Replaced cert; SSO login verified with customer at 16:02.",
                            "visibility": "internal",
                        }
                    ]
                },
                "Strong docs → no extra note.",
                "<p>#12755 already has a grounded closing note (expired IdP cert replaced; SSO verified). No extra note needed.</p>",
                tool_index,
            ),
        ]
    )

    sys_pn = _sys_executor(defs["personalized_notification_executor"])
    out.extend(
        [
            _exec_read(
                "personalized_notification_executor",
                "pna-inbox",
                "notification-inbox-read",
                sys_pn,
                "What notifications are waiting for me?",
                "Read inbox before answering.",
                "list_notifications",
                {},
                {
                    "notifications": [
                        {"id": "nt-1", "title": "#12880 assigned to you", "read": False}
                    ]
                },
                "Quote returned notifications.",
                "<p>Unread: #12880 assigned to you.</p>",
                tool_index,
                ["list_notifications", "send_staff_notification", "return_to_super"],
            ),
            _exec_read(
                "personalized_notification_executor",
                "pna-prefs",
                "notification-personalize-deliver",
                sys_pn,
                "Do I have SLA alerts enabled?",
                "Read user preferences.",
                "get_user_preferences",
                {},
                {"notify_sla_alerts": True, "notify_ticket_assignments": True},
                "Quote preference flags.",
                "<p>SLA alerts and ticket assignment notifications are on.</p>",
                tool_index,
                ["get_user_preferences", "update_user_preference", "return_to_super"],
            ),
            _exec_write_confirm(
                "personalized_notification_executor",
                "pna-send",
                "notification-personalize-deliver",
                sys_pn,
                "Ping Alex Chen that #12880 is waiting on the MTU test.",
                "<p>Send Alex Chen a staff notification that #12880 is waiting on the MTU test?</p>",
                "Send it.",
                "send_staff_notification",
                {
                    "user_id": "8",
                    "title": "#12880 waiting on MTU test",
                    "body": "Customer is testing MTU 1400 on #12880.",
                    "confirmed": True,
                },
                {"ok": True, "id": "nt-44"},
                "<p>Notification sent to Alex Chen about #12880.</p>",
                tool_index,
            ),
        ]
    )

    sys_in = _sys_executor(defs["insights_analytics_executor"])
    out.extend(
        [
            _exec_read(
                "insights_analytics_executor",
                "insights-why",
                "analytics-generate-insights",
                sys_in,
                "Why is Billing at risk this week?",
                "Narrative why uses ask_ontology; do not invent drivers.",
                "ask_ontology",
                {"question": "Why is the Billing queue at risk this week?"},
                {
                    "narrative": "Invoice-PDF tickets doubled while two Billing agents were off shift."
                },
                "Quote narrative. Do not name the ontology gateway.",
                "<p>Billing is at risk because invoice-PDF volume doubled while two Billing agents were off shift.</p>",
                tool_index,
                ["ask_ontology", "ask_semantic_layer", "return_to_super"],
            ),
            _exec_read(
                "insights_analytics_executor",
                "insights-value",
                "analytics-generate-insights",
                sys_in,
                "How many Billing tickets were created this week, and why is volume up?",
                "Value from semantic layer first.",
                "ask_semantic_layer",
                {"question": "How many Billing tickets were created this week?"},
                {"value": 86, "unit": "tickets"},
                "Then ontology for why — this sample records the value turn.",
                "<p>86 Billing tickets were created this week. I can pull the drivers next if you want the why.</p>",
                tool_index,
            ),
            _exec_read(
                "insights_analytics_executor",
                "insights-chart",
                "analytics-generate-insights",
                sys_in,
                "Show the dashboard created-vs-resolved chart for 7 days.",
                "Structured chart uses get_dashboard_chart, not NL counts.",
                "get_dashboard_chart",
                {"range": "7days"},
                {"created": [12, 9, 11, 8, 14, 6, 7], "resolved": [10, 8, 12, 9, 11, 7, 8]},
                "Describe returned series; do not invent extra days.",
                "<p>Last 7 days created vs resolved is on the dashboard chart (created peaked at 14; resolved stayed close each day).</p>",
                tool_index,
                ["get_dashboard_chart", "return_to_super"],
            ),
        ]
    )

    sys_rk = _sys_executor(defs["resolution_knowledge_executor"])
    out.extend(
        [
            _exec_read(
                "resolution_knowledge_executor",
                "recommend-12880",
                "knowledge-recommend-resolution",
                sys_rk,
                "What article should we send for #12880?",
                "Recommend from ticket + KB search. Do not author a new article.",
                "list_kb",
                {"query": "VPN MTU office SSID"},
                {
                    "articles": [
                        {"id": "kb-22", "title": "VPN MTU workaround", "status": "Published"}
                    ]
                },
                "Recommend the returned published article.",
                "<p>Send <strong>VPN MTU workaround</strong> for #12880.</p>",
                tool_index,
                ["list_kb", "get_kb", "get_ticket", "return_to_super"],
            ),
            _exec_read(
                "resolution_knowledge_executor",
                "recommend-get",
                "knowledge-recommend-resolution",
                sys_rk,
                "Open that VPN MTU article.",
                "get_kb for the recommended id.",
                "get_kb",
                {"article_id": "kb-22"},
                {
                    "id": "kb-22",
                    "title": "VPN MTU workaround",
                    "body": "Set adapter MTU to 1400 and reconnect.",
                },
                "Quote body.",
                "<p><strong>VPN MTU workaround</strong>: set adapter MTU to 1400 and reconnect.</p>",
                tool_index,
            ),
            _sample(
                "resolution_knowledge_executor",
                "recommend-park-author",
                "knowledge-recommend-resolution",
                [
                    _msg_system(sys_rk),
                    _msg_user("Create a new KB article from this ticket."),
                    _msg_tool_call(
                        "Authoring is catalog KB CRUD. Park and return_to_super.",
                        "return_to_super",
                        {
                            "action": "park",
                            "query": "Create a new KB article from this ticket.",
                            "reason": "KB authoring is kb_quality_crud_executor",
                        },
                    ),
                    _msg_tool("return_to_super", {"ok": True, "action": "park"}),
                ],
                _tools_used_for(["return_to_super"], tool_index),
            ),
        ]
    )

    sys_st = _sys_executor(defs["similar_ticket_detection_executor"])
    out.extend(
        [
            _exec_read(
                "similar_ticket_detection_executor",
                "similar-12880",
                "ticket-detect-similar",
                sys_st,
                "Find similar past tickets to #12880.",
                "Search related tickets; do not invent numbers.",
                "list_tickets",
                {"query": "VPN drops office SSID", "limit": 5},
                {
                    "tickets": [
                        {"ticket_number": "11002", "subject": "VPN drop after Wi-Fi roam", "status": "Resolved"},
                        {"ticket_number": "12110", "subject": "Office SSID VPN timeout", "status": "Resolved"},
                    ]
                },
                "Cite only returned tickets.",
                "<p>Similar resolved tickets:</p><ul><li>#11002 — VPN drop after Wi-Fi roam</li><li>#12110 — Office SSID VPN timeout</li></ul>",
                tool_index,
            ),
            _exec_read(
                "similar_ticket_detection_executor",
                "similar-get",
                "ticket-detect-similar",
                sys_st,
                "Open #11002 so I can copy the fix.",
                "get_ticket for the similar id returned earlier.",
                "get_ticket",
                {"ticket_number": "11002"},
                {
                    "ticket_number": "11002",
                    "status": "Resolved",
                    "subject": "VPN drop after Wi-Fi roam",
                },
                "Quote returned snapshot.",
                "<p>#11002 is Resolved — VPN drop after Wi-Fi roam.</p>",
                tool_index,
            ),
            _exec_read(
                "similar_ticket_detection_executor",
                "similar-notes",
                "ticket-detect-similar",
                sys_st,
                "What was the closing note on #11002?",
                "list_ticket_notes on the similar ticket.",
                "list_ticket_notes",
                {"ticket_number": "11002"},
                {
                    "notes": [
                        {"body": "Set MTU 1400; customer confirmed.", "visibility": "internal"}
                    ]
                },
                "Quote the note.",
                "<p>#11002 closing note: set MTU 1400; customer confirmed.</p>",
                tool_index,
                ["list_ticket_notes", "return_to_super"],
            ),
        ]
    )

    sys_tm = _sys_executor(defs["team_queue_crud_executor"])
    out.append(
        _exec_write_confirm(
            "team_queue_crud_executor",
            "team-create",
            "team-create",
            sys_tm,
            "Create a team called North America Billing.",
            "<p>Create team <strong>North America Billing</strong>?</p>",
            "Yes, create it.",
            "create_queue",
            {"name": "North America Billing", "confirmed": True},
            {"id": "q-778", "name": "North America Billing"},
            "<p>Team <strong>North America Billing</strong> is created.</p>",
            tool_index,
            prelude=[
                _msg_tool_call(
                    "Collect a short label — user already supplied the name. Do not invent members.",
                    "patch_team_draft",
                    {"name": "North America Billing", "awaiting": "confirm"},
                ),
                _msg_tool("patch_team_draft", {"ok": True, "name": "North America Billing"}),
            ],
        )
    )
    out.append(
        _exec_read(
            "team_queue_crud_executor",
            "team-list",
            "team-read",
            sys_tm,
            "List our teams.",
            "list_queues returns live teams.",
            "list_queues",
            {},
            {
                "queues": [
                    {"name": "Billing", "open_tickets": 42},
                    {"name": "Network Support", "open_tickets": 11},
                ]
            },
            "Quote returned teams.",
            "<p>Teams:</p><ul><li>Billing — 42 open</li><li>Network Support — 11 open</li></ul>",
            tool_index,
        )
    )
    out.append(
        _exec_write_confirm(
            "team_queue_crud_executor",
            "team-add-member",
            "team-members-update",
            sys_tm,
            "Add Alex Chen to North America Billing.",
            "<p>Add <strong>Alex Chen</strong> to North America Billing?</p>",
            "Yes, add Alex.",
            "update_queue",
            {
                "name": "North America Billing",
                "add_members": ["Alex Chen"],
                "confirmed": True,
            },
            {"id": "q-778", "name": "North America Billing", "members": ["Alex Chen"]},
            "<p>Alex Chen is on North America Billing.</p>",
            tool_index,
            prelude=[
                _msg_tool_call("Confirm the person exists on the roster.", "list_agents", {}),
                _msg_tool(
                    "list_agents",
                    {"agents": [{"id": "8", "name": "Alex Chen"}]},
                ),
            ],
        )
    )

    sys_kb = _sys_executor(defs["kb_quality_crud_executor"])
    out.extend(
        [
            _exec_read(
                "kb_quality_crud_executor",
                "kb-list",
                "knowledge-read",
                sys_kb,
                "List published knowledge articles about VPN.",
                "list_kb with the query.",
                "list_kb",
                {"query": "VPN"},
                {
                    "articles": [
                        {"id": "kb-22", "title": "VPN MTU workaround", "status": "Published"}
                    ]
                },
                "Quote returned articles.",
                "<p>Published: <strong>VPN MTU workaround</strong>.</p>",
                tool_index,
            ),
            _exec_write_confirm(
                "kb_quality_crud_executor",
                "kb-create",
                "knowledge-article-create",
                sys_kb,
                "Create an article titled Guest Wi-Fi outage checklist.",
                "<p>Create KB article <strong>Guest Wi-Fi outage checklist</strong>? I'll collect the body next unless you already have it.</p>",
                "Title is enough to start — create the draft article.",
                "create_kb_article",
                {"title": "Guest Wi-Fi outage checklist", "confirmed": True},
                {"id": "kb-40", "title": "Guest Wi-Fi outage checklist", "status": "Draft"},
                "<p>Draft article <strong>Guest Wi-Fi outage checklist</strong> is created (kb-40). It is not published yet.</p>",
                tool_index,
            ),
            _exec_write_confirm(
                "kb_quality_crud_executor",
                "kb-publish",
                "knowledge-article-publish",
                sys_kb,
                "Publish kb-40.",
                "<p>Publish <strong>Guest Wi-Fi outage checklist</strong> (kb-40)?</p>",
                "Publish it.",
                "publish_kb_article",
                {"article_id": "kb-40", "confirmed": True},
                {"id": "kb-40", "status": "Published"},
                "<p>kb-40 is Published.</p>",
                tool_index,
            ),
        ]
    )

    sys_mc = _sys_executor(defs["macro_crud_executor"])
    out.extend(
        [
            _exec_read(
                "macro_crud_executor",
                "macro-list",
                "macro-read",
                sys_mc,
                "What macros do we have?",
                "list_macros; do not invent titles.",
                "list_macros",
                {},
                {
                    "macros": [
                        {"id": "m-4", "title": "VPN MTU workaround"},
                        {"id": "m-9", "title": "SSO cookie reset"},
                    ]
                },
                "Quote returned macros.",
                "<p>Macros:</p><ul><li>VPN MTU workaround</li><li>SSO cookie reset</li></ul>",
                tool_index,
            ),
            _exec_write_confirm(
                "macro_crud_executor",
                "macro-create",
                "macro-create",
                sys_mc,
                "Create a macro titled Hold for vendor, body We are waiting on the vendor and will update you.",
                "<p>Create macro:</p><ul><li><strong>Title:</strong> Hold for vendor</li><li><strong>Body:</strong> We are waiting on the vendor and will update you.</li></ul><p>Create it?</p>",
                "Create it.",
                "create_macro",
                {
                    "title": "Hold for vendor",
                    "body": "We are waiting on the vendor and will update you.",
                    "confirmed": True,
                },
                {"id": "m-12", "title": "Hold for vendor"},
                "<p>Macro <strong>Hold for vendor</strong> is created.</p>",
                tool_index,
                prelude=[
                    _msg_tool_call(
                        "Title and body must be distinct. Patch draft then confirm.",
                        "patch_macro_draft",
                        {
                            "title": "Hold for vendor",
                            "body": "We are waiting on the vendor and will update you.",
                        },
                    ),
                    _msg_tool("patch_macro_draft", {"ok": True}),
                ],
            ),
            _exec_write_confirm(
                "macro_crud_executor",
                "macro-delete",
                "macro-delete",
                sys_mc,
                "Delete the Hold for vendor macro.",
                "<p>Delete macro <strong>Hold for vendor</strong> (m-12)? This cannot be undone.</p>",
                "Yes, delete it.",
                "delete_macro",
                {"macro_id": "m-12", "confirmed": True},
                {"ok": True, "id": "m-12"},
                "<p>Macro Hold for vendor is deleted.</p>",
                tool_index,
            ),
        ]
    )

    sys_cu = _sys_executor(defs["customer_directory_crud_executor"])
    out.extend(
        [
            _exec_write_confirm(
                "customer_directory_crud_executor",
                "customer-create",
                "customer-create",
                sys_cu,
                "Add Jane Cooper, jane.cooper@acme.com.",
                "<p>Add directory customer <strong>Jane Cooper</strong> &lt;jane.cooper@acme.com&gt;?</p>",
                "Yes, add her.",
                "create_customer",
                {
                    "name": "Jane Cooper",
                    "email": "jane.cooper@acme.com",
                    "confirmed": True,
                },
                {"id": "c-502", "name": "Jane Cooper", "email": "jane.cooper@acme.com"},
                "<p>Jane Cooper is in the directory.</p>",
                tool_index,
            ),
            _exec_read(
                "customer_directory_crud_executor",
                "customer-360",
                "customer-read-360",
                sys_cu,
                "Show 360 for jane.cooper@acme.com.",
                "get_customer_360; do not invent tickets.",
                "get_customer_360",
                {"email": "jane.cooper@acme.com"},
                {
                    "name": "Jane Cooper",
                    "email": "jane.cooper@acme.com",
                    "open_tickets": 1,
                    "tickets": [{"ticket_number": "12920", "status": "Open"}],
                },
                "Quote returned 360 fields.",
                "<p>Jane Cooper has 1 open ticket: #12920.</p>",
                tool_index,
            ),
            _sample(
                "customer_directory_crud_executor",
                "customer-import-picker",
                "customer-import",
                [
                    _msg_system(sys_cu),
                    _msg_user("Import customers from a CSV."),
                    _msg_tool_call(
                        "Open the file picker. Do not invent rows.",
                        "open_customer_import",
                        {},
                    ),
                    _msg_tool("open_customer_import", {"ok": True}),
                    _msg_say(
                        "Wait for the upload. Do not claim import succeeded yet.",
                        "<p>Choose a CSV, TSV, or Excel file to import customers.</p>",
                    ),
                ],
                _tools_used_for(
                    ["open_customer_import", "import_customers", "return_to_super"],
                    tool_index,
                ),
            ),
        ]
    )

    sys_ps = _sys_executor(defs["priority_status_crud_executor"])
    out.extend(
        [
            _exec_read(
                "priority_status_crud_executor",
                "priority-list",
                "priority-read",
                sys_ps,
                "List our priorities.",
                "list_priorities from Postgres. Never invent labels.",
                "list_priorities",
                {},
                {
                    "priorities": [
                        {"id": "p-1", "name": "Low", "hours": 72},
                        {"id": "p-2", "name": "Medium", "hours": 24},
                        {"id": "p-3", "name": "High", "hours": 8},
                        {"id": "p-4", "name": "Critical", "hours": 4},
                    ]
                },
                "Quote returned catalog rows.",
                "<p>Priorities:</p><ul><li>Low — 72h</li><li>Medium — 24h</li><li>High — 8h</li><li>Critical — 4h</li></ul>",
                tool_index,
            ),
            _exec_write_confirm(
                "priority_status_crud_executor",
                "priority-create",
                "priority-create",
                sys_ps,
                "Add a priority called Urgent with 2 hour SLA.",
                "<p>Create priority <strong>Urgent</strong> with 2 hour SLA?</p>",
                "Yes, create Urgent.",
                "create_priority",
                {"name": "Urgent", "resolution_hours": 2, "confirmed": True},
                {"id": "p-5", "name": "Urgent", "hours": 2},
                "<p>Priority <strong>Urgent</strong> (2h) is created.</p>",
                tool_index,
                prelude=[
                    _msg_tool_call(
                        "User supplied label and hours. Patch draft then confirm. Do not treat the start sentence as a placeholder invent.",
                        "patch_priority_draft",
                        {"name": "Urgent", "resolution_hours": 2},
                    ),
                    _msg_tool("patch_priority_draft", {"ok": True}),
                ],
            ),
            _exec_read(
                "priority_status_crud_executor",
                "status-list",
                "status-read",
                sys_ps,
                "What ticket statuses exist?",
                "list_statuses from catalog.",
                "list_statuses",
                {},
                {
                    "statuses": [
                        {"name": "Open"},
                        {"name": "Pending"},
                        {"name": "Resolved"},
                    ]
                },
                "Quote returned statuses.",
                "<p>Statuses: Open, Pending, Resolved.</p>",
                tool_index,
                ["list_statuses", "return_to_super"],
            ),
        ]
    )

    sys_org = _sys_executor(defs["org_settings_integrations_executor"])
    out.extend(
        [
            _exec_read(
                "org_settings_integrations_executor",
                "org-prefs-read",
                "org-preferences-read",
                sys_org,
                "What is our portal auth mode?",
                "get_org_preferences.",
                "get_org_preferences",
                {},
                {"portal_auth_mode": "otp", "ticket_prefix": "#"},
                "Quote returned prefs.",
                "<p>Portal auth mode is <strong>otp</strong>. Ticket prefix is #.</p>",
                tool_index,
            ),
            _exec_read(
                "org_settings_integrations_executor",
                "org-widgets",
                "integration-widget-read",
                sys_org,
                "List help widgets.",
                "list_widgets; do not invent public ids.",
                "list_widgets",
                {},
                {"widgets": [{"id": "wgt_12", "name": "Main site widget"}]},
                "Quote returned widgets.",
                "<p>Help widget: Main site widget.</p>",
                tool_index,
                ["list_widgets", "return_to_super"],
            ),
            _exec_write_confirm(
                "org_settings_integrations_executor",
                "org-key-create",
                "integration-key-create",
                sys_org,
                "Create an intake API key for CCaaS.",
                "<p>Create a new integration API key for CCaaS intake? The secret is shown once.</p>",
                "Create the key.",
                "create_integration_key",
                {"name": "CCaaS intake", "confirmed": True},
                {"id": "key-3", "prefix": "wt_live_ab", "secret": "wt_live_ab…redacted"},
                "<p>API key created (prefix wt_live_ab). Copy the secret now — it will not be shown again.</p>",
                tool_index,
            ),
        ]
    )

    sys_ni = _sys_executor(defs["notification_inbox_executor"])
    out.extend(
        [
            _exec_read(
                "notification_inbox_executor",
                "inbox-read",
                "notification-inbox-read",
                sys_ni,
                "Show my notifications.",
                "list_notifications.",
                "list_notifications",
                {},
                {
                    "notifications": [
                        {"id": "nt-1", "title": "#12880 assigned to you", "read": False},
                        {"id": "nt-2", "title": "SLA warning #12602", "read": False},
                    ]
                },
                "Quote returned inbox rows.",
                "<p>Unread:</p><ul><li>#12880 assigned to you</li><li>SLA warning #12602</li></ul>",
                tool_index,
            ),
            _exec_write_confirm(
                "notification_inbox_executor",
                "inbox-mark-read",
                "notification-mark-read",
                sys_ni,
                "Mark the assignment notification as read.",
                "<p>Mark <strong>#12880 assigned to you</strong> as read?</p>",
                "Yes.",
                "mark_notification_read",
                {"notification_id": "nt-1", "confirmed": True},
                {"ok": True, "id": "nt-1", "read": True},
                "<p>That notification is marked read.</p>",
                tool_index,
            ),
            _exec_write_confirm(
                "notification_inbox_executor",
                "inbox-clear",
                "notification-clear",
                sys_ni,
                "Clear all notifications.",
                "<p>Clear the entire notification inbox?</p>",
                "Clear them.",
                "clear_notifications",
                {"confirmed": True},
                {"ok": True, "cleared": 2},
                "<p>Inbox cleared (2 notifications).</p>",
                tool_index,
            ),
        ]
    )

    sys_aa = _sys_executor(defs["analytics_audit_query_executor"])
    out.extend(
        [
            _exec_read(
                "analytics_audit_query_executor",
                "analytics-query-open-today",
                "analytics-query",
                sys_aa,
                "How many open tickets were created today?",
                "NL count must use ask_semantic_layer, not get_metrics or list_tickets.",
                "ask_semantic_layer",
                {"question": "How many open tickets were created today?"},
                {"value": 6, "unit": "tickets"},
                "Quote the metric value.",
                "<p>6 open tickets were created today.</p>",
                tool_index,
                ["ask_semantic_layer", "ask_ontology", "return_to_super"],
            ),
            _exec_read(
                "analytics_audit_query_executor",
                "analytics-root-cause",
                "analytics-root-cause",
                sys_aa,
                "Why did CSAT drop this month?",
                "Why/drivers use ask_ontology.",
                "ask_ontology",
                {"question": "Why did CSAT drop this month?"},
                {
                    "narrative": "CSAT dipped on Billing contacts after invoice-PDF failures exceeded one-touch resolution."
                },
                "Quote narrative. Do not mention ontology.",
                "<p>CSAT dipped on Billing contacts after invoice-PDF failures stopped being solved on first touch.</p>",
                tool_index,
            ),
            _exec_read(
                "analytics_audit_query_executor",
                "dashboard-snapshot",
                "dashboard-metrics-read",
                sys_aa,
                "Give me the home dashboard snapshot.",
                "Structured Home snapshot uses get_metrics, not NL semantic.",
                "get_metrics",
                {},
                {"open": 28, "overdue": 3, "unassigned": 5, "created_today": 6},
                "Quote returned snapshot keys.",
                "<p>Dashboard: 28 open, 3 overdue, 5 unassigned, 6 created today.</p>",
                tool_index,
                ["get_metrics", "return_to_super"],
            ),
        ]
    )

    sys_au = _sys_executor(defs["automation_rule_crud_executor"])
    out.extend(
        [
            _exec_read(
                "automation_rule_crud_executor",
                "automation-list",
                "automation-rule-read",
                sys_au,
                "List automation rules.",
                "list_automation_rules.",
                "list_automation_rules",
                {},
                {
                    "rules": [
                        {
                            "id": "ar-1",
                            "name": "Urgent → Network L2",
                            "event": "ticket.created",
                        }
                    ]
                },
                "Quote returned rules.",
                "<p>Rule: Urgent → Network L2 on ticket.created.</p>",
                tool_index,
            ),
            _exec_write_confirm(
                "automation_rule_crud_executor",
                "automation-create",
                "automation-rule-create",
                sys_au,
                "Create a rule: when a ticket is created with priority Critical, assign Network L2.",
                "<p>Create automation <strong>Critical → Network L2</strong> on ticket.created?</p>",
                "Create it.",
                "create_automation_rule",
                {
                    "name": "Critical → Network L2",
                    "event": "ticket.created",
                    "confirmed": True,
                },
                {"id": "ar-2", "name": "Critical → Network L2"},
                "<p>Automation <strong>Critical → Network L2</strong> is created.</p>",
                tool_index,
            ),
            _exec_write_confirm(
                "automation_rule_crud_executor",
                "automation-delete",
                "automation-rule-delete",
                sys_au,
                "Delete the Urgent → Network L2 rule.",
                "<p>Delete automation <strong>Urgent → Network L2</strong> (ar-1)?</p>",
                "Yes, delete it.",
                "delete_automation_rule",
                {"rule_id": "ar-1", "confirmed": True},
                {"ok": True, "id": "ar-1"},
                "<p>Rule Urgent → Network L2 is deleted.</p>",
                tool_index,
            ),
        ]
    )

    return out


def main() -> None:
    payload = build()
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    counts = payload["meta"]["conversation_counts"]
    print(f"Wrote {OUT}")
    print(f"catalog={len(payload['catalog'])} conversations={len(payload['conversations'])}")
    print("counts", json.dumps(counts, indent=2))
    missing = [c["name"] for c in payload["catalog"] if counts.get(c["name"], 0) < 3]
    if missing:
        raise SystemExit(f"agents with fewer than 3 samples: {missing}")
    by_name = {c["name"]: c for c in payload["catalog"]}
    for conv in payload["conversations"]:
        expected = list(by_name[conv["agent"]]["tools"])
        got = [t["function"]["name"] for t in conv["sample"]["tools_used"]]
        if got != expected:
            raise SystemExit(
                f"{conv['agent']} {conv['id']}: tools_used {got} != catalog.tools {expected}"
            )


if __name__ == "__main__":
    main()

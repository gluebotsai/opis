#!/usr/bin/env python3
"""Build fine-tuning conversation traces for Worktual NLP agents.

Grounded in apps/nlp agent.md files, skill packs, and MCP servers.
Each conversation uses the data-collection envelope:
  { messages: [...], tools_used: [...] }

Do not invent tools. Runtime notes:
- L1/L2 call only route_to_agent; assistant content is null that turn.
- Required skills (analytics, inbox, support_bot, conversation_assist) are
  preloaded by the runtime via hidden update_skill_in_system.
- Queue/contact operation skills activate from the trusted draft.mode.
- LLM-visible skill tools are list_skills and get_skill unless
  dynamic_procedural_skills_enabled also exposes update_skill_in_system.
- create_queue / create_contact success is the returned id, not a claim.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).with_name("agent-finetune-conversations.json")


def fn(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required or [],
                "additionalProperties": False,
            },
        },
    }


def S(text: str) -> dict:
    return {"role": "system", "content": text}


def U(text: str) -> dict:
    return {"role": "user", "content": text}


def A(
    thinking: str,
    content: str | None = None,
    *,
    tool: str | None = None,
    arguments: dict | None = None,
) -> dict:
    msg: dict = {
        "role": "assistant",
        "thinking": thinking,
        "content": content,
        "required_tool": [],
    }
    if tool:
        msg["tool_call"] = {"name": tool, "arguments": arguments or {}}
    return msg


def T(name: str, payload) -> dict:
    content = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return {"role": "tool", "tool_name": name, "content": content}


def envelope(messages: list, tools: list) -> dict:
    return {"messages": messages, "tools_used": tools}


ROUTE = fn(
    "route_to_agent",
    "Hand the current request to another declared agent. Call alone this turn; leave assistant content empty.",
    {
        "agent_name": {
            "type": "string",
            "description": (
                "Target: agent_assist_domain, interaction_operations_domain, "
                "workforce_management_domain, performance_intelligence_domain, "
                "coworker_task_assist, general, contact, inbox, task, queue, "
                "monitoring, analytics, contact_center_super"
            ),
        },
        "query": {"type": "string", "description": "Short restated user request for the target agent"},
    },
    ["agent_name", "query"],
)

SKILL_TOOLS = [
    fn(
        "list_skills",
        "Rank available skills using vectorless lexical matching.",
        {
            "query": {"type": "string", "description": "Optional lexical query"},
            "limit": {"type": "integer", "description": "Max skills to return"},
        },
    ),
    fn(
        "get_skill",
        "Get one skill pack and its progressive instructions.",
        {"skill_id": {"type": "string", "description": "Skill pack id"}},
        ["skill_id"],
    ),
    fn(
        "update_skill_in_system",
        "Activate a skill in the current trusted turn. Runtime-hidden unless dynamic procedural skills are enabled.",
        {
            "skill_id": {"type": "string"},
            "mode": {"type": "string", "enum": ["append", "replace"]},
        },
        ["skill_id"],
    ),
    fn("list_active_skills", "List skills active in the current turn.", {}),
    fn(
        "remove_skill_from_system",
        "Deactivate one skill in the current turn.",
        {"skill_id": {"type": "string"}},
        ["skill_id"],
    ),
]

PREF_TOOLS = [
    fn("get_user_preferences", "Read the current user's scoped soft and hard preferences.", {}),
    fn(
        "update_user_preference",
        "Create or update a signed-in user preference.",
        {
            "key": {"type": "string", "description": "snake_case preference key"},
            "value": {"description": "Preference value (string, boolean, number, or string array)"},
            "kind": {"type": "string", "enum": ["soft", "hard"]},
        },
        ["key", "value"],
    ),
    fn(
        "verify_hard_preferences",
        "Gate a mutation against hard preference rules before create/update/delete.",
        {
            "action_type": {
                "type": "string",
                "description": "Mutation kind, e.g. contact_create, queue_create, queue_delete",
            },
            "channel": {"type": "string", "description": "Channel or surface, e.g. admin, whatsapp"},
        },
        ["action_type"],
    ),
]

QUEUE_TOOLS = [
    fn(
        "list_queues",
        "List queues with team, status, and assigned people. Pass queueName to return one queue.",
        {"queueName": {"type": "string", "description": "Exact queue name"}},
    ),
    fn("list_teams", "List teams for queue ownership. Call before asking the user to pick a team.", {}),
    fn(
        "list_business_hours",
        "List business hours schedules and the shift types on each schedule. Call after status.",
        {},
    ),
    fn(
        "stage_queue_draft",
        "Non-mutating queue draft. On create intent call with mode=create and nextField=name. Restage collected values each turn.",
        {
            "mode": {"type": "string", "enum": ["create"]},
            "nextField": {
                "type": "string",
                "enum": [
                    "name",
                    "team",
                    "description",
                    "status",
                    "businessHours",
                    "shifts",
                    "staffing",
                    "staffingMode",
                    "shiftAgents",
                    "agentChannels",
                    "addAnotherAgent",
                    "channels",
                    "review",
                ],
            },
            "nextQuestion": {"type": "string"},
            "name": {"type": "string"},
            "teamName": {"type": "string"},
            "teamId": {"type": "string"},
            "description": {"type": "string"},
            "status": {"type": "string", "enum": ["active", "inactive"]},
            "businessHoursId": {"type": "string"},
            "businessHoursName": {"type": "string"},
            "businessHoursSkipped": {"type": "boolean"},
            "shiftTypes": {"type": "array", "items": {"type": "string"}},
            "staffingMode": {"type": "string"},
            "staffingComplete": {"type": "boolean"},
            "staffingSkipped": {"type": "boolean"},
            "currentShift": {"type": "string"},
            "currentAgentId": {"type": "string"},
            "currentAgentName": {"type": "string"},
            "shiftAgentAssignments": {"type": "object"},
            "channels": {"type": "array", "items": {"type": "string"}},
            "ready": {"type": "boolean"},
        },
    ),
    fn(
        "create_queue",
        "Persist the queue after the trusted draft is ready and the user confirmed create. Use field args, not draftId. Success includes id.",
        {
            "name": {"type": "string"},
            "teamName": {"type": "string"},
            "status": {"type": "string", "enum": ["active", "inactive"]},
            "description": {"type": "string"},
            "businessHoursId": {"type": "string"},
            "businessHoursName": {"type": "string"},
            "shiftTypes": {"type": "array", "items": {"type": "string"}},
            "agents": {"type": "array", "items": {"type": "object"}},
            "shiftAgentAssignments": {"type": "object"},
        },
        ["name", "teamName"],
    ),
    fn(
        "update_queue",
        "Persist settings or staffing on an existing queue after confirmation.",
        {
            "queueName": {"type": "string"},
            "newName": {"type": "string"},
            "description": {"type": "string"},
            "teamName": {"type": "string"},
            "status": {"type": "string", "enum": ["active", "inactive"]},
            "businessHoursName": {"type": "string"},
            "skills": {"type": "array", "items": {"type": "string"}},
            "missedCallbackGraceMinutes": {"type": "integer"},
            "addAgents": {"type": "array"},
            "removeAgentNames": {"type": "array", "items": {"type": "string"}},
            "agentUpdates": {"type": "array"},
        },
        ["queueName"],
    ),
    fn(
        "update_queue_status",
        "Change queue status only after confirmation. Prefer update_queue for other changes.",
        {
            "queueName": {"type": "string"},
            "status": {"type": "string", "enum": ["active", "inactive"]},
        },
        ["queueName", "status"],
    ),
    fn(
        "delete_queue",
        "Permanently delete a queue after explicit confirmation. Success is {id, name, deleted: true}.",
        {"queueName": {"type": "string"}},
        ["queueName"],
    ),
    fn("list_agents", "List workforce agents and their setup.", {}),
    fn(
        "list_eligible_agents",
        "List agents eligible for a queue. Call before suggesting agents to add.",
        {"teamName": {"type": "string"}},
    ),
    fn("list_presence", "List current workforce presence. Use agentPresence for online/offline/not ready.", {}),
] + SKILL_TOOLS + PREF_TOOLS + [ROUTE]

CONTACT_TOOLS = [
    fn(
        "list_contacts",
        "Search or list contacts by full name, first name, last name, email, or phone.",
        {
            "search": {"type": "string"},
            "limit": {"type": "integer"},
        },
    ),
    fn(
        "get_contact",
        "Get one contact by id, exact email, or name. Ambiguous same-name matches return emails.",
        {
            "contactId": {"type": "string"},
            "email": {"type": "string"},
            "name": {"type": "string"},
        },
    ),
    fn(
        "stage_contact_draft",
        "Stage a non-mutating contact preview. Create order: firstName, lastName, primaryEmail, primaryPhone, secondaryPhone, gender, city, country.",
        {
            "mode": {"type": "string", "enum": ["create", "update"]},
            "nextField": {
                "type": "string",
                "enum": [
                    "firstName",
                    "lastName",
                    "primaryEmail",
                    "primaryPhone",
                    "secondaryPhone",
                    "gender",
                    "city",
                    "country",
                ],
            },
            "nextQuestion": {"type": "string"},
            "contactId": {"type": "string"},
            "firstName": {"type": "string"},
            "lastName": {"type": "string"},
            "primaryEmail": {"type": "string"},
            "primaryPhone": {"type": "string"},
            "secondaryPhone": {"type": "string"},
            "gender": {"type": "string"},
            "city": {"type": "string"},
            "country": {"type": "string"},
            "isActive": {"type": "boolean"},
            "skippedFields": {"type": "array", "items": {"type": "string"}},
            "ready": {"type": "boolean"},
        },
        ["mode"],
    ),
    fn(
        "create_contact",
        "Persist a new contact after explicit confirmation. Staging is not a save. firstName plus email or phone required.",
        {
            "firstName": {"type": "string"},
            "lastName": {"type": "string"},
            "primaryEmail": {"type": "string"},
            "primaryPhone": {"type": "string"},
            "secondaryPhone": {"type": "string"},
            "gender": {"type": "string"},
            "city": {"type": "string"},
            "country": {"type": "string"},
        },
        ["firstName"],
    ),
    fn(
        "update_contact",
        "Persist contact field changes after explicit confirmation. Staging is not a save.",
        {
            "contactId": {"type": "string"},
            "email": {"type": "string"},
            "name": {"type": "string"},
            "firstName": {"type": "string"},
            "lastName": {"type": "string"},
            "primaryEmail": {"type": "string"},
            "primaryPhone": {"type": "string"},
            "isActive": {"type": "boolean"},
        },
    ),
    fn(
        "contact_enrich",
        "Enrich the contact linked to the current conversation. Acknowledge only appliedFields.",
        {
            "email": {"type": "string"},
            "phone": {"type": "string"},
            "firstName": {"type": "string"},
            "lastName": {"type": "string"},
            "company": {"type": "string"},
            "city": {"type": "string"},
            "country": {"type": "string"},
            "confirmedFields": {"type": "array", "items": {"type": "string"}},
        },
    ),
] + SKILL_TOOLS + PREF_TOOLS + [ROUTE]

ANALYTICS_TOOLS = [
    fn(
        "ask_ontology_layer",
        "Admin-dashboard conceptual why/how/root-cause only. Never for KPI counts, rates, or trends.",
        {
            "query": {"type": "string"},
            "session_id": {"type": "string"},
        },
        ["query"],
    ),
    fn(
        "ask_semantic_layer",
        "Mandatory first step for KPI, rate, count, mix, breakdown, and trend questions. Pass chart_type when asked.",
        {
            "query": {"type": "string"},
            "title": {"type": "string"},
            "chart_type": {"type": "string", "enum": ["kpi", "pie", "bar", "line"]},
        },
        ["query"],
    ),
    fn(
        "sql_analytics",
        "Run one validated read-only SELECT/WITH. For one line per channel GROUP BY day, channel and pass series_column=channel.",
        {
            "query_description": {"type": "string"},
            "sql_query": {"type": "string"},
            "presentation": {"type": "object"},
        },
        ["query_description", "sql_query"],
    ),
    fn(
        "generate_plot",
        "Build a plot grounded in prior tool rows from this turn.",
        {
            "title": {"type": "string"},
            "chart_type": {"type": "string", "enum": ["line", "bar", "pie", "kpi"]},
            "data": {"type": "array", "items": {"type": "object"}},
            "description": {"type": "string"},
        },
        ["title", "chart_type", "data"],
    ),
    fn(
        "generate_performance_report",
        "Fetch live Reports / My Performance overview after semantic miss.",
        {
            "variant": {"type": "string", "enum": ["kpi", "report"]},
            "skill_id": {"type": "string", "enum": ["performance-analytics"]},
            "metric_ids": {"type": "array", "items": {"type": "string"}},
            "range": {"type": "string", "enum": ["7d", "30d", "90d"]},
            "start": {"type": "string"},
            "end": {"type": "string"},
            "title": {"type": "string"},
            "chart_type": {"type": "string", "enum": ["kpi", "pie", "bar", "line"]},
        },
        ["variant", "skill_id", "metric_ids"],
    ),
    fn("list_metric_domains", "List supported metric domains.", {}),
    fn(
        "get_metrics",
        "Rank metric definitions with vectorless lexical matching.",
        {
            "query": {"type": "string"},
            "domain": {"type": "string"},
            "feature": {"type": "string"},
            "limit": {"type": "integer"},
        },
        ["query"],
    ),
    fn(
        "get_metric",
        "Load exact metric definitions by id.",
        {"metric_ids": {"type": "array", "items": {"type": "string"}}},
        ["metric_ids"],
    ),
    fn(
        "get_metric_schema",
        "Load metric definitions and grounded schema.",
        {"metric_ids": {"type": "array", "items": {"type": "string"}}},
        ["metric_ids"],
    ),
] + SKILL_TOOLS + [ROUTE]

MONITORING_TOOLS = [
    fn("get_monitoring_snapshot", "Load live queues, waiting/missed contacts, callbacks, alerts, agents, and presence.", {}),
    fn(
        "get_agent_attendance",
        "Read an agent's attendance for a day or date range.",
        {
            "agentId": {"type": "string"},
            "date": {"type": "string"},
            "fromDate": {"type": "string"},
            "toDate": {"type": "string"},
        },
        ["agentId"],
    ),
    fn(
        "get_not_ready_escalation_insight",
        "Read supervisor insight for a not-ready escalation alert.",
        {"escalationId": {"type": "string"}},
        ["escalationId"],
    ),
    fn(
        "get_contact_callback_channels",
        "List callback channels for a contact before assigning a callback.",
        {
            "contactId": {"type": "string"},
            "hintChannel": {"type": "string", "enum": ["whatsapp", "instagram", "facebook", "email"]},
        },
        ["contactId"],
    ),
    fn(
        "create_callback_task",
        "Assign a callback after supervisor confirmation. assignedUserId is snapshot agent.id (setup user id).",
        {
            "assignedUserId": {"type": "string"},
            "contactId": {"type": "string"},
            "conversationId": {"type": "string"},
            "channel": {"type": "string", "enum": ["whatsapp", "instagram", "facebook", "email"]},
            "title": {"type": "string"},
            "assigneeName": {"type": "string"},
            "customerName": {"type": "string"},
        },
        ["assignedUserId"],
    ),
    fn(
        "force_agent_logout",
        "Force-logout a logged-in agent after confirmation. Use snapshot agent.agentId or agentName.",
        {
            "agentId": {"type": "string"},
            "agentName": {"type": "string"},
        },
    ),
    fn(
        "set_agent_presence",
        "Set a logged-in agent's presence to ready or not_ready after confirmation.",
        {
            "presence": {"type": "string", "enum": ["ready", "not_ready"]},
            "agentId": {"type": "string"},
            "agentName": {"type": "string"},
        },
        ["presence"],
    ),
    fn(
        "acknowledge_not_ready_escalation",
        "Acknowledge a not-ready escalation after supervisor review.",
        {"escalationId": {"type": "string"}},
        ["escalationId"],
    ),
    fn(
        "acknowledge_proactive_callback",
        "Acknowledge a proactive callback alert on the monitoring board.",
        {"attemptId": {"type": "string"}},
        ["attemptId"],
    ),
    fn(
        "get_contact",
        "Get one contact by id, email, or name.",
        {"contactId": {"type": "string"}, "email": {"type": "string"}, "name": {"type": "string"}},
    ),
    fn("navigate", "Open an internal /admin/ or /agent/ contact-center page.", {"path": {"type": "string"}}, ["path"]),
] + PREF_TOOLS + [ROUTE]

INBOX_TOOLS = [
    fn("get_conversation_context", "Read bounded context for the selected conversation.", {}),
    fn("suggest_reply", "Draft a grounded reply for review; never send it.", {}),
    fn("summarize_conversation", "Summarize the selected conversation.", {}),
    fn("get_organization_details", "Fetch official details for the trusted tenant.", {}),
    fn(
        "get_organization_knowledge",
        "Search knowledge with exactly one module: business, product, or support. Do not retry another module if empty.",
        {
            "query": {"type": "string"},
            "module": {"type": "string", "enum": ["business", "product", "support"]},
        },
        ["query", "module"],
    ),
    fn(
        "contact_enrich",
        "Enrich the conversation-linked contact. Acknowledge only appliedFields.",
        {
            "firstName": {"type": "string"},
            "lastName": {"type": "string"},
            "email": {"type": "string"},
            "phone": {"type": "string"},
            "confirmedFields": {"type": "array", "items": {"type": "string"}},
        },
    ),
    fn("get_contact", "Get one contact by id, email, or name.", {"contactId": {"type": "string"}}),
] + SKILL_TOOLS + [ROUTE]

TASK_TOOLS = [
    fn(
        "list_tasks",
        "List authoritative tasks for the signed-in agent.",
        {
            "tab": {"type": "string", "enum": ["admin_assigned", "coworker_assigned", "done"]},
            "status": {"type": "string", "enum": ["open", "completed"]},
            "due": {"type": "string", "enum": ["today", "overdue"]},
            "search": {"type": "string"},
            "limit": {"type": "integer"},
        },
    ),
    fn("get_task", "Get a task by id or trusted selected-task context.", {"taskId": {"type": "string"}}),
    fn(
        "update_task",
        "Complete, dismiss, or accept a selected task suggestion after an explicit request.",
        {
            "action": {"type": "string", "enum": ["complete", "dismiss", "accept_suggestion"]},
            "taskId": {"type": "string"},
        },
        ["action"],
    ),
    fn(
        "open_task_workspace",
        "Open the customer workspace linked to a selected task when the user explicitly asks to work on it.",
        {"taskId": {"type": "string"}},
    ),
    fn("navigate", "Open an internal /admin/ or /agent/ contact-center page.", {"path": {"type": "string"}}, ["path"]),
] + PREF_TOOLS + [ROUTE]

GENERAL_TOOLS = [
    fn("navigate", "Open an internal /admin/ or /agent/ contact-center page.", {"path": {"type": "string"}}, ["path"]),
    fn("get_organization_details", "Fetch official details for the trusted tenant.", {}),
    fn(
        "get_organization_knowledge",
        "Search knowledge with exactly one module: business, product, or support.",
        {
            "query": {"type": "string"},
            "module": {"type": "string", "enum": ["business", "product", "support"]},
        },
        ["query", "module"],
    ),
    fn(
        "recommend_live_agent_handoff",
        "Call only when the customer explicitly asks to speak with a live agent.",
        {"reason": {"type": "string"}},
    ),
    ROUTE,
]

SUPPORT_TOOLS = [
    fn("get_organization_details", "Fetch official details for the trusted tenant.", {}),
    fn(
        "get_organization_knowledge",
        "Search knowledge once with module business | product | support. Do not retry another module if empty.",
        {
            "query": {"type": "string"},
            "module": {"type": "string", "enum": ["business", "product", "support"]},
        },
        ["query", "module"],
    ),
    fn(
        "recommend_live_agent_handoff",
        "Call only when the customer explicitly asks to speak with a live agent, human, or representative.",
        {"reason": {"type": "string"}},
    ),
    fn(
        "contact_enrich",
        "Enrich the conversation-linked contact per identity rules. Acknowledge only appliedFields.",
        {
            "firstName": {"type": "string"},
            "lastName": {"type": "string"},
            "email": {"type": "string"},
            "phone": {"type": "string"},
            "confirmedFields": {"type": "array", "items": {"type": "string"}},
        },
    ),
    fn("list_contacts", "Search contacts.", {"search": {"type": "string"}}),
    fn("get_contact", "Get one contact.", {"contactId": {"type": "string"}}),
] + SKILL_TOOLS

CONVERSATION_ASSIST_TOOLS = [
    fn("get_conversation_context", "Read bounded context for the selected conversation.", {}),
    fn("suggest_reply", "Draft a grounded reply for review; never send it.", {}),
    fn("summarize_conversation", "Summarize the selected conversation.", {}),
    fn("get_organization_knowledge", "Search knowledge with exactly one module.", {"query": {"type": "string"}, "module": {"type": "string"}}, ["query", "module"]),
    fn("get_organization_details", "Fetch official tenant details.", {}),
    fn(
        "contact_enrich",
        "Conversation Assist never executes mutations. Use contact tools only to read verified fields.",
        {"firstName": {"type": "string"}},
    ),
    fn("get_contact", "Get one contact.", {"contactId": {"type": "string"}}),
] + SKILL_TOOLS

COWORKER_TASK_TOOLS = [
    fn("get_conversation_context", "Read bounded context for the selected conversation.", {}),
    fn("suggest_reply", "Draft a grounded reply; never send it.", {}),
    fn("list_contacts", "Search contacts.", {"search": {"type": "string"}}),
    fn("get_contact", "Get one contact.", {"contactId": {"type": "string"}}),
    fn("stage_contact_draft", "Stage a non-mutating contact preview.", {"mode": {"type": "string"}, "firstName": {"type": "string"}}, ["mode"]),
    fn("create_contact", "Persist a contact after confirmation.", {"firstName": {"type": "string"}}, ["firstName"]),
    fn("update_contact", "Persist contact changes after confirmation.", {"contactId": {"type": "string"}}),
    fn("list_tasks", "List tasks.", {"tab": {"type": "string"}}),
    fn("update_task", "Complete, dismiss, or accept a task.", {"action": {"type": "string"}, "taskId": {"type": "string"}}, ["action"]),
    fn("navigate", "Open an internal page.", {"path": {"type": "string"}}, ["path"]),
    fn("get_organization_knowledge", "Search knowledge.", {"query": {"type": "string"}, "module": {"type": "string"}}, ["query", "module"]),
] + SKILL_TOOLS + PREF_TOOLS + [ROUTE]

ROUTER_TOOLS = [ROUTE]


def sys_router(name: str, role: str, targets: str, extra: str = "") -> str:
    return (
        f"ROLE:\nYou are the {name} for Worktual AI Contact Center.\n\n"
        "INSTRUCTIONS:\n"
        "Understand intent from the full request, runtime surface, role, and recent task context; never use keyword or regex routing.\n"
        "Call route_to_agent once with the selected target and a concise, lossless query.\n"
        "Leave user-visible content empty on a handoff. If intent is materially ambiguous, ask one focused question.\n"
        "Do not answer domain questions, call business tools, or invent data.\n\n"
        f"Handoff targets: {targets}\n"
        f"{extra}"
        "INPUT CONTEXT:\nRuntime may supply tenant, signed-in user, role, surface, path, and selected record. Do not invent ids.\n\n"
        "CONTEXT:\n"
        "role: admin\n"
        "permissions: route_to_agent\n"
        "conversational_history: none\n"
    )


def sys_l3(role: str, instructions: str, context: str) -> str:
    return (
        f"ROLE:\n{role}\n\n"
        f"INSTRUCTIONS:\n{instructions}\n\n"
        "Never invent names, ids, counts, or mutation outcomes. Never expose tool JSON in user-visible HTML. "
        "If the request belongs to another domain, call only route_to_agent; assistant content must be null that turn.\n\n"
        "INPUT CONTEXT:\nRuntime may supply tenant, signed-in user, role, surface, path, locale, and selected record ids. Do not invent ids.\n\n"
        f"CONTEXT:\n{context}\n"
    )


QUEUE_CREATE_SKILL = {
    "id": "queue-create",
    "name": "Queue Create",
    "version": 2,
    "tools_preferred": [
        "stage_queue_draft",
        "list_teams",
        "list_business_hours",
        "list_eligible_agents",
        "create_queue",
    ],
    "workflow": [
        "On create intent, call stage_queue_draft first with mode=create, nextField=name.",
        "Sequence: name, team, description, status, businessHours, one staffing form, review.",
        "When status is answered, stage it then ask hours and call list_business_hours.",
        "After a schedule is chosen, one staffing form. Never emit an Available-agents HTML list.",
        "Done staffing stages review and staffingComplete=true. Empty form plus Done is skip staffing.",
        "create_queue only after ready and explicit confirmation. Success includes id.",
    ],
    "body": (
        "Start by staging mode=create before asking the first question. The create order is "
        "name, team, description, status, businessHours, then one staffing form, then review. "
        "Never ask staffingMode, agentChannels, or a generic shift catalog."
    ),
}

CONTACT_CREATE_SKILL = {
    "id": "contact-create",
    "name": "Contact Create",
    "version": 2,
    "tools_preferred": ["stage_contact_draft", "create_contact"],
    "workflow": [
        "On create intent, call stage_contact_draft before the first question with mode=create, nextField=firstName.",
        "Sequence: firstName, lastName, primaryEmail, primaryPhone, secondaryPhone, gender, city, country.",
        "firstName plus email or phone is mandatory. Optional fields may be skipped.",
        "Stage nextField=null only after city and country are answered or skipped, then confirm.",
        "On confirmation call create_contact in the same turn with staged values.",
    ],
    "body": "Start by staging mode=create. Ask one focused question. Staging is not a save.",
}

CATALOG = [
    {
        "name": "contact_center_super",
        "layer": "super",
        "mcp_servers": [],
        "allowed_skills": [],
        "required_skills": [],
        "skill_load": "No business skills. Tools: route_to_agent only.",
        "tools": ["route_to_agent"],
        "handoff_targets": [
            "agent_assist_domain",
            "interaction_operations_domain",
            "workforce_management_domain",
            "performance_intelligence_domain",
        ],
    },
    {
        "name": "agent_assist_domain",
        "layer": "domain",
        "mcp_servers": [],
        "allowed_skills": [],
        "required_skills": [],
        "skill_load": "No business skills. Tools: route_to_agent only.",
        "tools": ["route_to_agent"],
        "handoff_targets": ["coworker_task_assist", "general", "contact", "inbox"],
    },
    {
        "name": "interaction_operations_domain",
        "layer": "domain",
        "mcp_servers": [],
        "allowed_skills": [],
        "required_skills": [],
        "skill_load": "No business skills. Wired target is task.",
        "tools": ["route_to_agent"],
        "handoff_targets": ["task"],
    },
    {
        "name": "workforce_management_domain",
        "layer": "domain",
        "mcp_servers": [],
        "allowed_skills": [],
        "required_skills": [],
        "skill_load": "No business skills. Queue vs monitoring from full request and surface.",
        "tools": ["route_to_agent"],
        "handoff_targets": ["queue", "monitoring"],
    },
    {
        "name": "performance_intelligence_domain",
        "layer": "domain",
        "mcp_servers": [],
        "allowed_skills": [],
        "required_skills": [],
        "skill_load": "No business skills. Target is analytics.",
        "tools": ["route_to_agent"],
        "handoff_targets": ["analytics"],
    },
    {
        "name": "queue",
        "layer": "executor",
        "mcp_servers": ["queue", "skill", "preferences"],
        "allowed_skills": ["queue-create", "queue-update", "queue-staff", "queue-delete"],
        "required_skills": [],
        "skill_load": (
            "LLM may call list_skills/get_skill. Runtime _ensure_task_skill activates "
            "queue-create/update/staff/delete from trusted draft.mode. After stage_queue_draft "
            "mode=create, tools narrow to QUEUE_CREATE_TOOLS. create_queue is hidden until ready."
        ),
        "tools": [t["function"]["name"] for t in QUEUE_TOOLS],
    },
    {
        "name": "contact",
        "layer": "executor",
        "mcp_servers": ["contact", "skill", "preferences"],
        "allowed_skills": [
            "contact-search",
            "contact-create",
            "contact-update",
            "contact-deactivate",
            "contact-identity-resolution",
        ],
        "required_skills": [],
        "skill_load": "Load exactly one skill once. Draft mode=create activates contact-create.",
        "tools": [t["function"]["name"] for t in CONTACT_TOOLS],
    },
    {
        "name": "analytics",
        "layer": "executor",
        "mcp_servers": ["analytics", "skill", "metric"],
        "allowed_skills": ["performance-analytics"],
        "required_skills": ["performance-analytics"],
        "skill_load": "Runtime preloads performance-analytics via hidden update_skill_in_system. First KPI tool is ask_semantic_layer.",
        "tools": [t["function"]["name"] for t in ANALYTICS_TOOLS],
    },
    {
        "name": "monitoring",
        "layer": "executor",
        "mcp_servers": ["monitoring", "contact", "navigation", "preferences"],
        "allowed_skills": [],
        "required_skills": [],
        "skill_load": "No procedural skills. Call get_monitoring_snapshot before live-state answers.",
        "tools": [t["function"]["name"] for t in MONITORING_TOOLS],
    },
    {
        "name": "inbox",
        "layer": "executor",
        "mcp_servers": ["conversation", "contact", "organization", "skill"],
        "allowed_skills": ["contact-entity-extraction", "contact-identity-resolution"],
        "required_skills": ["contact-entity-extraction", "contact-identity-resolution"],
        "skill_load": "Foundational skills preloaded. Call suggest_reply or get_conversation_context before drafting.",
        "tools": [t["function"]["name"] for t in INBOX_TOOLS],
    },
    {
        "name": "task",
        "layer": "executor",
        "mcp_servers": ["task", "navigation", "preferences"],
        "allowed_skills": [],
        "required_skills": [],
        "skill_load": "No procedural skills. list_tasks/get_task before answering.",
        "tools": [t["function"]["name"] for t in TASK_TOOLS],
    },
    {
        "name": "general",
        "layer": "executor",
        "mcp_servers": ["navigation", "organization"],
        "allowed_skills": [],
        "required_skills": [],
        "skill_load": "No procedural skills. Greetings need no tools.",
        "tools": [t["function"]["name"] for t in GENERAL_TOOLS],
    },
    {
        "name": "support_bot",
        "layer": "executor",
        "mcp_servers": ["organization", "contact", "skill"],
        "allowed_skills": ["contact-entity-extraction", "contact-identity-resolution"],
        "required_skills": ["contact-entity-extraction", "contact-identity-resolution"],
        "skill_load": "Identity skills preloaded. Customer-facing; no route_to_agent.",
        "tools": [t["function"]["name"] for t in SUPPORT_TOOLS],
    },
    {
        "name": "conversation_assist",
        "layer": "executor",
        "mcp_servers": ["conversation", "contact", "organization", "skill"],
        "allowed_skills": ["contact-entity-extraction", "contact-identity-resolution"],
        "required_skills": ["contact-entity-extraction", "contact-identity-resolution"],
        "skill_load": "Preloaded. Output is JSON (replyDraft, privateNotes, actionProposal). Never send or mutate.",
        "tools": [t["function"]["name"] for t in CONVERSATION_ASSIST_TOOLS],
    },
    {
        "name": "coworker_task_assist",
        "layer": "executor",
        "mcp_servers": [
            "conversation",
            "contact",
            "task",
            "navigation",
            "organization",
            "skill",
            "preferences",
        ],
        "allowed_skills": [
            "contact-entity-extraction",
            "contact-identity-resolution",
            "contact-search",
            "contact-create",
            "contact-update",
            "contact-deactivate",
        ],
        "required_skills": ["contact-entity-extraction", "contact-identity-resolution"],
        "skill_load": "Identity skills preloaded. Load one contact operation skill when mutating. Never send a customer message.",
        "tools": [t["function"]["name"] for t in COWORKER_TASK_TOOLS],
    },
]


def route_sample(agent: str, system: str, user: str, target: str, query: str, tools: list) -> dict:
    return envelope(
        [
            S(system),
            U(user),
            A(
                f"Primary intent belongs to {target}. Call route_to_agent once and leave content empty.",
                None,
                tool="route_to_agent",
                arguments={"agent_name": target, "query": query},
            ),
            T(
                "route_to_agent",
                {"ok": True, "routed_to": target, "query": query},
            ),
        ],
        tools,
    )


def clarify_sample(agent: str, system: str, user: str, question_html: str, tools: list) -> dict:
    return envelope(
        [
            S(system),
            U(user),
            A(
                "Intent is ambiguous across allowed targets. Ask one focused question. Do not call business tools.",
                question_html,
            ),
        ],
        tools,
    )


def build_conversations() -> list[dict]:
    items: list[dict] = []

    l1 = sys_router(
        "L1 Contact Center Super Agent",
        "super",
        "agent_assist_domain, interaction_operations_domain, workforce_management_domain, performance_intelligence_domain",
    )
    l2_assist = sys_router(
        "L2 Agent Assist Domain Agent",
        "domain",
        "coworker_task_assist, general, contact, inbox",
    )
    l2_ops = sys_router(
        "L2 Interaction Operations Domain Agent",
        "domain",
        "task",
    )
    l2_wf = sys_router(
        "L2 Workforce Management Domain Agent",
        "domain",
        "queue, monitoring",
    )
    l2_pi = sys_router(
        "L2 Performance Intelligence Domain Agent",
        "domain",
        "analytics",
    )

    items += [
        {
            "agent": "contact_center_super",
            "id": "l1-route-queue-create",
            "skill_load": "none",
            "sample": route_sample(
                "contact_center_super",
                l1,
                "I need to set up a new inbound queue called North America Billing for the finance department.",
                "workforce_management_domain",
                "Create inbound queue North America Billing for the Finance team.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "contact_center_super",
            "id": "l1-route-performance",
            "skill_load": "none",
            "sample": route_sample(
                "contact_center_super",
                l1,
                "What is my resolution rate this month?",
                "performance_intelligence_domain",
                "Resolution rate for the signed-in agent this month.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "contact_center_super",
            "id": "l1-route-tasks",
            "skill_load": "none",
            "sample": route_sample(
                "contact_center_super",
                l1,
                "Show my overdue tasks.",
                "interaction_operations_domain",
                "List overdue tasks for the signed-in user.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "agent_assist_domain",
            "id": "l2-route-inbox-reply",
            "skill_load": "none",
            "sample": route_sample(
                "agent_assist_domain",
                l2_assist,
                "Draft a reply to this customer's last WhatsApp message.",
                "inbox",
                "Draft a customer-facing reply for the selected WhatsApp conversation.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "agent_assist_domain",
            "id": "l2-route-contact-create",
            "skill_load": "none",
            "sample": route_sample(
                "agent_assist_domain",
                l2_assist,
                "Create a contact for Priya Singh, priya.singh@example.com.",
                "contact",
                "Create contact Priya Singh with primaryEmail priya.singh@example.com.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "agent_assist_domain",
            "id": "l2-route-coworker-task",
            "skill_load": "none",
            "sample": route_sample(
                "agent_assist_domain",
                l2_assist,
                "Take the callback follow-up from this live conversation.",
                "coworker_task_assist",
                "Prepare the callback follow-up from the selected live conversation.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "interaction_operations_domain",
            "id": "l2-route-task-list",
            "skill_load": "none",
            "sample": route_sample(
                "interaction_operations_domain",
                l2_ops,
                "What tasks are overdue for me?",
                "task",
                "List overdue tasks for the signed-in agent.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "interaction_operations_domain",
            "id": "l2-route-task-complete",
            "skill_load": "none",
            "sample": route_sample(
                "interaction_operations_domain",
                l2_ops,
                "Mark the billing callback task complete.",
                "task",
                "Complete the billing callback task after confirmation.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "interaction_operations_domain",
            "id": "l2-route-task-open",
            "skill_load": "none",
            "sample": route_sample(
                "interaction_operations_domain",
                l2_ops,
                "Open the first overdue task so I can work on it.",
                "task",
                "Open the workspace for the first overdue task.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "workforce_management_domain",
            "id": "l2-route-queue-create",
            "skill_load": "none",
            "sample": route_sample(
                "workforce_management_domain",
                l2_wf,
                "I need to set up a new inbound queue called North America Billing for the finance department.",
                "queue",
                "Create inbound queue North America Billing for the Finance team.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "workforce_management_domain",
            "id": "l2-route-monitoring-waiting",
            "skill_load": "none",
            "sample": route_sample(
                "workforce_management_domain",
                l2_wf,
                "Who is waiting on WhatsApp right now?",
                "monitoring",
                "Report current WhatsApp waiting contacts from the live monitoring snapshot.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "workforce_management_domain",
            "id": "l2-clarify-queue-vs-monitoring",
            "skill_load": "none",
            "sample": clarify_sample(
                "workforce_management_domain",
                l2_wf,
                "Help me with Billing.",
                "<p>Do you want to change the <strong>Billing</strong> queue setup, or see live waiting contacts and agent presence?</p>",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "performance_intelligence_domain",
            "id": "l2-route-kpi",
            "skill_load": "none",
            "sample": route_sample(
                "performance_intelligence_domain",
                l2_pi,
                "Show my handled conversations and AHT for the last 7 days.",
                "analytics",
                "My Performance handled conversations and AHT for the last 7 days.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "performance_intelligence_domain",
            "id": "l2-route-channel-mix",
            "skill_load": "none",
            "sample": route_sample(
                "performance_intelligence_domain",
                l2_pi,
                "Give me a pie chart of channel mix.",
                "analytics",
                "Channel mix pie chart for the selected performance period.",
                ROUTER_TOOLS,
            ),
        },
        {
            "agent": "performance_intelligence_domain",
            "id": "l2-route-ontology",
            "skill_load": "none",
            "sample": route_sample(
                "performance_intelligence_domain",
                l2_pi,
                "Why did average handle time increase this week versus last week?",
                "analytics",
                "Causal explanation of AHT increase this week versus last week on the admin dashboard.",
                ROUTER_TOOLS,
            ),
        },
    ]

    items.extend(_queue_conversations())
    items.extend(_contact_conversations())
    items.extend(_analytics_conversations())
    items.extend(_monitoring_conversations())
    items.extend(_inbox_conversations())
    items.extend(_task_conversations())
    items.extend(_general_conversations())
    items.extend(_support_bot_conversations())
    items.extend(_conversation_assist_conversations())
    items.extend(_coworker_task_conversations())
    return items


def _queue_conversations() -> list[dict]:
    ctx = (
        "role: admin\n"
        "permissions: list_queues, list_teams, list_business_hours, stage_queue_draft, create_queue, "
        "update_queue, update_queue_status, delete_queue, list_agents, list_eligible_agents, "
        "list_presence, list_skills, get_skill, verify_hard_preferences, route_to_agent\n"
        "surface: queues-list\n"
        "path: /admin/workforce/queues\n"
        "conversational_history: none\n"
    )
    system = sys_l3(
        "You are the Queue Management Agent for Worktual AI Contact Center workforce management. "
        "You help an admin create, inspect, staff, update, and delete inbound queues through conversational draft staging.",
        "Load exactly one allowed skill once for the current task (queue-create, queue-update, queue-staff, or queue-delete) via get_skill. Follow that skill.\n"
        "Create: call stage_queue_draft first with mode=create and nextField=name. Ask one question. Restage collected values each gathering turn.\n"
        "Sequence: name (mandatory) → team (mandatory; call list_teams in the same turn and only offer returned teams) → description (optional) → status (active or inactive) → businessHours (optional; call list_business_hours) → one staffing form → review.\n"
        "After hours, the UI shows one staffing form. Never emit an Available-agents or channels HTML list. Never ask staffingMode or a generic six-shift catalog.\n"
        "Done staffing stages nextField=review and staffingComplete=true. Empty form plus Done is staffingSkipped=true. That is not persistence.\n"
        "When ready, stage nextField=review and ask for explicit confirmation to create.\n"
        "On confirm, call create_queue in the same turn with name and teamName. Never pass draftId. Never claim create succeeded unless this turn's result includes id.\n"
        "list_queues before answering which queues exist. update_queue or update_queue_status only after confirmation. delete_queue only after explicit confirmation.\n"
        "If list_teams or list_eligible_agents is empty, say so and do not invent names. Call verify_hard_preferences before mutate when hard rules may apply.",
        ctx,
    )

    create = envelope(
        [
            S(system),
            U("I need to set up a new inbound queue called North America Billing for the finance department."),
            A(
                "Create intent. Load queue-create once, then stage the supplied name before asking for team.",
                None,
                tool="get_skill",
                arguments={"skill_id": "queue-create"},
            ),
            T("get_skill", QUEUE_CREATE_SKILL),
            A(
                "Skill loaded. Stage name from the user message and advance to team.",
                None,
                tool="stage_queue_draft",
                arguments={
                    "mode": "create",
                    "nextField": "team",
                    "name": "North America Billing",
                    "nextQuestion": "Which team should this queue belong to?",
                },
            ),
            T(
                "stage_queue_draft",
                {"ok": True, "nextField": "team", "name": "North America Billing", "ready": False},
            ),
            A(
                "Call list_teams before offering team options. Only use returned names.",
                None,
                tool="list_teams",
                arguments={},
            ),
            T(
                "list_teams",
                {"teams": [{"id": "t-101", "name": "Finance"}, {"id": "t-102", "name": "Operations"}, {"id": "t-103", "name": "Legal"}]},
            ),
            A(
                "Finance is in the live list and matches the user's department. Ask them to confirm the team.",
                "<p>I've started the <strong>North America Billing</strong> queue. Which team should it belong to?</p><ul><li>Finance</li><li>Operations</li><li>Legal</li></ul>",
            ),
            U("It should be for the Finance team."),
            A(
                "Stage teamName=Finance and ask optional description.",
                None,
                tool="stage_queue_draft",
                arguments={
                    "mode": "create",
                    "nextField": "description",
                    "name": "North America Billing",
                    "teamName": "Finance",
                    "teamId": "t-101",
                },
            ),
            T(
                "stage_queue_draft",
                {
                    "ok": True,
                    "nextField": "description",
                    "name": "North America Billing",
                    "teamName": "Finance",
                    "teamId": "t-101",
                },
            ),
            A(
                "Ask optional description; user may skip.",
                "<p>Would you like to add a <strong>description</strong>, or skip this step?</p>",
            ),
            U("Skip the description and make it active."),
            A(
                "Stage skipped description and status=active, then move to business hours.",
                None,
                tool="stage_queue_draft",
                arguments={
                    "mode": "create",
                    "nextField": "businessHours",
                    "name": "North America Billing",
                    "teamName": "Finance",
                    "status": "active",
                },
            ),
            T(
                "stage_queue_draft",
                {
                    "ok": True,
                    "nextField": "businessHours",
                    "name": "North America Billing",
                    "teamName": "Finance",
                    "status": "active",
                },
            ),
            A(
                "Status is on the draft. Call list_business_hours before asking for a schedule.",
                None,
                tool="list_business_hours",
                arguments={},
            ),
            T(
                "list_business_hours",
                {
                    "schedules": [
                        {"id": "bh-55", "name": "Standard US Hours", "shiftTypes": ["Standard Morning", "Standard Afternoon"]},
                        {"id": "bh-56", "name": "24/7 Support", "shiftTypes": ["Always On"]},
                    ]
                },
            ),
            A(
                "Offer only returned schedules. Hours are optional but must be asked before staffing.",
                "<p>Status is <strong>active</strong>. Which business hours should this queue use? You can also skip hours.</p><ul><li>Standard US Hours</li><li>24/7 Support</li></ul>",
            ),
            U("Standard US Hours. Skip staffing for now."),
            A(
                "Stage hours and skip staffing, then review.",
                None,
                tool="stage_queue_draft",
                arguments={
                    "mode": "create",
                    "nextField": "review",
                    "name": "North America Billing",
                    "teamName": "Finance",
                    "status": "active",
                    "businessHoursId": "bh-55",
                    "businessHoursName": "Standard US Hours",
                    "staffingSkipped": True,
                    "staffingComplete": True,
                    "ready": True,
                },
            ),
            T(
                "stage_queue_draft",
                {
                    "ready": True,
                    "preview": {
                        "name": "North America Billing",
                        "team": "Finance",
                        "status": "active",
                        "hours": "Standard US Hours",
                        "staffingSkipped": True,
                    },
                },
            ),
            A(
                "Draft is ready. Ask explicit create confirmation. Do not call create_queue yet.",
                "<p>Ready to create this queue:</p><ul><li><strong>Name:</strong> North America Billing</li><li><strong>Team:</strong> Finance</li><li><strong>Status:</strong> active</li><li><strong>Hours:</strong> Standard US Hours</li><li><strong>Staffing:</strong> none</li></ul><p>Shall I create it now?</p>",
            ),
            U("yes create"),
            A(
                "User confirmed. Verify hard preferences then persist.",
                None,
                tool="verify_hard_preferences",
                arguments={"action_type": "queue_create", "channel": "admin"},
            ),
            T("verify_hard_preferences", {"allowed": True, "requires_confirmation": False}),
            A(
                "Preferences allow create. Call create_queue with name and teamName. Do not pass draftId.",
                None,
                tool="create_queue",
                arguments={
                    "name": "North America Billing",
                    "teamName": "Finance",
                    "status": "active",
                    "businessHoursId": "bh-55",
                    "businessHoursName": "Standard US Hours",
                },
            ),
            T("create_queue", {"id": "q-778", "name": "North America Billing"}),
            A(
                "Result includes id. Quote that outcome only. Do not create again.",
                "<p>The <strong>North America Billing</strong> queue is created and active for Finance, using Standard US Hours, with no agents assigned yet. Anything else you need?</p>",
            ),
        ],
        QUEUE_TOOLS,
    )

    update = envelope(
        [
            S(system),
            U("Make the North America Billing queue inactive."),
            A(
                "Existing-queue status change. Load queue-update, then list_queues for the named queue.",
                None,
                tool="get_skill",
                arguments={"skill_id": "queue-update"},
            ),
            T(
                "get_skill",
                {
                    "id": "queue-update",
                    "name": "Queue Settings Update",
                    "version": 2,
                    "tools_preferred": ["list_queues", "list_teams", "list_business_hours", "update_queue"],
                    "body": "Call list_queues with the queue name. Confirm the setting, then call update_queue in the same turn as confirmation.",
                },
            ),
            A(
                "Resolve the current queue before claiming status.",
                None,
                tool="list_queues",
                arguments={"queueName": "North America Billing"},
            ),
            T(
                "list_queues",
                {
                    "queues": [
                        {"id": "q-778", "name": "North America Billing", "teamName": "Finance", "status": "active"}
                    ]
                },
            ),
            A(
                "Queue exists and is active. Ask confirmation before mutating.",
                "<p><strong>North America Billing</strong> is currently <strong>active</strong>. Should I set it to inactive?</p>",
            ),
            U("yes"),
            A(
                "Confirmed. Persist with update_queue.",
                None,
                tool="update_queue",
                arguments={"queueName": "North America Billing", "status": "inactive"},
            ),
            T("update_queue", {"id": "q-778", "name": "North America Billing", "status": "inactive"}),
            A(
                "Quote only returned fields.",
                "<p><strong>North America Billing</strong> is now inactive.</p>",
            ),
        ],
        QUEUE_TOOLS,
    )

    delete = envelope(
        [
            S(system),
            U("Delete the North America Billing queue."),
            A(
                "Deletion intent. Load queue-delete and resolve the queue first. User has not confirmed yet.",
                None,
                tool="get_skill",
                arguments={"skill_id": "queue-delete"},
            ),
            T(
                "get_skill",
                {
                    "id": "queue-delete",
                    "name": "Queue Delete",
                    "version": 2,
                    "tools_preferred": ["list_queues", "delete_queue"],
                    "body": "Resolve the named queue. Confirm once, then call delete_queue. Quote the name only when deleted is true.",
                },
            ),
            A(
                "list_queues does not delete. Confirm after resolving.",
                None,
                tool="list_queues",
                arguments={"queueName": "North America Billing"},
            ),
            T(
                "list_queues",
                {"queues": [{"id": "q-778", "name": "North America Billing", "teamName": "Finance", "status": "inactive"}]},
            ),
            A(
                "Ask explicit confirmation. Do not call delete_queue yet.",
                "<p>This permanently removes <strong>North America Billing</strong>. Should I delete it now?</p>",
            ),
            U("yes delete it"),
            A(
                "Explicit confirmation. Call delete_queue in this turn.",
                None,
                tool="delete_queue",
                arguments={"queueName": "North America Billing"},
            ),
            T("delete_queue", {"id": "q-778", "name": "North America Billing", "deleted": True}),
            A(
                "deleted is true. Quote the returned name.",
                "<p><strong>North America Billing</strong> has been deleted.</p>",
            ),
        ],
        QUEUE_TOOLS,
    )

    return [
        {"agent": "queue", "id": "queue-create-skip-staffing", "skill_load": "get_skill queue-create then stage_queue_draft", "sample": create},
        {"agent": "queue", "id": "queue-update-status", "skill_load": "get_skill queue-update then list_queues", "sample": update},
        {"agent": "queue", "id": "queue-delete-confirm", "skill_load": "get_skill queue-delete then list_queues", "sample": delete},
    ]


def _contact_conversations() -> list[dict]:
    ctx = (
        "role: admin\n"
        "permissions: list_contacts, get_contact, stage_contact_draft, create_contact, update_contact, "
        "list_skills, get_skill, verify_hard_preferences, route_to_agent\n"
        "surface: contacts-list\n"
        "path: /admin/contacts\n"
        "conversational_history: none\n"
    )
    system = sys_l3(
        "You are the Contact Agent for Worktual AI Contact Center. You find, create, update, and deactivate contacts.",
        "Load exactly one allowed skill once. Follow that skill. Staging is not a save.\n"
        "Create sequence: firstName → lastName → primaryEmail → primaryPhone → secondaryPhone → gender → city → country.\n"
        "firstName and at least one of primaryEmail or primaryPhone are mandatory. Extract every supplied value in the user message.\n"
        "Never claim a save unless this turn's create_contact or update_contact returned the contact.\n"
        "Search with list_contacts using the complete name. If several people share it, show each email and ask which person.\n"
        "Permanent deletion is unsupported; offer deactivation instead.",
        ctx,
    )

    create = envelope(
        [
            S(system),
            U("Create a contact for Priya Singh, priya.singh@example.com, phone +1 415 555 0199."),
            A(
                "Create intent with firstName, lastName, email, and phone already supplied. Load contact-create.",
                None,
                tool="get_skill",
                arguments={"skill_id": "contact-create"},
            ),
            T("get_skill", CONTACT_CREATE_SKILL),
            A(
                "Stage all supplied values. Next open field is secondaryPhone.",
                None,
                tool="stage_contact_draft",
                arguments={
                    "mode": "create",
                    "nextField": "secondaryPhone",
                    "firstName": "Priya",
                    "lastName": "Singh",
                    "primaryEmail": "priya.singh@example.com",
                    "primaryPhone": "+1 415 555 0199",
                    "nextQuestion": "Is there a WhatsApp or secondary phone, or should we skip it?",
                },
            ),
            T(
                "stage_contact_draft",
                {
                    "ok": True,
                    "nextField": "secondaryPhone",
                    "ready": False,
                    "fields": {
                        "firstName": "Priya",
                        "lastName": "Singh",
                        "primaryEmail": "priya.singh@example.com",
                        "primaryPhone": "+1 415 555 0199",
                    },
                },
            ),
            A(
                "Ask the current optional field only.",
                "<p>Should WhatsApp be the same as the primary phone, or skip remaining optional details?</p>",
            ),
            U("Skip the rest."),
            A(
                "Skip remaining optional fields including city and country, then confirmation.",
                None,
                tool="stage_contact_draft",
                arguments={
                    "mode": "create",
                    "nextField": None,
                    "firstName": "Priya",
                    "lastName": "Singh",
                    "primaryEmail": "priya.singh@example.com",
                    "primaryPhone": "+1 415 555 0199",
                    "skippedFields": ["secondaryPhone", "gender", "city", "country"],
                    "ready": True,
                },
            ),
            T(
                "stage_contact_draft",
                {
                    "ready": True,
                    "preview": {
                        "firstName": "Priya",
                        "lastName": "Singh",
                        "primaryEmail": "priya.singh@example.com",
                        "primaryPhone": "+1 415 555 0199",
                    },
                },
            ),
            A(
                "Show preview and ask confirmation. Do not create yet.",
                "<p>Ready to create this contact:</p><ul><li><strong>Name:</strong> Priya Singh</li><li><strong>Email:</strong> priya.singh@example.com</li><li><strong>Phone:</strong> +1 415 555 0199</li></ul><p>Shall I save it?</p>",
            ),
            U("yes"),
            A(
                "Confirmed. Persist with create_contact.",
                None,
                tool="create_contact",
                arguments={
                    "firstName": "Priya",
                    "lastName": "Singh",
                    "primaryEmail": "priya.singh@example.com",
                    "primaryPhone": "+1 415 555 0199",
                },
            ),
            T(
                "create_contact",
                {
                    "id": "ct-4401",
                    "firstName": "Priya",
                    "lastName": "Singh",
                    "primaryEmail": "priya.singh@example.com",
                    "primaryPhone": "+1 415 555 0199",
                },
            ),
            A(
                "Contact returned. Task finished. Do not create again.",
                "<p>Saved <strong>Priya Singh</strong> with priya.singh@example.com and +1 415 555 0199.</p>",
            ),
        ],
        CONTACT_TOOLS,
    )

    search = envelope(
        [
            S(system),
            U("Find Sanju Ravi."),
            A(
                "Search intent. Load contact-search and search the complete name.",
                None,
                tool="get_skill",
                arguments={"skill_id": "contact-search"},
            ),
            T(
                "get_skill",
                {
                    "id": "contact-search",
                    "name": "Contact Search",
                    "version": 1,
                    "tools_preferred": ["list_contacts", "get_contact"],
                    "body": "Pass the full name to list_contacts. If same-name matches, show emails and ask which person.",
                },
            ),
            A(
                "Search with the complete spoken name.",
                None,
                tool="list_contacts",
                arguments={"search": "Sanju Ravi", "limit": 20},
            ),
            T(
                "list_contacts",
                {
                    "count": 2,
                    "contacts": [
                        {"id": "ct-12", "firstName": "Sanju", "lastName": "Ravi", "primaryEmail": "sanju.ravi@acme.com"},
                        {"id": "ct-19", "firstName": "Sanju", "lastName": "Ravi", "primaryEmail": "sanju.ravi@globex.com"},
                    ],
                    "sameNameMatches": True,
                    "message": "Several people share a name. Show each name with its email.",
                },
            ),
            A(
                "Do not pick silently. Ask which email.",
                "<p>Two people are named <strong>Sanju Ravi</strong>:</p><ul><li>sanju.ravi@acme.com</li><li>sanju.ravi@globex.com</li></ul><p>Which person do you mean?</p>",
            ),
        ],
        CONTACT_TOOLS,
    )

    deactivate = envelope(
        [
            S(system),
            U("Deactivate Priya Singh, priya.singh@example.com."),
            A(
                "Deactivate intent with email to disambiguate. Load contact-deactivate and resolve the contact.",
                None,
                tool="get_skill",
                arguments={"skill_id": "contact-deactivate"},
            ),
            T(
                "get_skill",
                {
                    "id": "contact-deactivate",
                    "name": "Contact Deactivate",
                    "tools_preferred": ["get_contact", "stage_contact_draft", "update_contact"],
                    "body": "Resolve the contact, stage isActive=false, confirm once, then update_contact.",
                },
            ),
            A(
                "Resolve by email.",
                None,
                tool="get_contact",
                arguments={"email": "priya.singh@example.com"},
            ),
            T(
                "get_contact",
                {"contact": {"id": "ct-4401", "firstName": "Priya", "lastName": "Singh", "primaryEmail": "priya.singh@example.com", "isActive": True}},
            ),
            A(
                "Stage ready isActive=false preview.",
                None,
                tool="stage_contact_draft",
                arguments={
                    "mode": "update",
                    "contactId": "ct-4401",
                    "isActive": False,
                    "ready": True,
                },
            ),
            T("stage_contact_draft", {"ready": True, "preview": {"isActive": False}}),
            A(
                "Ask once to save.",
                "<p>I'll set <strong>Priya Singh</strong> (priya.singh@example.com) to inactive. Save this change?</p>",
            ),
            U("yes"),
            A(
                "Confirmed. Persist.",
                None,
                tool="update_contact",
                arguments={"contactId": "ct-4401", "isActive": False},
            ),
            T("update_contact", {"id": "ct-4401", "firstName": "Priya", "lastName": "Singh", "isActive": False}),
            A(
                "Quote the returned change.",
                "<p><strong>Priya Singh</strong> is now inactive.</p>",
            ),
        ],
        CONTACT_TOOLS,
    )

    return [
        {"agent": "contact", "id": "contact-create", "skill_load": "get_skill contact-create then stage_contact_draft", "sample": create},
        {"agent": "contact", "id": "contact-search-ambiguous", "skill_load": "get_skill contact-search then list_contacts", "sample": search},
        {"agent": "contact", "id": "contact-deactivate", "skill_load": "get_skill contact-deactivate then get_contact", "sample": deactivate},
    ]


def _analytics_conversations() -> list[dict]:
    ctx = (
        "role: agent\n"
        "permissions: ask_semantic_layer, ask_ontology_layer, sql_analytics, generate_plot, "
        "generate_performance_report, get_metrics, get_metric, route_to_agent\n"
        "surface: performance\n"
        "path: /agent/performance\n"
        "period: 7d\n"
        "active_skills: performance-analytics\n"
        "conversational_history: none\n"
    )
    system = sys_l3(
        "You are the Analytics Agent for Worktual AI Contact Center performance.",
        "performance-analytics is already preloaded. Follow that skill. Do not reload it every follow-up.\n"
        "KPI, rate, count, mix, breakdown, or trend: call ask_semantic_layer FIRST with the user's question and chart_type.\n"
        "On ok=false, choose generate_performance_report or sql_analytics. Never invent numbers.\n"
        "ask_ontology_layer is admin-dashboard causal why/how only — never for KPI retrieval and never on My Performance.\n"
        "After any card or chart, one or two HTML findings and one follow-up question. Never show SQL or tool JSON.",
        ctx,
    )

    kpi = envelope(
        [
            S(system),
            U("What is my resolution rate this month?"),
            A(
                "KPI retrieval. Skill already active. Call ask_semantic_layer first with chart_type=kpi.",
                None,
                tool="ask_semantic_layer",
                arguments={"query": "What is my resolution rate this month?", "chart_type": "kpi", "title": "Resolution rate"},
            ),
            T(
                "ask_semantic_layer",
                {
                    "ok": True,
                    "chart_type": "kpi",
                    "metrics": [{"id": "resolution_rate", "label": "Resolution rate", "value": "86.4%", "unit": "%"}],
                    "rows": [{"label": "Resolution rate", "value": 86.4}],
                },
            ),
            A(
                "Ground the reply in tool values. One finding and one follow-up.",
                "<p>Your resolution rate this month is <strong>86.4%</strong>.</p><p>Would you like the daily trend for the same period?</p>",
            ),
        ],
        ANALYTICS_TOOLS,
    )

    mix = envelope(
        [
            S(system),
            U("Show a pie chart of channel mix for the last 7 days."),
            A(
                "Mix + pie. ask_semantic_layer first with chart_type=pie.",
                None,
                tool="ask_semantic_layer",
                arguments={"query": "channel mix last 7 days", "chart_type": "pie", "title": "Channel mix"},
            ),
            T(
                "ask_semantic_layer",
                {"ok": False, "fallback": "generate_performance_report", "reason": "Semantic layer could not resolve channel mix."},
            ),
            A(
                "Semantic miss. Use generate_performance_report for channel mix pie.",
                None,
                tool="generate_performance_report",
                arguments={
                    "variant": "report",
                    "skill_id": "performance-analytics",
                    "metric_ids": ["channel_mix"],
                    "range": "7d",
                    "chart_type": "pie",
                    "title": "Channel mix",
                },
            ),
            T(
                "generate_performance_report",
                {
                    "ok": True,
                    "chart_type": "pie",
                    "title": "Channel mix",
                    "rows": [
                        {"label": "Voice", "value": 42},
                        {"label": "WhatsApp", "value": 31},
                        {"label": "Webchat", "value": 18},
                        {"label": "Email", "value": 9},
                    ],
                },
            ),
            A(
                "Interpret the returned mix. Do not invent extra channels.",
                "<p>Voice is the largest share at <strong>42%</strong>, followed by WhatsApp at <strong>31%</strong>.</p><p>Want the same mix as a bar chart?</p>",
            ),
        ],
        ANALYTICS_TOOLS,
    )

    lines = envelope(
        [
            S(
                sys_l3(
                    "You are the Analytics Agent for Worktual AI Contact Center performance.",
                    "performance-analytics is preloaded. For one line per channel by day, after semantic miss use sql_analytics GROUP BY day, channel with presentation series_column=channel. Never flatten to a single total line. Never invent numbers. Compact HTML only.",
                    "role: admin\nsurface: dashboard\npath: /admin/dashboard\nactive_skills: performance-analytics\n",
                )
            ),
            U("Show a line chart of conversations per channel by day for the last 7 days."),
            A(
                "Trend with per-channel series. ask_semantic_layer first with chart_type=line.",
                None,
                tool="ask_semantic_layer",
                arguments={
                    "query": "conversations per channel by day last 7 days",
                    "chart_type": "line",
                    "title": "Conversations by channel",
                },
            ),
            T("ask_semantic_layer", {"ok": False, "fallback": "sql_analytics"}),
            A(
                "Need one line per channel. sql_analytics with GROUP BY day, channel and series_column=channel.",
                None,
                tool="sql_analytics",
                arguments={
                    "query_description": "Daily conversation counts per channel for the last 7 days",
                    "sql_query": (
                        "SELECT DATE(COALESCE(assigned_at, resolved_at, ended_at, created_at)) AS day, "
                        "channel, COUNT(*) AS conversations "
                        "FROM ccass.conversations "
                        "WHERE COALESCE(assigned_at, resolved_at, ended_at, created_at) >= CURRENT_DATE - INTERVAL '7 days' "
                        "GROUP BY day, channel ORDER BY day, channel"
                    ),
                    "presentation": {
                        "chart_type": "line",
                        "label_column": "day",
                        "value_column": "conversations",
                        "series_column": "channel",
                    },
                },
            ),
            T(
                "sql_analytics",
                {
                    "ok": True,
                    "chart_type": "line",
                    "rows": [
                        {"day": "2026-09-01", "channel": "voice", "conversations": 40},
                        {"day": "2026-09-01", "channel": "whatsapp", "conversations": 22},
                        {"day": "2026-09-02", "channel": "voice", "conversations": 38},
                        {"day": "2026-09-02", "channel": "whatsapp", "conversations": 28},
                    ],
                },
            ),
            A(
                "One line per channel. Do not flatten. No SQL in the reply.",
                "<p>Voice stays the highest volume day to day, while WhatsApp rises on 2 Sep.</p><p>Want the same view for email and webchat only?</p>",
            ),
        ],
        ANALYTICS_TOOLS,
    )

    return [
        {"agent": "analytics", "id": "analytics-kpi-semantic", "skill_load": "required performance-analytics preloaded; ask_semantic_layer first", "sample": kpi},
        {"agent": "analytics", "id": "analytics-channel-mix-fallback", "skill_load": "preloaded; semantic miss then generate_performance_report", "sample": mix},
        {"agent": "analytics", "id": "analytics-per-channel-lines", "skill_load": "preloaded; semantic miss then sql_analytics series_column=channel", "sample": lines},
    ]


def _monitoring_conversations() -> list[dict]:
    ctx = (
        "role: admin\n"
        "permissions: get_monitoring_snapshot, get_agent_attendance, get_contact_callback_channels, "
        "create_callback_task, force_agent_logout, set_agent_presence, route_to_agent\n"
        "surface: monitoring\n"
        "path: /admin/monitoring\n"
        "conversational_history: none\n"
    )
    system = sys_l3(
        "You are the Monitoring Agent for live workforce operations.",
        "Call a monitoring read tool before every answer about waiting/missed contacts, callbacks, queues, SLA, or presence.\n"
        "Prefer get_monitoring_snapshot. session=offline is logged out. presence=not_ready is logged in and Not Ready. Never label a logged-in agent Offline.\n"
        "Callback assignment uses snapshot agent.id as assignedUserId. Create only after supervisor confirmation.\n"
        "Force logout/presence use snapshot agent.agentId or agentName. Execute the approved tool in the same turn as confirmation.",
        ctx,
    )

    waiting = envelope(
        [
            S(system),
            U("Who is waiting on WhatsApp right now?"),
            A(
                "Live waiting question. Call get_monitoring_snapshot first.",
                None,
                tool="get_monitoring_snapshot",
                arguments={},
            ),
            T(
                "get_monitoring_snapshot",
                {
                    "waitingContacts": [
                        {
                            "contactName": "Bharathi Sivakumar",
                            "channel": "whatsapp",
                            "queueName": "Support",
                            "waitMinutes": 33,
                            "assigned": False,
                        }
                    ],
                    "summary": {"waiting": 1, "missed": 0},
                },
            ),
            A(
                "Lead with count. List only actionable rows.",
                "<p><strong>1</strong> contact is waiting on WhatsApp.</p><ul><li>Bharathi Sivakumar on Support, unassigned, waiting 33m</li></ul>",
            ),
        ],
        MONITORING_TOOLS,
    )

    callback = envelope(
        [
            S(system),
            U("Assign Bharathi's WhatsApp callback to Aarav Sharma."),
            A(
                "Need live snapshot to resolve contact and assignedUserId.",
                None,
                tool="get_monitoring_snapshot",
                arguments={},
            ),
            T(
                "get_monitoring_snapshot",
                {
                    "missedContacts": [
                        {
                            "contactId": "CDP-whatsapp-org1003-919150911820",
                            "contactName": "Bharathi Sivakumar",
                            "channel": "whatsapp",
                            "conversationId": "cv-8891",
                        }
                    ],
                    "agents": [
                        {
                            "id": "user-501",
                            "agentId": "10021",
                            "agentName": "Aarav Sharma",
                            "presence": "ready",
                            "session": "online",
                        }
                    ],
                },
            ),
            A(
                "Channel is known from the missed row. Ask confirmation before create_callback_task.",
                "<p>I'll assign Bharathi Sivakumar's WhatsApp callback to <strong>Aarav Sharma</strong>. Confirm?</p>",
            ),
            U("yes assign it"),
            A(
                "Confirmed. assignedUserId is snapshot agent.id, not agentId.",
                None,
                tool="create_callback_task",
                arguments={
                    "assignedUserId": "user-501",
                    "contactId": "CDP-whatsapp-org1003-919150911820",
                    "conversationId": "cv-8891",
                    "channel": "whatsapp",
                    "assigneeName": "Aarav Sharma",
                    "customerName": "Bharathi Sivakumar",
                },
            ),
            T(
                "create_callback_task",
                {"id": "task-902", "ok": True, "assignedUserId": "user-501", "channel": "whatsapp"},
            ),
            A(
                "State exactly what changed.",
                "<p>Callback for Bharathi Sivakumar on WhatsApp is assigned to <strong>Aarav Sharma</strong>.</p>",
            ),
        ],
        MONITORING_TOOLS,
    )

    presence = envelope(
        [
            S(system),
            U("Set Priya Singh to Not Ready."),
            A(
                "Need snapshot to resolve agent.agentId and current session.",
                None,
                tool="get_monitoring_snapshot",
                arguments={},
            ),
            T(
                "get_monitoring_snapshot",
                {
                    "agents": [
                        {
                            "id": "user-502",
                            "agentId": "10022",
                            "agentName": "Priya Singh",
                            "presence": "ready",
                            "session": "online",
                        }
                    ]
                },
            ),
            A(
                "Logged in and Ready. Ask confirmation. Mutation tool also gates confirmation if called with clear intent; here we confirm first.",
                "<p>Priya Singh is logged in and Ready. Set presence to <strong>Not Ready</strong>?</p>",
            ),
            U("yes"),
            A(
                "Confirmed. Use snapshot agentId.",
                None,
                tool="set_agent_presence",
                arguments={"presence": "not_ready", "agentId": "10022", "agentName": "Priya Singh"},
            ),
            T("set_agent_presence", {"ok": True, "agentId": "10022", "presence": "not_ready"}),
            A(
                "Do not call her Offline.",
                "<p><strong>Priya Singh</strong> is now Not Ready.</p>",
            ),
        ],
        MONITORING_TOOLS,
    )

    return [
        {"agent": "monitoring", "id": "monitoring-waiting-whatsapp", "skill_load": "none; snapshot first", "sample": waiting},
        {"agent": "monitoring", "id": "monitoring-callback-assign", "skill_load": "none; snapshot then confirm then create_callback_task", "sample": callback},
        {"agent": "monitoring", "id": "monitoring-set-not-ready", "skill_load": "none; snapshot then set_agent_presence", "sample": presence},
    ]


def _inbox_conversations() -> list[dict]:
    ctx = (
        "role: agent\n"
        "surface: inbox\n"
        "path: /agent/workspace\n"
        "selected_conversation: cv-8891\n"
        "active_skills: contact-entity-extraction, contact-identity-resolution\n"
        "conversational_history: none\n"
    )
    system = sys_l3(
        "You are the Inbox Agent assisting a live human agent in the selected customer conversation.",
        "Foundational contact skills are preloaded. Before summarizing or drafting, call suggest_reply or get_conversation_context.\n"
        "For company/product/policy questions call get_organization_knowledge once with exactly one module. If empty, do not retry another module.\n"
        "Suggested replies are drafts only. Never send. Return only the exact customer-facing draft for reply assistance.",
        ctx,
    )

    reply = envelope(
        [
            S(system),
            U("Suggest a reply to the customer's last message."),
            A(
                "Reply assistance. Call suggest_reply for the selected conversation.",
                None,
                tool="suggest_reply",
                arguments={},
            ),
            T(
                "suggest_reply",
                {
                    "task": "suggest_reply",
                    "customer": {"name": "Bharathi Sivakumar"},
                    "agentSession": [
                        {"from": "customer", "text": "What are your support hours today?"},
                    ],
                    "organizationHint": "Use get_organization_knowledge for policy hours if needed.",
                },
            ),
            A(
                "Hours are a support policy question. Call knowledge once with module=support.",
                None,
                tool="get_organization_knowledge",
                arguments={"query": "support hours today", "module": "support"},
            ),
            T(
                "get_organization_knowledge",
                {"ok": True, "empty": False, "snippets": [{"title": "Support hours", "text": "Standard US Hours are 9:00–18:00 local time, Monday to Friday."}]},
            ),
            A(
                "Return only the exact message the human should send. No coaching.",
                "We're available today from 9:00 to 18:00. How else can I help?",
            ),
        ],
        INBOX_TOOLS,
    )

    summary = envelope(
        [
            S(system),
            U("Summarize this conversation."),
            A(
                "Explicit summary request. Call summarize_conversation.",
                None,
                tool="summarize_conversation",
                arguments={},
            ),
            T(
                "summarize_conversation",
                {
                    "summary": "Customer asked about billing on their North America invoice. Agent confirmed the invoice period and offered a callback.",
                    "openItems": ["callback not yet scheduled"],
                },
            ),
            A(
                "Grounded summary only.",
                "The customer asked about a North America billing invoice. You confirmed the invoice period and offered a callback, which is not scheduled yet.",
            ),
        ],
        INBOX_TOOLS,
    )

    knowledge_empty = envelope(
        [
            S(system),
            U("What is the refund policy for the platinum plan?"),
            A(
                "Need conversation context then knowledge. Start with get_conversation_context.",
                None,
                tool="get_conversation_context",
                arguments={},
            ),
            T(
                "get_conversation_context",
                {"agentSession": [{"from": "customer", "text": "Do you refund platinum?"}]},
            ),
            A(
                "Policy question. module=support once.",
                None,
                tool="get_organization_knowledge",
                arguments={"query": "refund policy platinum plan", "module": "support"},
            ),
            T(
                "get_organization_knowledge",
                {
                    "ok": True,
                    "empty": True,
                    "message": "I don't have enough knowledge to answer this query right now. Would you like me to connect you with a live agent?",
                },
            ),
            A(
                "Do not retry another module. A live agent is already connected, so do not draft connecting-to-agent copy. State insufficient knowledge.",
                "I don't have enough knowledge in the support library for the platinum refund policy. I can help you ask the customer for the plan name or invoice id if that would help.",
            ),
        ],
        INBOX_TOOLS,
    )

    return [
        {"agent": "inbox", "id": "inbox-suggest-reply", "skill_load": "identity skills preloaded; suggest_reply then knowledge", "sample": reply},
        {"agent": "inbox", "id": "inbox-summarize", "skill_load": "preloaded; summarize_conversation", "sample": summary},
        {"agent": "inbox", "id": "inbox-knowledge-empty", "skill_load": "preloaded; do not retry module", "sample": knowledge_empty},
    ]


def _task_conversations() -> list[dict]:
    ctx = (
        "role: agent\n"
        "surface: tasks-list\n"
        "path: /agent/tasks\n"
        "conversational_history: none\n"
    )
    system = sys_l3(
        "You are the Task Agent for Worktual AI Contact Center.",
        "Call list_tasks or get_task before answering about counts, status, due dates, or details.\n"
        "Use tab=admin_assigned, coworker_assigned, or done; due=today or overdue when asked.\n"
        "Selecting a listed task to work on means call open_task_workspace in the same turn.\n"
        "update_task only for explicit complete, dismiss, or accept_suggestion. Never invent tasks.",
        ctx,
    )

    overdue = envelope(
        [
            S(system),
            U("What tasks are overdue?"),
            A(
                "Need authoritative list with due=overdue.",
                None,
                tool="list_tasks",
                arguments={"due": "overdue"},
            ),
            T(
                "list_tasks",
                {
                    "count": 2,
                    "tasks": [
                        {"id": "task-902", "title": "WhatsApp callback · Bharathi Sivakumar", "status": "open", "dueAt": "2026-09-07T10:00:00Z"},
                        {"id": "task-877", "title": "Email follow-up · North America Billing", "status": "open", "dueAt": "2026-09-06T16:00:00Z"},
                    ],
                },
            ),
            A(
                "Lead with count. Identifying fields only.",
                "<p><strong>2</strong> overdue tasks.</p><ul><li>WhatsApp callback · Bharathi Sivakumar</li><li>Email follow-up · North America Billing</li></ul>",
            ),
        ],
        TASK_TOOLS,
    )

    complete = envelope(
        [
            S(system),
            U("Complete the WhatsApp callback task for Bharathi."),
            A(
                "Need the list to resolve the task, then confirm if not already explicit enough — user asked to complete a named task, so resolve then update_task.",
                None,
                tool="list_tasks",
                arguments={"search": "Bharathi", "due": "overdue"},
            ),
            T(
                "list_tasks",
                {
                    "count": 1,
                    "tasks": [{"id": "task-902", "title": "WhatsApp callback · Bharathi Sivakumar", "status": "open"}],
                },
            ),
            A(
                "One match and explicit complete request. Call update_task.",
                None,
                tool="update_task",
                arguments={"action": "complete", "taskId": "task-902"},
            ),
            T("update_task", {"id": "task-902", "status": "completed"}),
            A(
                "Quote the result.",
                "<p>The WhatsApp callback for Bharathi Sivakumar is completed.</p>",
            ),
        ],
        TASK_TOOLS,
    )

    open_ws = envelope(
        [
            S(system),
            U("Open the first overdue task so I can work on it."),
            A(
                "Need list ordering, then open_task_workspace in the same turn as the selection.",
                None,
                tool="list_tasks",
                arguments={"due": "overdue"},
            ),
            T(
                "list_tasks",
                {
                    "count": 2,
                    "tasks": [
                        {"id": "task-902", "title": "WhatsApp callback · Bharathi Sivakumar", "status": "open"},
                        {"id": "task-877", "title": "Email follow-up · North America Billing", "status": "open"},
                    ],
                },
            ),
            A(
                "First in the returned list. User asked to work on it, so open workspace now.",
                None,
                tool="open_task_workspace",
                arguments={"taskId": "task-902"},
            ),
            T(
                "open_task_workspace",
                {"conversationId": "cv-8891", "path": "/agent/workspace?conversationId=cv-8891"},
            ),
            A(
                "Do not invent a path. Tool returned it.",
                "<p>Opened the WhatsApp callback for Bharathi Sivakumar in the workspace.</p>",
            ),
        ],
        TASK_TOOLS,
    )

    return [
        {"agent": "task", "id": "task-list-overdue", "skill_load": "none", "sample": overdue},
        {"agent": "task", "id": "task-complete", "skill_load": "none", "sample": complete},
        {"agent": "task", "id": "task-open-workspace", "skill_load": "none", "sample": open_ws},
    ]


def _general_conversations() -> list[dict]:
    ctx = (
        "role: admin\n"
        "surface: dashboard\n"
        "path: /admin/dashboard\n"
        "conversational_history: none\n"
    )
    system = sys_l3(
        "You are the user's Worktual co-worker for navigation and official organization information.",
        "Reply without tools for greetings. Call organization tools for company facts. Call navigate only for an explicit page-opening request using /admin/ or /agent/ paths. Never invent organization data. Do not claim navigation unless navigate succeeded.",
        ctx,
    )

    greet = envelope(
        [
            S(system),
            U("Hi"),
            A(
                "Greeting. No tools. Complete introduction as the co-worker.",
                "<p>Hi, I'm your Worktual co-worker. I can help with navigation, organization information, and hand you to a specialist when needed. What would you like to do?</p>",
            ),
        ],
        GENERAL_TOOLS,
    )

    nav = envelope(
        [
            S(system),
            U("Open the queues page."),
            A(
                "Explicit page-opening request. Admin role uses /admin/workforce/queues.",
                None,
                tool="navigate",
                arguments={"path": "/admin/workforce/queues"},
            ),
            T("navigate", {"path": "/admin/workforce/queues"}),
            A(
                "Claim navigation only after success.",
                "<p>Opened <strong>Queues</strong>.</p>",
            ),
        ],
        GENERAL_TOOLS,
    )

    org = envelope(
        [
            S(system),
            U("What is the company support email?"),
            A(
                "Organization contact fact. Call get_organization_details. Do not invent.",
                None,
                tool="get_organization_details",
                arguments={},
            ),
            T(
                "get_organization_details",
                {"name": "Worktual", "supportEmail": "support@worktual.example", "phone": "+1 415 555 0100"},
            ),
            A(
                "Use only returned fields.",
                "<p>The support email is <strong>support@worktual.example</strong>.</p>",
            ),
        ],
        GENERAL_TOOLS,
    )

    return [
        {"agent": "general", "id": "general-greeting", "skill_load": "none", "sample": greet},
        {"agent": "general", "id": "general-navigate-queues", "skill_load": "none", "sample": nav},
        {"agent": "general", "id": "general-org-details", "skill_load": "none", "sample": org},
    ]


def _support_bot_conversations() -> list[dict]:
    system = (
        "ROLE:\nYou are Worktual's customer support bot for Webchat, WhatsApp, Instagram, Facebook, and Email.\n\n"
        "INSTRUCTIONS:\nAnswer greetings without tools.\n"
        "For organization address, phone, email, website, or hours, call get_organization_details.\n"
        "For company, brand, product, policy, how-to, or FAQ, call get_organization_knowledge once with query and exactly one module: business | product | support. Do not retry another module if empty.\n"
        "Call recommend_live_agent_handoff only when the customer explicitly asks for a live agent.\n"
        "When the customer states a name or contact field, call contact_enrich only for empty, explicit update, or confirmed mismatch. Acknowledge only appliedFields.\n\n"
        "CONTEXT:\nchannel: webchat\nactive_skills: contact-entity-extraction, contact-identity-resolution\n"
    )

    greet = envelope(
        [
            S(system),
            U("Hi"),
            A(
                "Greeting. No tools.",
                "Hi, how can I help you today?",
            ),
        ],
        SUPPORT_TOOLS,
    )

    product = envelope(
        [
            S(system),
            U("Does Worktual include WhatsApp in the contact center plan?"),
            A(
                "Product capability question. Call get_organization_knowledge once with module=product.",
                None,
                tool="get_organization_knowledge",
                arguments={"query": "WhatsApp in the contact center plan", "module": "product"},
            ),
            T(
                "get_organization_knowledge",
                {
                    "ok": True,
                    "empty": False,
                    "snippets": [{"text": "Worktual Contact Center includes WhatsApp as a supported digital channel."}],
                },
            ),
            A(
                "Answer from the snippet only.",
                "Yes. WhatsApp is included as a supported digital channel on Worktual Contact Center.",
            ),
        ],
        SUPPORT_TOOLS,
    )

    handoff = envelope(
        [
            S(system),
            U("Please connect me to a live agent. My last name is Kumar."),
            A(
                "Explicit live-agent request. Also lastName stated. Enrich lastName first, then handoff.",
                None,
                tool="contact_enrich",
                arguments={"lastName": "Kumar"},
            ),
            T(
                "contact_enrich",
                {"appliedFields": ["lastName"], "skippedFields": [], "requiresConfirmation": []},
            ),
            A(
                "appliedFields includes lastName. Customer asked for a live agent, so call recommend_live_agent_handoff.",
                None,
                tool="recommend_live_agent_handoff",
                arguments={"reason": "explicit_request"},
            ),
            T("recommend_live_agent_handoff", {"handoff_recommended": True, "reason": "explicit_request"}),
            A(
                "Briefly tell the customer they are being connected. Do not claim other profile fields were saved.",
                "Thanks, I've noted the last name Kumar. I'm connecting you with a live agent now.",
            ),
        ],
        SUPPORT_TOOLS,
    )

    return [
        {"agent": "support_bot", "id": "support-greeting", "skill_load": "identity skills preloaded; no tools on greeting", "sample": greet},
        {"agent": "support_bot", "id": "support-product-knowledge", "skill_load": "preloaded; get_organization_knowledge module=product", "sample": product},
        {"agent": "support_bot", "id": "support-live-agent-and-enrich", "skill_load": "preloaded; contact_enrich then recommend_live_agent_handoff", "sample": handoff},
    ]


def _conversation_assist_conversations() -> list[dict]:
    system = (
        "ROLE:\nYou are a passive L3 Conversation Assist executor supporting a human support agent. "
        "The visible conversation is only customer and human agent.\n\n"
        "INSTRUCTIONS:\nFirst load authoritative conversation context. "
        "Return one JSON object with replyDraft, privateNotes, actionProposal, revision, and sourceMessageId. "
        "replyDraft is only the exact customer-facing draft. Never send a message or execute an action. "
        "Copy revision and sourceMessageId exactly.\n\n"
        "CONTEXT:\nsurface: inbox\nrevision: 3\nsourceMessageId: msg-441\n"
        "active_skills: contact-entity-extraction, contact-identity-resolution\n"
    )

    draft = envelope(
        [
            S(system),
            U("Customer: Can you resend the invoice for August?"),
            A(
                "Load authoritative context before drafting.",
                None,
                tool="get_conversation_context",
                arguments={},
            ),
            T(
                "get_conversation_context",
                {
                    "customer": {"name": "Priya Singh", "primaryEmail": "priya.singh@example.com"},
                    "agentSession": [{"from": "customer", "text": "Can you resend the invoice for August?"}],
                },
            ),
            A(
                "JSON only. No mutation. actionProposal is informational.",
                json.dumps(
                    {
                        "replyDraft": "I can resend the August invoice to priya.singh@example.com. Shall I send it now?",
                        "privateNotes": [
                            {"kind": "fact", "text": "Customer asked to resend August invoice."},
                            {"kind": "missing", "text": "Confirm whether email on file is the destination."},
                        ],
                        "actionProposal": {
                            "actionType": "resend_invoice",
                            "summary": "Resend August invoice after the human confirms.",
                            "collectedInputs": {"customerName": "Priya Singh", "email": "priya.singh@example.com", "period": "August"},
                            "missingInputs": [],
                            "confirmationText": "Send the August invoice to priya.singh@example.com?",
                        },
                        "revision": 3,
                        "sourceMessageId": "msg-441",
                    }
                ),
            ),
        ],
        CONVERSATION_ASSIST_TOOLS,
    )

    notes_only = envelope(
        [
            S(system),
            U("Customer: ok thanks"),
            A(
                "Need context. Likely no action.",
                None,
                tool="get_conversation_context",
                arguments={},
            ),
            T(
                "get_conversation_context",
                {"agentSession": [{"from": "customer", "text": "ok thanks"}]},
            ),
            A(
                "Short acknowledgement draft. actionProposal null.",
                json.dumps(
                    {
                        "replyDraft": "You're welcome. I'm here if anything else comes up.",
                        "privateNotes": [{"kind": "fact", "text": "Customer acknowledged; no new request."}],
                        "actionProposal": None,
                        "revision": 3,
                        "sourceMessageId": "msg-441",
                    }
                ),
            ),
        ],
        CONVERSATION_ASSIST_TOOLS,
    )

    missing = envelope(
        [
            S(system),
            U("Customer: schedule a callback"),
            A(
                "Need context to see whether channel and time exist.",
                None,
                tool="get_conversation_context",
                arguments={},
            ),
            T(
                "get_conversation_context",
                {
                    "customer": {"name": "Bharathi Sivakumar", "contactId": "CDP-whatsapp-org1003-919150911820"},
                    "channel": "whatsapp",
                    "agentSession": [{"from": "customer", "text": "schedule a callback"}],
                },
            ),
            A(
                "Propose callback but do not execute. Missing preferred time.",
                json.dumps(
                    {
                        "replyDraft": "I can arrange a WhatsApp callback. What time works for you today?",
                        "privateNotes": [
                            {"kind": "missing", "text": "Callback time not provided."},
                            {"kind": "fact", "text": "Channel is WhatsApp; contact is Bharathi Sivakumar."},
                        ],
                        "actionProposal": {
                            "actionType": "create_callback_task",
                            "summary": "Create a WhatsApp callback after time is collected and the human approves in coworker chat.",
                            "collectedInputs": {"customerName": "Bharathi Sivakumar", "channel": "whatsapp"},
                            "missingInputs": ["callbackTime", "assignedAgent"],
                            "confirmationText": "Create the WhatsApp callback after the customer picks a time?",
                        },
                        "revision": 3,
                        "sourceMessageId": "msg-441",
                    }
                ),
            ),
        ],
        CONVERSATION_ASSIST_TOOLS,
    )

    return [
        {"agent": "conversation_assist", "id": "ca-invoice-draft", "skill_load": "preloaded; get_conversation_context then JSON", "sample": draft},
        {"agent": "conversation_assist", "id": "ca-thanks", "skill_load": "preloaded", "sample": notes_only},
        {"agent": "conversation_assist", "id": "ca-callback-proposal", "skill_load": "preloaded; propose only, never execute", "sample": missing},
    ]


def _coworker_task_conversations() -> list[dict]:
    ctx = (
        "role: agent\n"
        "surface: inbox\n"
        "selected_conversation: cv-8891\n"
        "active_skills: contact-entity-extraction, contact-identity-resolution\n"
        "conversational_history: none\n"
    )
    system = sys_l3(
        "You are the Coworker Task Assist executor for a human support agent in an active customer conversation.",
        "Read get_conversation_context before asking for information again. Never send a customer message.\n"
        "If an action is requested, load only its allowed procedure, gather missing inputs, show a preview, and request explicit approval.\n"
        "Execute a mutation only after approval. Report the exact tool result. Unrelated work goes to contact_center_super with empty content.",
        ctx,
    )

    info = envelope(
        [
            S(system),
            U("What email do we have for this customer?"),
            A(
                "Informational. Read conversation context first.",
                None,
                tool="get_conversation_context",
                arguments={},
            ),
            T(
                "get_conversation_context",
                {"customer": {"contact": {"id": "ct-4401", "firstName": "Priya", "lastName": "Singh", "primaryEmail": "priya.singh@example.com"}}},
            ),
            A(
                "Grounded answer. Do not invent.",
                "<p>The linked contact is <strong>Priya Singh</strong> with <strong>priya.singh@example.com</strong>.</p>",
            ),
        ],
        COWORKER_TASK_TOOLS,
    )

    create = envelope(
        [
            S(system),
            U("Create a contact from this chat: first name Aarav, last name Sharma, email aarav.sharma@example.com."),
            A(
                "Need conversation context, then load contact-create.",
                None,
                tool="get_conversation_context",
                arguments={},
            ),
            T("get_conversation_context", {"customer": {"name": "Aarav Sharma"}}),
            A(
                "Load contact-create once.",
                None,
                tool="get_skill",
                arguments={"skill_id": "contact-create"},
            ),
            T("get_skill", CONTACT_CREATE_SKILL),
            A(
                "Stage supplied fields. City/country still open unless skipped.",
                None,
                tool="stage_contact_draft",
                arguments={
                    "mode": "create",
                    "nextField": "primaryPhone",
                    "firstName": "Aarav",
                    "lastName": "Sharma",
                    "primaryEmail": "aarav.sharma@example.com",
                },
            ),
            T("stage_contact_draft", {"ok": True, "nextField": "primaryPhone", "ready": False}),
            A(
                "Email satisfies the email-or-phone rule. Still ask phone or skip, then remaining optionals — user may skip. Ask current field.",
                "<p>Should I add a phone number, or skip remaining optional fields and preview the contact?</p>",
            ),
            U("Skip the rest and save it."),
            A(
                "Skip remaining optionals including city/country, then user also asked to save. Still need a ready preview confirmation because save was bundled — stage ready then they already said save. After skip-all, stage ready. They said save, so after ready we can create in the next tool once preview is trusted. Stage skipped then create after ready.",
                None,
                tool="stage_contact_draft",
                arguments={
                    "mode": "create",
                    "nextField": None,
                    "firstName": "Aarav",
                    "lastName": "Sharma",
                    "primaryEmail": "aarav.sharma@example.com",
                    "skippedFields": ["primaryPhone", "secondaryPhone", "gender", "city", "country"],
                    "ready": True,
                },
            ),
            T("stage_contact_draft", {"ready": True, "preview": {"firstName": "Aarav", "lastName": "Sharma", "primaryEmail": "aarav.sharma@example.com"}}),
            A(
                "User already asked to save. Call create_contact now.",
                None,
                tool="create_contact",
                arguments={"firstName": "Aarav", "lastName": "Sharma", "primaryEmail": "aarav.sharma@example.com"},
            ),
            T("create_contact", {"id": "ct-5510", "firstName": "Aarav", "lastName": "Sharma", "primaryEmail": "aarav.sharma@example.com"}),
            A(
                "Report the tool result. Never send to the customer.",
                "<p>Saved contact <strong>Aarav Sharma</strong> with aarav.sharma@example.com. I have not sent anything in the customer conversation.</p>",
            ),
        ],
        COWORKER_TASK_TOOLS,
    )

    route_away = envelope(
        [
            S(system),
            U("What's the org-wide resolution rate on the dashboard?"),
            A(
                "Performance analytics is out of this executor. Route to contact_center_super. Content null.",
                None,
                tool="route_to_agent",
                arguments={
                    "agent_name": "contact_center_super",
                    "query": "Org-wide resolution rate on the admin dashboard.",
                },
            ),
            T(
                "route_to_agent",
                {
                    "ok": True,
                    "routed_to": "contact_center_super",
                    "query": "Org-wide resolution rate on the admin dashboard.",
                },
            ),
        ],
        COWORKER_TASK_TOOLS,
    )

    return [
        {"agent": "coworker_task_assist", "id": "cta-read-email", "skill_load": "identity preloaded; get_conversation_context", "sample": info},
        {"agent": "coworker_task_assist", "id": "cta-create-contact", "skill_load": "get_skill contact-create after context", "sample": create},
        {"agent": "coworker_task_assist", "id": "cta-route-analytics", "skill_load": "route_to_agent only", "sample": route_away},
    ]


def main() -> None:
    conversations = build_conversations()
    by_agent: dict[str, int] = {}
    for item in conversations:
        by_agent[item["agent"]] = by_agent.get(item["agent"], 0) + 1
    payload = {
        "meta": {
            "product": "Worktual AI Contact Center",
            "source": "apps/nlp agents, skill packs, and MCP servers",
            "generated_at": "2026-09-08",
            "envelope": "Each sample is {messages, tools_used} matching the data-collection sample.",
            "excluded": [
                "proactive — headless callback planner, not a chat executor in ALL_AGENT_DEFINITIONS",
            ],
            "assumptions": [
                "Included all chat agents in ALL_AGENT_DEFINITIONS (L1, L2, L3, support_bot).",
                "Queue create follows live queue-create (one staffing form, no Available-agents HTML list).",
                "create_queue success key is id, not queueId.",
                "update_skill_in_system is listed in tools_used for skill-capable agents but is runtime-hidden unless dynamic procedural skills are on; traces use get_skill for LLM-visible load.",
                "interaction_operations_domain wired target is task only (definitions.py), even though an older agent.md mentions general/contact.",
            ],
            "conversation_counts": by_agent,
        },
        "catalog": CATALOG,
        "conversations": conversations,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
    print("Counts:", json.dumps(by_agent, indent=2))


if __name__ == "__main__":
    main()

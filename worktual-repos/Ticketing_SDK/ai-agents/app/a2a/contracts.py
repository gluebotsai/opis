"""A2A typed contracts — envelope, skill-result, and per-skill input schemas."""

from __future__ import annotations

from typing import Any

CONTRACT_VERSION = "1.0"

WORKTUAL_ENVELOPE_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "worktual-envelope.v1.json",
    "title": "WorktualA2AEnvelope",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "commandId",
        "skillId",
        "contractVersion",
        "organizationId",
        "arguments",
    ],
    "properties": {
        "commandId": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "description": "Idempotency key for this Hub command",
        },
        "skillId": {
            "type": "string",
            "minLength": 1,
            "description": "Published Agent Card skill id (tk.*)",
        },
        "contractVersion": {
            "type": "string",
            "const": CONTRACT_VERSION,
        },
        "organizationId": {
            "type": "string",
            "minLength": 1,
            "description": "Tenant organization id",
        },
        "arguments": {
            "type": "object",
            "description": "Skill-specific arguments (see per-skill input schema)",
        },
        "approval": {
            "type": "object",
            "description": "Hub approval evidence for high-impact writes",
            "additionalProperties": True,
        },
        "deadline": {"type": "string", "format": "date-time"},
        "traceparent": {"type": "string"},
        "hopCount": {"type": "integer", "minimum": 0, "maximum": 32},
        "instruction": {
            "type": "string",
            "description": "Optional natural-language instruction for Super/proactive routing",
        },
    },
}

SKILL_RESULT_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "skill-result.v1.json",
    "title": "SkillResultArtifact",
    "type": "object",
    "additionalProperties": True,
    "required": ["outcome"],
    "properties": {
        "outcome": {
            "type": "string",
            "enum": [
                "succeeded",
                "failed",
                "rejected",
                "input_required",
                "auth_required",
                "canceled",
            ],
        },
        "evidence": {"type": "object", "additionalProperties": True},
        "affectedIds": {
            "type": "array",
            "items": {"type": "string"},
        },
        "policy": {"type": "object", "additionalProperties": True},
        "warnings": {
            "type": "array",
            "items": {"type": "string"},
        },
        "retryable": {"type": "boolean"},
        "message": {"type": "string"},
        "data": {"type": "object", "additionalProperties": True},
    },
}

# Minimal reusable argument fragments for Ticketing Hub skills.
_OBJ = {"type": "object", "additionalProperties": True}
_STR = {"type": "string"}
_ARR_STR = {"type": "array", "items": {"type": "string"}}


def _args_schema(
    properties: dict[str, Any],
    required: list[str] | None = None,
    *,
    title: str,
) -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": title,
        "type": "object",
        "additionalProperties": True,
        "properties": properties,
        "required": list(required or []),
    }


# Per-skill input schemas (envelope.arguments). Keys = published skill ids.
SKILL_INPUT_SCHEMAS: dict[str, dict[str, Any]] = {
    "tk.ticket.create": _args_schema(
        {
            "customerName": _STR,
            "customerEmail": _STR,
            "customerPhone": _STR,
            "issue": _STR,
            "subject": _STR,
            "priority": _STR,
            "queue": _STR,
            "instruction": _STR,
        },
        ["issue"],
        title="tk.ticket.create.arguments",
    ),
    "tk.ticket.read": _args_schema(
        {"ticketNumber": _STR, "ticketId": _STR, "instruction": _STR},
        title="tk.ticket.read.arguments",
    ),
    "tk.ticket.list": _args_schema(
        {
            "query": _STR,
            "status": _STR,
            "priority": _STR,
            "assignee": _STR,
            "instruction": _STR,
        },
        title="tk.ticket.list.arguments",
    ),
    "tk.ticket.update": _args_schema(
        {
            "ticketNumber": _STR,
            "status": _STR,
            "priority": _STR,
            "assignee": _STR,
            "instruction": _STR,
        },
        ["ticketNumber"],
        title="tk.ticket.update.arguments",
    ),
    "tk.ticket.escalate": _args_schema(
        {
            "ticketNumber": _STR,
            "assignee": _STR,
            "assigneeId": _STR,
            "targetRole": _STR,
            "instruction": _STR,
        },
        ["ticketNumber"],
        title="tk.ticket.escalate.arguments",
    ),
    "tk.ticket.note.add": _args_schema(
        {"ticketNumber": _STR, "note": _STR, "instruction": _STR},
        ["ticketNumber", "note"],
        title="tk.ticket.note.add.arguments",
    ),
    "tk.ticket.enrich": _args_schema(
        {"issue": _STR, "instruction": _STR},
        title="tk.ticket.enrich.arguments",
    ),
    "tk.ticket.customer.verify": _args_schema(
        {"email": _STR, "phone": _STR, "name": _STR, "instruction": _STR},
        title="tk.ticket.customer.verify.arguments",
    ),
    "tk.ticket.assign.auto": _args_schema(
        {"ticketNumber": _STR, "instruction": _STR},
        title="tk.ticket.assign.auto.arguments",
    ),
    "tk.ticket.assign.resolve": _args_schema(
        {
            "ticketNumber": _STR,
            "assignee": _STR,
            "assigneeId": _STR,
            "instruction": _STR,
        },
        ["ticketNumber"],
        title="tk.ticket.assign.resolve.arguments",
    ),
    "tk.ticket.metrics.read": _args_schema(
        {"range": _STR, "instruction": _STR},
        title="tk.ticket.metrics.read.arguments",
    ),
    "tk.ticket.progress.read": _args_schema(
        {"ticketNumber": _STR, "instruction": _STR},
        title="tk.ticket.progress.read.arguments",
    ),
    "tk.customer.create": _args_schema(
        {"name": _STR, "email": _STR, "phone": _STR, "instruction": _STR},
        ["name"],
        title="tk.customer.create.arguments",
    ),
    "tk.customer.read": _args_schema(
        {"email": _STR, "customerId": _STR, "instruction": _STR},
        title="tk.customer.read.arguments",
    ),
    "tk.customer.list": _args_schema(
        {"query": _STR, "instruction": _STR},
        title="tk.customer.list.arguments",
    ),
    "tk.customer.import": _args_schema(
        {"filename": _STR, "instruction": _STR},
        title="tk.customer.import.arguments",
    ),
    "tk.team.create": _args_schema(
        {
            "name": _STR,
            "description": _STR,
            "members": _ARR_STR,
            "memberIds": _ARR_STR,
            "instruction": _STR,
        },
        ["name"],
        title="tk.team.create.arguments",
    ),
    "tk.team.update": _args_schema(
        {
            "queueId": _STR,
            "name": _STR,
            "description": _STR,
            "members": _ARR_STR,
            "memberIds": _ARR_STR,
            "instruction": _STR,
        },
        title="tk.team.update.arguments",
    ),
    "tk.team.list": _args_schema(
        {"query": _STR, "instruction": _STR},
        title="tk.team.list.arguments",
    ),
    "tk.staff.list": _args_schema(
        {"query": _STR, "instruction": _STR},
        title="tk.staff.list.arguments",
    ),
    "tk.team.members.add": _args_schema(
        {
            "queueId": _STR,
            "members": _ARR_STR,
            "memberIds": _ARR_STR,
            "addMembers": {"type": "boolean"},
            "instruction": _STR,
        },
        title="tk.team.members.add.arguments",
    ),
    "tk.kb.article.create": _args_schema(
        {
            "title": _STR,
            "category": _STR,
            "body": _STR,
            "instruction": _STR,
        },
        ["title"],
        title="tk.kb.article.create.arguments",
    ),
    "tk.kb.article.update": _args_schema(
        {
            "articleId": _STR,
            "title": _STR,
            "category": _STR,
            "body": _STR,
            "instruction": _STR,
        },
        ["articleId"],
        title="tk.kb.article.update.arguments",
    ),
    "tk.kb.search": _args_schema(
        {"query": _STR, "instruction": _STR},
        title="tk.kb.search.arguments",
    ),
    "tk.kb.category.manage": _args_schema(
        {"name": _STR, "action": _STR, "instruction": _STR},
        title="tk.kb.category.manage.arguments",
    ),
    "tk.macro.create": _args_schema(
        {"title": _STR, "body": _STR, "instruction": _STR},
        ["title", "body"],
        title="tk.macro.create.arguments",
    ),
    "tk.macro.update": _args_schema(
        {"macroId": _STR, "title": _STR, "body": _STR, "instruction": _STR},
        ["macroId"],
        title="tk.macro.update.arguments",
    ),
    "tk.macro.list": _args_schema(
        {"query": _STR, "instruction": _STR},
        title="tk.macro.list.arguments",
    ),
    "tk.catalog.priority.create": _args_schema(
        {
            "displayName": _STR,
            "name": _STR,
            "resolutionHours": {"type": "number"},
            "instruction": _STR,
        },
        title="tk.catalog.priority.create.arguments",
    ),
    "tk.catalog.priority.update": _args_schema(
        {
            "priorityId": _STR,
            "displayName": _STR,
            "resolutionHours": {"type": "number"},
            "instruction": _STR,
        },
        title="tk.catalog.priority.update.arguments",
    ),
    "tk.catalog.status.create": _args_schema(
        {"displayName": _STR, "name": _STR, "instruction": _STR},
        title="tk.catalog.status.create.arguments",
    ),
    "tk.catalog.status.update": _args_schema(
        {"statusId": _STR, "displayName": _STR, "instruction": _STR},
        title="tk.catalog.status.update.arguments",
    ),
    "tk.analytics.query": _args_schema(
        {"question": _STR, "range": _STR, "instruction": _STR},
        title="tk.analytics.query.arguments",
    ),
    "tk.analytics.root-cause.analyze": _args_schema(
        {"question": _STR, "instruction": _STR},
        title="tk.analytics.root-cause.analyze.arguments",
    ),
    "tk.csat.report.read": _args_schema(
        {"range": _STR, "instruction": _STR},
        title="tk.csat.report.read.arguments",
    ),
    "tk.audit.list": _args_schema(
        {"query": _STR, "instruction": _STR},
        title="tk.audit.list.arguments",
    ),
    "tk.escalation.directory.read": _args_schema(
        {"instruction": _STR},
        title="tk.escalation.directory.read.arguments",
    ),
    "tk.proactive.run": _args_schema(
        {
            "eventType": _STR,
            "agentId": _STR,
            "payload": _OBJ,
            "instruction": _STR,
        },
        title="tk.proactive.run.arguments",
    ),
    "tk.super-agent.route": _args_schema(
        {"instruction": _STR, "message": _STR},
        title="tk.super-agent.route.arguments",
    ),
}

# Proactive granular skills share a flexible payload envelope.
_PROACTIVE_INPUT = _args_schema(
    {
        "eventType": _STR,
        "payload": _OBJ,
        "ticketNumber": _STR,
        "instruction": _STR,
    },
    title="tk.proactive.*.arguments",
)

for _pid in (
    "tk.proactive.inbound.deflect",
    "tk.proactive.inbound.capture",
    "tk.proactive.ticket.classify",
    "tk.proactive.ticket.route",
    "tk.proactive.ticket.summarize",
    "tk.proactive.ticket.similar-detect",
    "tk.proactive.kb.recommend",
    "tk.proactive.reply.draft",
    "tk.proactive.ticket.close-assist",
    "tk.proactive.sla.monitor",
    "tk.proactive.workload.optimize",
    "tk.proactive.insights.analyze",
    "tk.proactive.routing.learn",
):
    SKILL_INPUT_SCHEMAS[_pid] = {
        **_PROACTIVE_INPUT,
        "title": f"{_pid}.arguments",
        "$id": f"{_pid}.v1.json",
    }

SKILL_INPUT_SCHEMAS["tk.proactive.notify.staff"] = _args_schema(
    {
        "user_id": {
            **_STR,
            "description": (
                "Staff user id from tk.staff.list (Postgres list_agents) "
                "or a staff id Hub already has. Never invent this value."
            ),
        },
        "title": {
            **_STR,
            "description": "Bell title.",
        },
        "message": {
            **_STR,
            "description": "Bell body text.",
        },
    },
    ["user_id"],
    title="tk.proactive.notify.staff.arguments",
)
SKILL_INPUT_SCHEMAS["tk.proactive.notify.staff"]["$id"] = (
    "tk.proactive.notify.staff.v1.json"
)
SKILL_INPUT_SCHEMAS["tk.proactive.notify.staff"]["description"] = (
    "Notify a Ticketing staff member in the header bell."
)


def skill_input_schema(skill_id: str) -> dict[str, Any] | None:
    schema = SKILL_INPUT_SCHEMAS.get(str(skill_id or "").strip())
    if not schema:
        return None
    out = dict(schema)
    out.setdefault("$id", f"{skill_id}.v1.json")
    return out


def contract_document(name: str) -> dict[str, Any] | None:
    key = str(name or "").strip().lower()
    if key in {
        "worktual-envelope.v1.json",
        "worktual-envelope.v1",
        "envelope",
    }:
        return WORKTUAL_ENVELOPE_SCHEMA
    if key in {
        "skill-result.v1.json",
        "skill-result.v1",
        "result",
    }:
        return SKILL_RESULT_SCHEMA
    return None

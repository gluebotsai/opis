"""Per-skill JSON Schema contracts for Hub typed-skills discovery."""

from __future__ import annotations

from typing import Any

from cc_a2a.catalog import SkillSpec, get_skill, list_skills
from cc_a2a.contracts import CONTRACT_VERSION, SkillResultArtifact, WorktualEnvelope

# Shared argument property definitions used across skills.
_ARG_PROPS: dict[str, dict[str, Any]] = {
    "search": {"type": "string", "description": "Free-text search query"},
    "limit": {"type": "integer", "minimum": 1, "maximum": 100},
    "contactId": {"type": "string", "minLength": 1},
    "email": {"type": "string", "format": "email"},
    "fullName": {"type": "string"},
    "firstName": {"type": "string", "minLength": 1},
    "lastName": {"type": "string"},
    "primaryEmail": {"type": "string"},
    "primaryPhone": {"type": "string"},
    "secondaryEmail": {"type": "string"},
    "secondaryPhone": {"type": "string"},
    "isActive": {"type": "boolean"},
    "conversationId": {"type": "string", "minLength": 1},
    "taskId": {"type": "string", "minLength": 1},
    "queueId": {"type": "string", "minLength": 1},
    "queueName": {"type": "string", "minLength": 1},
    "agentName": {"type": "string", "minLength": 1},
    "agentId": {"type": "string", "minLength": 1},
    "userId": {"type": "string", "minLength": 1},
    "addAgents": {
        "type": "array",
        "description": (
            "People to assign. Strings are names; objects may include name, agentName, "
            "id, userId, shiftType, channels, capacity, and callType."
        ),
        "items": {"type": ["string", "object"]},
    },
    "removeAgentNames": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Assigned agent names to unassign.",
    },
    "removeAgentIds": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Assigned agent user ids to unassign.",
    },
    "agents": {
        "type": "array",
        "items": {"type": ["string", "object"]},
        "description": "Alias for addAgents or removeAgentNames depending on the skill.",
    },
    "shiftType": {"type": "string"},
    "channels": {"type": "array", "items": {"type": "string"}},
    "capacity": {"type": "integer", "minimum": 1},
    "callType": {"type": "string"},
    "name": {"type": "string", "minLength": 1},
    "status": {"type": "string"},
    "teamName": {"type": "string"},
    "teamId": {"type": "string"},
    "description": {"type": "string"},
    "businessHoursId": {"type": "string"},
    "question": {"type": "string", "minLength": 1},
    "query": {"type": "string", "minLength": 1},
    "module": {
        "type": "string",
        "enum": ["business", "product", "support"],
        "description": "Knowledge module",
    },
    "assignedUserId": {"type": "string", "minLength": 1},
    "presence": {"type": "string", "enum": ["ready", "not_ready"]},
    "channel": {"type": "string"},
    "webchatId": {
        "type": "string",
        "pattern": "^wc_[a-fA-F0-9]{32}$",
        "description": (
            "Webchat widget id. Optional — when omitted, the spoke resolves the "
            "organization's first active webchat from setup."
        ),
    },
    "visitorId": {"type": "string", "minLength": 1},
    "text": {"type": "string", "minLength": 1, "maxLength": 4000},
    "autoSessionStart": {"type": "boolean"},
    "reason": {"type": "string", "maxLength": 128},
    "pageUrl": {"type": "string", "format": "uri", "maxLength": 4096},
    "number": {
        "type": "string",
        "minLength": 1,
        "maxLength": 32,
        "description": "Customer number to dial. Published as ddi.",
    },
    "data": {
        "type": "object",
        "description": "Customer fields passed through to the voice bot.",
        "additionalProperties": True,
    },
    "instruction": {
        "type": "string",
        "maxLength": 4000,
        "description": "Text the voice bot should follow on the call.",
    },
    "action": {
        "type": "string",
        "enum": ["accept", "accept_suggestion", "complete", "dismiss"],
    },
    "confirmedFields": {"type": "array", "items": {"type": "string"}},
}


# Extra properties advertised for specific skills beyond required keys.
_SKILL_EXTRA_PROPS: dict[str, tuple[str, ...]] = {
    "cc.knowledge.search": ("module", "query", "question"),
    "cc.contact.list": ("search", "limit"),
    "cc.contact.read": ("contactId", "email", "fullName"),
    "cc.contact.create": (
        "firstName",
        "lastName",
        "primaryEmail",
        "primaryPhone",
        "isActive",
    ),
    "cc.contact.update": (
        "contactId",
        "firstName",
        "lastName",
        "primaryEmail",
        "primaryPhone",
        "isActive",
    ),
    "cc.contact.status.update": ("contactId", "isActive"),
    "cc.contact.enrich": ("conversationId", "confirmedFields"),
    "cc.conversation.context.read": ("conversationId",),
    "cc.conversation.summarize": ("conversationId",),
    "cc.conversation.reply.suggest": ("conversationId",),
    "cc.conversation.contact.enrich": ("conversationId", "confirmedFields"),
    "cc.task.list": ("limit",),
    "cc.task.read": ("taskId",),
    "cc.task.accept": ("taskId",),
    "cc.task.complete": ("taskId",),
    "cc.task.dismiss": ("taskId",),
    "cc.queue.agent.add": (
        "queueName",
        "queueId",
        "addAgents",
        "agents",
        "agentName",
        "agentId",
        "userId",
        "shiftType",
        "channels",
        "capacity",
        "callType",
    ),
    "cc.queue.agent.remove": (
        "queueName",
        "queueId",
        "removeAgentNames",
        "removeAgentIds",
        "agents",
        "agentName",
        "agentId",
        "userId",
    ),
    "cc.queue.create": ("name", "teamName", "teamId", "status", "description", "businessHoursId"),
    "cc.queue.status.update": ("queueId", "status"),
    "cc.queue.delete": ("queueId",),
    "cc.queue.agent-eligibility.read": ("queueId", "teamName", "teamId"),
    "cc.analytics.query": ("question", "query"),
    "cc.analytics.root-cause.analyze": ("question", "query"),
    "cc.monitoring.attendance.read": ("agentId", "agentName"),
    "cc.monitoring.callback-channels.read": ("contactId",),
    "cc.callback.create": ("assignedUserId", "contactId", "conversationId", "channel"),
    "cc.agent.logout": ("agentId", "agentName"),
    "cc.agent.presence.update": ("agentId", "agentName", "presence"),
    "cc.webchat.proactive-engagement.trigger": (
        "webchatId",
        "visitorId",
        "text",
        "autoSessionStart",
        "reason",
        "pageUrl",
    ),
    "cc.voice.auto-bot-call.trigger": ("number", "data", "instruction"),
    "cc.anomaly.investigate": ("question", "query"),
}


def skill_contract_path(skill_id: str) -> str:
    return f"/a2a/contracts/skills/{skill_id}.v1.json"


def skill_contract_url(public_url: str, skill_id: str) -> str:
    return f"{public_url.rstrip('/')}{skill_contract_path(skill_id)}"


def _arguments_schema(skill: SkillSpec) -> dict[str, Any]:
    keys = list(dict.fromkeys([*skill.required_argument_keys, *_SKILL_EXTRA_PROPS.get(skill.skill_id, ())]))
    # Include alias targets/sources so Hub can send either form.
    for source, target in skill.argument_aliases.items():
        if source not in keys:
            keys.append(source)
        if target not in keys:
            keys.append(target)
    for key in skill.argument_defaults:
        if key not in keys:
            keys.append(key)

    properties: dict[str, Any] = {}
    for key in keys:
        properties[key] = dict(_ARG_PROPS.get(key, {"type": ["string", "number", "boolean", "object", "array", "null"]}))

    schema: dict[str, Any] = {
        "type": "object",
        "description": f"Arguments for skill {skill.skill_id}",
        "properties": properties,
        "additionalProperties": True,
    }
    if skill.required_argument_keys:
        schema["required"] = list(skill.required_argument_keys)
    return schema


def build_skill_contract(skill: SkillSpec, *, public_url: str = "") -> dict[str, Any]:
    """Full request contract: Worktual envelope with skill-specific arguments."""
    envelope = WorktualEnvelope.model_json_schema()
    arguments = _arguments_schema(skill)
    path = skill_contract_path(skill.skill_id)
    absolute = skill_contract_url(public_url, skill.skill_id) if public_url else path

    # Specialize envelope.properties.arguments and skillId const.
    props = dict(envelope.get("properties") or {})
    props["skillId"] = {
        "type": "string",
        "const": skill.skill_id,
        "description": skill.name,
    }
    props["arguments"] = arguments
    props["contractVersion"] = {
        "type": "string",
        "const": CONTRACT_VERSION,
    }

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": absolute,
        "title": f"{skill.skill_id} request contract",
        "description": skill.description,
        "type": "object",
        "required": ["commandId", "skillId", "contractVersion", "organizationId", "arguments"],
        "properties": props,
        "additionalProperties": False,
        "x-worktual": {
            "contractVersion": CONTRACT_VERSION,
            "skillId": skill.skill_id,
            "name": skill.name,
            "super": "contact_center_super",
            "domain": skill.domain,
            "executor": skill.specialist,
            "specialist": skill.specialist,
            "surface": skill.surface,
            "scope": skill.scope,
            "risk": skill.risk,
            "requiredArgumentKeys": list(skill.required_argument_keys),
            "argumentDefaults": dict(skill.argument_defaults),
            "argumentAliases": dict(skill.argument_aliases),
            "orchestration": list(skill.orchestration),
            "examples": list(skill.examples),
            "resultSchema": "/a2a/contracts/skill-result.v1.json",
            "envelopeSchema": "/a2a/contracts/worktual-envelope.v1.json",
        },
    }


def get_skill_contract(skill_id: str, *, public_url: str = "") -> dict[str, Any] | None:
    # Accept optional .v1.json suffix in path param handling upstream.
    skill = get_skill(skill_id)
    if skill is None or not skill.published:
        return None
    return build_skill_contract(skill, public_url=public_url)


def list_skill_contract_paths() -> list[str]:
    return [skill_contract_path(skill.skill_id) for skill in list_skills()]


def result_contract() -> dict[str, Any]:
    return SkillResultArtifact.model_json_schema()

"""JSON Schema contracts advertised on the CRM Agent Card."""

from __future__ import annotations

from typing import Any

from app.a2a.catalog import SpokeSkill, get_spoke_skill, hub_required_argument_keys

ENVELOPE_PATH = "/a2a/contracts/worktual-envelope.v1.json"
RESULT_PATH = "/a2a/contracts/skill-result.v1.json"

WORKTUAL_ENVELOPE_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": ENVELOPE_PATH,
    "title": "Worktual CRM A2A envelope",
    "type": "object",
    "additionalProperties": True,
    "required": ["skillId", "organizationId"],
    "properties": {
        "commandId": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "description": "Optional idempotency key (8–128 chars).",
        },
        "skillId": {
            "type": "string",
            "description": "Published Agent Card skill id (optional hint when instruction is present).",
        },
        "contractVersion": {
            "type": "string",
            "const": "1.0",
            "description": "Typed-skills contract version.",
        },
        "organizationId": {
            "type": "string",
            "description": "Tenant id. Required on every Hub task.",
        },
        "cdpId": {
            "type": "string",
            "description": "Person key (cdp.customer_profile.cdp_id). Alias contactId.",
        },
        "contactId": {"type": "string"},
        "source": {
            "type": "string",
            "description": "Must be hub for Hub-originated work (no ping-pong).",
        },
        "arguments": {
            "type": "object",
            "additionalProperties": True,
            "description": "Skill-specific arguments. Also accepted at the envelope top level.",
        },
        "instruction": {
            "description": "Hub goal text or command object (actionType, description, …).",
        },
        "approval": {
            "type": "object",
            "additionalProperties": True,
            "description": "Hub approval evidence for high-impact skills.",
        },
        "deadline": {"type": "string"},
        "traceparent": {"type": "string"},
        "hopCount": {"type": "integer", "minimum": 0},
    },
}

SKILL_RESULT_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": RESULT_PATH,
    "title": "Worktual CRM skill result artifact",
    "type": "object",
    "additionalProperties": True,
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
        "status": {"type": "string"},
        "ok": {"type": "boolean"},
        "skillId": {"type": "string"},
        "agentName": {"type": "string"},
        "evidence": {"type": "object", "additionalProperties": True},
        "affectedIds": {"type": "object", "additionalProperties": True},
        "policy": {"type": "object", "additionalProperties": True},
        "warnings": {"type": "array", "items": {"type": "string"}},
        "retryable": {"type": "boolean"},
        "error": {"type": "string"},
        "missingFields": {"type": "array", "items": {"type": "string"}},
        "receipt": {"type": "object", "additionalProperties": True},
    },
}


def skill_input_schema(skill: SpokeSkill) -> dict[str, Any]:
    props: dict[str, Any] = {
        "organizationId": {"type": "string"},
        "skillId": {"type": "string", "const": skill.id},
        "contractVersion": {"type": "string", "const": "1.0"},
        "cdpId": {
            "type": "string",
            "description": "Person key (cdp.customer_profile.cdp_id). Alias contactId.",
        },
        "contactId": {
            "type": "string",
            "description": "Alias of cdpId; Hub should send cdpId.",
        },
        "source": {"type": "string"},
        "instruction": {},
        "arguments": {"type": "object", "additionalProperties": True},
    }
    for field in skill.required_fields:
        if field not in props:
            props[field] = {"type": "string"}
    required = list(hub_required_argument_keys(skill))
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"/a2a/contracts/skills/{skill.id}.v1.json",
        "title": f"CRM skill arguments: {skill.id}",
        "type": "object",
        "additionalProperties": True,
        "required": required,
        "properties": props,
        "description": skill.description,
    }


def envelope_schema() -> dict[str, Any]:
    return WORKTUAL_ENVELOPE_SCHEMA


def result_schema() -> dict[str, Any]:
    return SKILL_RESULT_SCHEMA


def skill_contract(skill_id: str) -> dict[str, Any] | None:
    skill = get_spoke_skill(skill_id)
    if skill is None:
        return None
    return skill_input_schema(skill)

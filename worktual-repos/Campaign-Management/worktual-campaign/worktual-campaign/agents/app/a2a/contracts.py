"""JSON Schema contracts advertised by the Campaign Agent Card.

Hub fetches these via paths on the card (inputSchema / outputSchema / capability params).
Schemas are the source of truth for typed skill arguments and results.
"""

from __future__ import annotations

from typing import Any

from app.a2a.catalog import RESULT_SCHEMA_PATH, skill_ids

CHANNEL_ENUM = ["email", "whatsapp", "web", "push", "sms", "app_push"]

_ON_DEMAND_PROPS: dict[str, Any] = {
    "request_text": {
        "type": "string",
        "description": (
            "Strongly recommended: natural-language operator brief for create+launch "
            "(trigger, customer facts, subject/body guidance). Canonical field name."
        ),
    },
    "channels": {
        "type": "array",
        "items": {"type": "string", "enum": CHANNEL_ENUM},
        "description": "Channels to launch",
    },
    "cdpId": {"type": "string", "description": "Person-scoped CDP id"},
    "cdp_id": {"type": "string"},
    "contact_ids": {"type": "array", "items": {"type": "string"}},
    "customer_ids": {"type": "array", "items": {"type": "string"}},
    "emails": {
        "type": "array",
        "items": {"type": "string", "format": "email"},
    },
    "phones": {"type": "array", "items": {"type": "string"}},
    "name": {"type": "string", "description": "Optional campaign name"},
    "goal": {"type": "string"},
    "objective": {"type": "string"},
    "instruction": {
        "description": "Optional Hub instruction object or string mapped to request_text",
    },
}

_CONTACT_PROPS: dict[str, Any] = {
    "first_name": {"type": "string", "minLength": 1},
    "last_name": {"type": "string"},
    "email": {"type": "string", "format": "email"},
    "phone": {"type": "string"},
    "company_name": {"type": "string"},
    "city": {"type": "string"},
}


def envelope_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "worktual-envelope.v1",
        "title": "Worktual Campaign Hub envelope",
        "type": "object",
        "required": ["source", "organizationId", "skillId"],
        "properties": {
            "source": {
                "type": "string",
                "const": "hub",
                "description": "Must be hub for Hub→Campaign invokes",
            },
            "organizationId": {
                "type": "string",
                "minLength": 1,
                "description": "Tenant organization id",
            },
            "organization_id": {"type": "string", "minLength": 1},
            "skillId": {
                "type": "string",
                "enum": skill_ids(),
                "description": "Published Agent Card skill id",
            },
            "skill_id": {"type": "string"},
            "contractVersion": {"type": "string", "const": "1.0"},
            "commandId": {
                "type": "string",
                "minLength": 8,
                "maxLength": 128,
                "description": "Optional idempotency key",
            },
            "cdpId": {"type": "string"},
            "cdp_id": {"type": "string"},
            "campaignToken": {
                "type": "string",
                "description": (
                    "Optional Campaign API JWT. Spoke can mint from organizationId "
                    "when omitted."
                ),
            },
            "arguments": {
                "type": "object",
                "description": (
                    "Preferred skill-specific args. Flat Hub payloads (legacy) "
                    "are also accepted at the top level."
                ),
            },
        },
        "additionalProperties": True,
    }


def skill_result_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "skill-result.v1",
        "title": "Campaign skill result (campaign-receipt artifact data)",
        "type": "object",
        "required": ["ok", "skillId", "organizationId", "status"],
        "properties": {
            "ok": {"type": "boolean"},
            "skillId": {"type": "string"},
            "organizationId": {"type": "string"},
            "status": {
                "type": "string",
                "enum": ["completed", "partial", "failed", "input-required"],
            },
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
            "pipeline": {"type": "array", "items": {"type": "string"}},
            "result": {"type": "object"},
            "warnings": {"type": "array"},
            "errors": {"type": "array"},
            "step_results": {"type": "array"},
            "input_required": {"type": "array", "items": {"type": "string"}},
        },
        "additionalProperties": True,
    }


def _skill_args_schema(
    *,
    skill_id: str,
    title: str,
    description: str,
    properties: dict[str, Any],
    required: list[str] | None = None,
    any_of: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"skills/{skill_id}.v1",
        "title": title,
        "description": description,
        "type": "object",
        "properties": properties,
        "additionalProperties": True,
    }
    if required:
        schema["required"] = required
    if any_of:
        schema["anyOf"] = any_of
    return schema


def skill_argument_schemas() -> dict[str, dict[str, Any]]:
    """skillId → JSON Schema for that skill's arguments."""
    return {
        "on-demand-send": _skill_args_schema(
            skill_id="on-demand-send",
            title="on-demand-send arguments",
            description=(
                "Create+launch arguments. Required in practice: audience (cdpId, "
                "contact_ids, emails, and/or phones). Strongly recommended: "
                "request_text (operator brief). Optional alias: instruction → "
                "request_text. No JSON required[] — minimal payloads may run with "
                "generic copy."
            ),
            properties=dict(_ON_DEMAND_PROPS),
        ),
        "create-contact": _skill_args_schema(
            skill_id="create-contact",
            title="create-contact arguments",
            description="Requires first_name and either email or phone.",
            properties=dict(_CONTACT_PROPS),
            required=["first_name"],
            any_of=[
                {"required": ["email"]},
                {"required": ["phone"]},
            ],
        ),
        "campaign-report": _skill_args_schema(
            skill_id="campaign-report",
            title="campaign-report arguments",
            description="Requires campaign_id.",
            properties={
                "campaign_id": {"type": "string", "minLength": 1},
                "action": {"type": "string", "description": "Optional; defaults to report"},
            },
            required=["campaign_id"],
        ),
        "stop-channel": _skill_args_schema(
            skill_id="stop-channel",
            title="stop-channel arguments",
            description="Pause one channel on a live campaign.",
            properties={
                "campaign_id": {"type": "string", "minLength": 1},
                "channel": {"type": "string", "enum": CHANNEL_ENUM},
                "reason": {"type": "string", "minLength": 1},
            },
            required=["campaign_id", "channel", "reason"],
        ),
        "resume-channel": _skill_args_schema(
            skill_id="resume-channel",
            title="resume-channel arguments",
            description="Resume one paused campaign channel.",
            properties={
                "campaign_id": {"type": "string", "minLength": 1},
                "channel": {"type": "string", "enum": CHANNEL_ENUM},
            },
            required=["campaign_id", "channel"],
        ),
        "stop-campaign": _skill_args_schema(
            skill_id="stop-campaign",
            title="stop-campaign arguments",
            description="Stop an entire campaign.",
            properties={
                "campaign_id": {"type": "string", "minLength": 1},
                "reason": {"type": "string", "minLength": 1},
            },
            required=["campaign_id", "reason"],
        ),
        "create-contact-and-send": _skill_args_schema(
            skill_id="create-contact-and-send",
            title="create-contact-and-send arguments",
            description=(
                "Composite: contact fields plus on-demand launch fields. "
                "Requires first_name and either email or phone."
            ),
            properties={**_CONTACT_PROPS, **_ON_DEMAND_PROPS},
            required=["first_name"],
            any_of=[
                {"required": ["email"]},
                {"required": ["phone"]},
            ],
        ),
        "send-approved-whatsapp": _skill_args_schema(
            skill_id="send-approved-whatsapp",
            title="send-approved-whatsapp arguments",
            description=(
                "Approved-template send. Provide phones and/or contact_ids; "
                "optional template_id/template_name and request_text."
            ),
            properties={
                "request_text": {
                    "type": "string",
                    "description": "Natural-language send instruction for the executor",
                },
                "template_id": {"type": "string"},
                "template_name": {"type": "string"},
                "phones": {"type": "array", "items": {"type": "string"}},
                "contact_ids": {"type": "array", "items": {"type": "string"}},
                "user_confirmed": {
                    "type": "boolean",
                    "description": "Hub implies confirmation when true (default true)",
                },
            },
        ),
        "generate-image": _skill_args_schema(
            skill_id="generate-image",
            title="generate-image arguments",
            description="Image generation prompt; optional campaign attach context.",
            properties={
                "prompt": {"type": "string", "minLength": 1},
                "request_text": {"type": "string"},
                "campaign_id": {"type": "string"},
                "attach_to_template": {"type": "boolean"},
            },
            required=["prompt"],
        ),
        "temp-audience-and-send": _skill_args_schema(
            skill_id="temp-audience-and-send",
            title="temp-audience-and-send arguments",
            description=(
                "Inline contact rows (email or phone each) plus on-demand launch fields."
            ),
            properties={
                "rows": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {
                            "first_name": {"type": "string"},
                            "firstName": {"type": "string"},
                            "last_name": {"type": "string"},
                            "lastName": {"type": "string"},
                            "email": {"type": "string", "format": "email"},
                            "phone": {"type": "string"},
                            "whatsappNumber": {"type": "string"},
                            "phoneNumber": {"type": "string"},
                            "company_name": {"type": "string"},
                            "city": {"type": "string"},
                        },
                        "additionalProperties": True,
                    },
                },
                **_ON_DEMAND_PROPS,
            },
            required=["rows"],
        ),
    }


def resolve_contract(path: str) -> dict[str, Any] | None:
    """Map request path (with or without leading slash) to a schema document."""
    key = "/" + str(path or "").lstrip("/")
    if key == "/a2a/contracts/worktual-envelope.v1.json":
        return envelope_schema()
    if key == RESULT_SCHEMA_PATH or key == "/a2a/contracts/skill-result.v1.json":
        return skill_result_schema()
    prefix = "/a2a/contracts/skills/"
    if key.startswith(prefix) and key.endswith(".v1.json"):
        skill_id = key[len(prefix) : -len(".v1.json")]
        return skill_argument_schemas().get(skill_id)
    return None

"""Public and extended Agent Card builders (A2A v1.0 JSON)."""

from __future__ import annotations

from typing import Any

from cc_a2a.catalog import EXCLUDED_CAPABILITIES, list_skills
from cc_a2a.config import A2ASettings
from cc_a2a.contracts import TYPED_SKILLS_EXTENSION
from cc_a2a.skill_contracts import skill_contract_path, skill_contract_url


def _skill_card(skill: Any, *, detailed: bool, public_url: str) -> dict[str, Any]:
    input_schema_path = skill_contract_path(skill.skill_id)
    card: dict[str, Any] = {
        "id": skill.skill_id,
        "name": skill.name,
        "description": skill.description,
        "tags": list(skill.tags),
        "examples": list(skill.examples),
        "inputModes": ["application/json"],
        "outputModes": ["application/json"],
        "security": [{"oauth2": [skill.scope]}],
        # Advertise schema URLs on both public and extended cards so Hub
        # discovery does not need to guess paths.
        "inputSchema": input_schema_path,
        "outputSchema": "/a2a/contracts/skill-result.v1.json",
    }
    if detailed:
        card["extensions"] = [
            {
                "uri": TYPED_SKILLS_EXTENSION,
                "required": True,
                "params": {
                    "contractVersion": "1.0",
                    "super": "contact_center_super",
                    "domain": skill.domain,
                    "executor": skill.specialist if skill.specialist != "super" else "analytics",
                    "specialist": skill.specialist,
                    "surface": skill.surface,
                    "risk": skill.risk,
                    "scope": skill.scope,
                    "requiredArgumentKeys": list(skill.required_argument_keys),
                    "mcpServer": skill.mcp_server,
                    "mcpTool": skill.mcp_tool,
                    "orchestration": list(skill.orchestration),
                    "inputSchema": input_schema_path,
                    "inputSchemaUrl": skill_contract_url(public_url, skill.skill_id),
                    "outputSchema": "/a2a/contracts/skill-result.v1.json",
                },
            }
        ]
    return card


def build_public_agent_card(settings: A2ASettings) -> dict[str, Any]:
    public_url = settings.a2a_public_url.rstrip("/")
    skills = [
        _skill_card(skill, detailed=False, public_url=public_url) for skill in list_skills()
    ]
    security_schemes: dict[str, Any] = {}
    token_url = settings.a2a_oauth_token_url or f"{public_url}/oauth/token"
    security_schemes["oauth2"] = {
        "type": "oauth2",
        "flows": {
            "clientCredentials": {
                "tokenUrl": token_url,
                "scopes": {
                    scope: scope
                    for scope in sorted({skill.scope for skill in list_skills()})
                },
            }
        },
    }

    return {
        "name": settings.agent_name,
        "description": settings.agent_description,
        "url": public_url,
        "version": settings.a2a_catalog_version,
        "protocolVersion": settings.a2a_protocol_version,
        "preferredTransport": "JSONRPC",
        "defaultInputModes": ["application/json", "text/plain"],
        "defaultOutputModes": ["application/json", "text/plain"],
        "capabilities": {
            "streaming": bool(settings.a2a_streaming_enabled),
            "pushNotifications": False,
            "stateTransitionHistory": True,
            "extensions": [
                {
                    "uri": TYPED_SKILLS_EXTENSION,
                    "description": "Worktual typed skill contracts and schemas",
                    "required": True,
                    "params": {
                        "catalogVersion": settings.a2a_catalog_version,
                        "overlayVersion": settings.a2a_overlay_version,
                        "contractSchema": "/a2a/contracts/worktual-envelope.v1.json",
                        "resultSchema": "/a2a/contracts/skill-result.v1.json",
                        "skillContractPathTemplate": "/a2a/contracts/skills/{skillId}.v1.json",
                        "excludedCapabilities": list(EXCLUDED_CAPABILITIES),
                    },
                }
            ],
        },
        "skills": skills,
        "securitySchemes": security_schemes,
        "security": [{"oauth2": []}] if security_schemes else [],
        "supportsAuthenticatedExtendedCard": True,
        "provider": {
            "organization": "Worktual",
            "url": "https://worktual.com",
        },
    }


def build_extended_agent_card(settings: A2ASettings) -> dict[str, Any]:
    public_url = settings.a2a_public_url.rstrip("/")
    card = build_public_agent_card(settings)
    card["skills"] = [
        _skill_card(skill, detailed=True, public_url=public_url) for skill in list_skills()
    ]
    card["additionalInterfaces"] = [
        {
            "url": f"{public_url}/",
            "transport": "JSONRPC",
        }
    ]
    return card

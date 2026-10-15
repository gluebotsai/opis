"""Agent Card builders (CCaaS-style public + authenticated extended).

Public card: Hub registration URL.
Extended card: same skills plus per-skill typed-skills extensions.
Skills always come from catalog.list_skills() — never invented at runtime.
"""

from __future__ import annotations

from typing import Any

from app.a2a.catalog import (
    CATALOG_VERSION,
    CONTRACT_VERSION,
    ENVELOPE_SCHEMA_PATH,
    EXCLUDED_CAPABILITIES,
    RESULT_SCHEMA_PATH,
    SkillSpec,
    all_oauth_scopes,
    list_skills,
    skill_version,
)
from app.config import get_settings


def _token_url(base: str) -> str:
    return f"{base}/token"


def _public_skill_entry(spec: SkillSpec) -> dict[str, Any]:
    return {
        "id": spec.id,
        "name": spec.name,
        "description": spec.description,
        "tags": list(spec.tags),
        "examples": list(spec.examples),
        "inputModes": ["application/json"],
        "outputModes": ["application/json"],
        "security": [{"oauth2": spec.oauth_scopes()}],
        "inputSchema": spec.input_schema_path,
        "outputSchema": spec.output_schema_path,
    }


def _extended_skill_entry(spec: SkillSpec, *, public_url: str) -> dict[str, Any]:
    entry = _public_skill_entry(spec)
    input_path = spec.input_schema_path
    entry["extensions"] = [
        {
            "uri": "urn:worktual:a2a:typed-skills:v1",
            "required": True,
            "params": {
                "contractVersion": CONTRACT_VERSION,
                "specialist": spec.specialist,
                "surface": spec.surface,
                "risk": spec.risk,
                "scope": spec.scope,
                "requiredArgumentKeys": list(spec.required_argument_keys),
                "orchestration": list(spec.orchestration),
                "noClarification": True,
                "inputSchema": input_path,
                "inputSchemaUrl": f"{public_url}{input_path}",
                "outputSchema": RESULT_SCHEMA_PATH,
            },
        }
    ]
    return entry


def _capabilities() -> dict[str, Any]:
    return {
        "streaming": False,
        "pushNotifications": False,
        "stateTransitionHistory": True,
        "noClarification": True,
        "execution": "sequential",
        "extensions": [
            {
                "uri": "urn:worktual:a2a:typed-skills:v1",
                "description": (
                    "Worktual Campaign typed skill contracts "
                    "(envelope + per-skill argument schemas + skill-result)."
                ),
                "required": True,
                "params": {
                    "catalogVersion": CATALOG_VERSION,
                    "overlayVersion": CATALOG_VERSION,
                    "contractSchema": ENVELOPE_SCHEMA_PATH,
                    "resultSchema": RESULT_SCHEMA_PATH,
                    "skillContractPathTemplate": (
                        "/a2a/contracts/skills/{skillId}.v1.json"
                    ),
                    "excludedCapabilities": list(EXCLUDED_CAPABILITIES),
                },
            }
        ],
    }


def _security_block(base: str) -> dict[str, Any]:
    return {
        "securitySchemes": {
            "oauth2": {
                "type": "oauth2",
                "flows": {
                    "clientCredentials": {
                        "tokenUrl": _token_url(base),
                        "scopes": all_oauth_scopes(),
                    }
                },
            }
        },
        "security": [{"oauth2": []}],
    }


def build_public_agent_card() -> dict[str, Any]:
    """Public discovery document — Hub registration URL."""
    s = get_settings()
    base = s.a2a_public_url.rstrip("/")
    card: dict[str, Any] = {
        "id": s.a2a_server_name,
        "name": "Worktual Campaign",
        "description": (
            "Campaign A2A spoke: on-demand create+launch, contacts, and monitoring. "
            "Hub delegates actions; Campaign executes in one shot with no clarification."
        ),
        "url": f"{base}/",
        "tokenUrl": _token_url(base),
        "version": CATALOG_VERSION,
        "skillVersion": skill_version(),
        "protocolVersion": "1.0",
        "preferredTransport": "JSONRPC",
        "defaultInputModes": ["application/json"],
        "defaultOutputModes": ["application/json"],
        "provider": {
            "organization": "Worktual",
            "url": "https://worktual.com",
        },
        "supportsAuthenticatedExtendedCard": True,
        "capabilities": _capabilities(),
        "skills": [_public_skill_entry(spec) for spec in list_skills()],
        **_security_block(base),
    }
    return card


def build_extended_agent_card() -> dict[str, Any]:
    """Authenticated richer card: public + additionalInterfaces + per-skill extensions."""
    s = get_settings()
    base = s.a2a_public_url.rstrip("/")
    card = build_public_agent_card()
    card["additionalInterfaces"] = [
        {"url": f"{base}/", "transport": "JSONRPC"},
    ]
    card["skills"] = [
        _extended_skill_entry(spec, public_url=base) for spec in list_skills()
    ]
    return card


def build_agent_card() -> dict[str, Any]:
    """Alias: public card (Hub registration)."""
    return build_public_agent_card()

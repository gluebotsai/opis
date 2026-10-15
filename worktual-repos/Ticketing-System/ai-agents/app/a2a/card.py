"""Agent Card JSON for Hub discovery (public + authenticated extended)."""

from __future__ import annotations

from typing import Any

from app.a2a.catalog import (
    EXCLUDED_CAPABILITIES,
    SkillSpec,
    hub_skills,
    list_skill_specs,
    skill_version,
)
from app.config import get_settings

TYPED_SKILLS_URI = "urn:worktual:a2a:typed-skills:v1"


def public_base_url() -> str:
    settings = get_settings()
    url = (settings.a2a_public_url or "").strip().rstrip("/")
    if url:
        return url
    return "http://127.0.0.1:8021"


def _catalog_version() -> str:
    settings = get_settings()
    return str(getattr(settings, "a2a_catalog_version", None) or "1.0.0").strip() or "1.0.0"


def _overlay_version() -> str:
    settings = get_settings()
    return str(getattr(settings, "a2a_overlay_version", None) or "1.0.0").strip() or "1.0.0"


def _agent_name() -> str:
    settings = get_settings()
    return (
        str(getattr(settings, "a2a_agent_name", None) or "").strip()
        or "Worktual Ticketing"
    )


def _agent_description() -> str:
    settings = get_settings()
    return (
        str(getattr(settings, "a2a_agent_description", None) or "").strip()
        or (
            "Ticketing A2A spoke — Hub-invokable skills for ticket create/read/"
            "list/update, customer verify and 360, KB search, inbound capture/"
            "deflect, and Super Agent routing."
        )
    )


def _streaming_enabled() -> bool:
    settings = get_settings()
    return bool(getattr(settings, "a2a_streaming_enabled", False))


def _oauth_token_url(base: str) -> str:
    settings = get_settings()
    configured = str(getattr(settings, "a2a_oauth_token_url", None) or "").strip()
    if configured:
        return configured.rstrip("/")
    return f"{base}/oauth/token"


def _schema_path(skill_id: str) -> str:
    return f"/a2a/contracts/skills/{skill_id}.v1.json"


def _result_schema_path() -> str:
    return "/a2a/contracts/skill-result.v1.json"


def _all_scopes(specs: list[SkillSpec]) -> dict[str, str]:
    return {spec.scope: spec.scope for spec in specs}


def _public_skill_entry(spec: SkillSpec) -> dict[str, Any]:
    return {
        "id": spec.id,
        "name": spec.name,
        "description": spec.description,
        "tags": list(spec.tags),
        "examples": list(spec.examples),
        "inputModes": ["application/json"],
        "outputModes": ["application/json"],
        "security": [{"oauth2": [spec.scope]}],
        "inputSchema": _schema_path(spec.id),
        "outputSchema": _result_schema_path(),
    }


def _extended_skill_entry(spec: SkillSpec, *, base: str) -> dict[str, Any]:
    entry = _public_skill_entry(spec)
    input_path = _schema_path(spec.id)
    entry["extensions"] = [
        {
            "uri": TYPED_SKILLS_URI,
            "required": True,
            "params": {
                "contractVersion": "1.0",
                "specialist": spec.specialist,
                "surface": spec.surface,
                "risk": spec.risk,
                "scope": spec.scope,
                "requiredArgumentKeys": list(spec.required_argument_keys),
                "mcpServer": spec.mcp_server,
                "mcpTool": spec.mcp_tool,
                "orchestration": list(spec.orchestration),
                "inputSchema": input_path,
                "inputSchemaUrl": f"{base}{input_path}",
                "outputSchema": _result_schema_path(),
            },
        }
    ]
    return entry


def build_public_agent_card() -> dict[str, Any]:
    """Public discovery document (no per-skill extensions)."""
    settings = get_settings()
    base = public_base_url()
    specs = list_skill_specs()
    server_name = (settings.a2a_server_name or "worktual-ticketing").strip()
    catalog_ver = _catalog_version()
    return {
        "name": _agent_name(),
        "description": _agent_description(),
        "url": f"{base}/",
        "version": catalog_ver,
        "protocolVersion": "1.0",
        "preferredTransport": "JSONRPC",
        "defaultInputModes": ["application/json", "text/plain"],
        "defaultOutputModes": ["application/json", "text/plain"],
        "provider": {
            "organization": "Worktual",
            "url": "https://worktual.com",
        },
        "supportsAuthenticatedExtendedCard": True,
        "id": server_name,
        # Compat for existing Hub / local clients
        "tokenUrl": f"{base}/token",
        "skillVersion": skill_version(hub_skills()),
        "capabilities": {
            "streaming": _streaming_enabled(),
            "pushNotifications": False,
            "stateTransitionHistory": True,
            "extensions": [
                {
                    "uri": TYPED_SKILLS_URI,
                    "description": (
                        "Worktual typed skill contracts and JSON Schemas for "
                        "Ticketing Hub integration."
                    ),
                    "required": True,
                    "params": {
                        "catalogVersion": catalog_ver,
                        "overlayVersion": _overlay_version(),
                        "contractSchema": "/a2a/contracts/worktual-envelope.v1.json",
                        "resultSchema": _result_schema_path(),
                        "skillContractPathTemplate": (
                            "/a2a/contracts/skills/{skillId}.v1.json"
                        ),
                        "excludedCapabilities": list(EXCLUDED_CAPABILITIES),
                    },
                }
            ],
        },
        "skills": [_public_skill_entry(spec) for spec in specs],
        "securitySchemes": {
            "oauth2": {
                "type": "oauth2",
                "flows": {
                    "clientCredentials": {
                        "tokenUrl": _oauth_token_url(base),
                        "scopes": _all_scopes(specs),
                    }
                },
            }
        },
        "security": [{"oauth2": []}],
    }


def build_extended_agent_card() -> dict[str, Any]:
    """Authenticated card = public + additionalInterfaces + per-skill extensions."""
    base = public_base_url()
    card = build_public_agent_card()
    specs = list_skill_specs()
    card["additionalInterfaces"] = [
        {"url": f"{base}/", "transport": "JSONRPC"},
    ]
    card["skills"] = [_extended_skill_entry(spec, base=base) for spec in specs]
    return card


def build_agent_card() -> dict[str, Any]:
    """Alias used by /.well-known/agent-card.json (public card)."""
    return build_public_agent_card()

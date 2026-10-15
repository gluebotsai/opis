"""Build public and authenticated-extended A2A Agent Cards from spoke skills."""

from __future__ import annotations

from typing import Any, Iterable

from app.a2a.catalog import (
    EXCLUDED_CAPABILITIES,
    TYPED_SKILLS_URI,
    SpokeSkill,
    hub_required_argument_keys,
    list_spoke_skills,
    skill_contract_path,
    skill_mcp_server,
    skill_oauth_scope,
    skill_risk,
    skill_specialist,
    skill_surface,
    spoke_card_version,
)
from app.a2a.contracts import ENVELOPE_PATH, RESULT_PATH
from app.config import get_settings


def _token_url(public_url: str) -> str:
    settings = get_settings()
    configured = (settings.a2a_oauth_token_url or "").strip()
    if configured:
        return configured.rstrip("/")
    return f"{public_url}/token"


def _oauth_scopes(skills: Iterable[SpokeSkill]) -> dict[str, str]:
    scopes: dict[str, str] = {}
    for skill in skills:
        scope = skill_oauth_scope(skill)
        scopes[scope] = scope
    return scopes


def skill_to_card_entry(skill: SpokeSkill, *, extended: bool = False) -> dict[str, Any]:
    settings = get_settings()
    public_url = (settings.a2a_public_url or "").rstrip("/")
    tags = list(skill.tags)
    tags.append(f"kind:{skill.kind}")
    tags.append(skill_risk(skill))
    if skill.mutation_capable:
        tags.append("mutationCapable")
    for motion in sorted(skill.eligible_business_types):
        tags.append(f"business:{motion}")
    input_schema = skill_contract_path(skill.id)
    scope = skill_oauth_scope(skill)
    required_keys = list(hub_required_argument_keys(skill))
    entry: dict[str, Any] = {
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "tags": tags,
        "examples": list(skill.examples),
        "inputModes": ["application/json"],
        "outputModes": ["application/json"],
        "security": [{"oauth2": [scope]}],
        "inputSchema": input_schema,
        "outputSchema": RESULT_PATH,
        "requiredArgumentKeys": required_keys,
    }
    if not extended:
        return entry
    entry["extensions"] = [
        {
            "uri": TYPED_SKILLS_URI,
            "required": True,
            "params": {
                "contractVersion": "1.0",
                "specialist": skill_specialist(skill),
                "surface": skill_surface(skill),
                "risk": skill_risk(skill),
                "scope": scope,
                "requiredArgumentKeys": required_keys,
                "mcpServer": skill_mcp_server(skill),
                "mcpTool": None,
                "orchestration": [],
                "inputSchema": input_schema,
                "inputSchemaUrl": f"{public_url}{input_schema}",
                "outputSchema": RESULT_PATH,
            },
        }
    ]
    return entry


def _capabilities(catalog_version: str, overlay_version: str, streaming: bool) -> dict[str, Any]:
    return {
        "streaming": streaming,
        "pushNotifications": False,
        "stateTransitionHistory": True,
        "extensions": [
            {
                "uri": TYPED_SKILLS_URI,
                "description": "Worktual typed skill contracts and JSON Schemas for CRM Hub invokes.",
                "required": True,
                "params": {
                    "catalogVersion": catalog_version,
                    "overlayVersion": overlay_version,
                    "contractSchema": ENVELOPE_PATH,
                    "resultSchema": RESULT_PATH,
                    "skillContractPathTemplate": "/a2a/contracts/skills/{skillId}.v1.json",
                    "excludedCapabilities": list(EXCLUDED_CAPABILITIES),
                },
            }
        ],
    }


def build_public_agent_card(
    *,
    skills: Iterable[SpokeSkill] | None = None,
    public_url: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    entries = tuple(skills) if skills is not None else list_spoke_skills()
    url = (public_url or settings.a2a_public_url).rstrip("/")
    version = spoke_card_version(entries)
    server_name = (settings.a2a_server_name or "worktual-crm").strip() or "worktual-crm"
    token_url = _token_url(url)
    catalog_version = (settings.a2a_catalog_version or "1.0.0").strip() or "1.0.0"
    overlay_version = (settings.a2a_overlay_version or "1.0.0").strip() or "1.0.0"
    return {
        "protocolVersion": (settings.a2a_protocol_version or "1.0").strip() or "1.0",
        "preferredTransport": "JSONRPC",
        "id": server_name,
        "name": (settings.a2a_agent_name or "CRM Super Agent").strip() or "CRM Super Agent",
        "description": (
            settings.a2a_agent_description
            or (
                "Worktual CRM spoke. Hub sends action skills with organizationId "
                "and cdpId; CRM executes existing coworker and job agents and "
                "returns receipts. Not a CRM read API."
            )
        ).strip(),
        "url": url,
        "provider": {
            "organization": "Worktual",
            "url": "https://www.worktual.com",
        },
        "version": version,
        "skillVersion": version,
        "documentationUrl": "https://www.worktual.com",
        "capabilities": _capabilities(
            catalog_version,
            overlay_version,
            bool(settings.a2a_streaming_enabled),
        ),
        "defaultInputModes": ["application/json", "text/plain"],
        "defaultOutputModes": ["application/json", "text/plain"],
        "skills": [skill_to_card_entry(item, extended=False) for item in entries],
        "securitySchemes": {
            "oauth2": {
                "type": "oauth2",
                "flows": {
                    "clientCredentials": {
                        "tokenUrl": token_url,
                        "refreshUrl": token_url,
                        "scopes": _oauth_scopes(entries),
                    }
                },
            },
            "bearerAuth": {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
            },
        },
        "security": [{"oauth2": []}, {"bearerAuth": []}],
        "supportsAuthenticatedExtendedCard": True,
    }


def build_extended_agent_card(
    *,
    skills: Iterable[SpokeSkill] | None = None,
    public_url: str | None = None,
) -> dict[str, Any]:
    card = build_public_agent_card(skills=skills, public_url=public_url)
    entries = tuple(skills) if skills is not None else list_spoke_skills()
    url = str(card.get("url") or "").rstrip("/")
    card["skills"] = [skill_to_card_entry(item, extended=True) for item in entries]
    card["additionalInterfaces"] = [{"url": f"{url}/", "transport": "JSONRPC"}]
    return card


def build_oauth_authorization_server_metadata(*, public_url: str | None = None) -> dict[str, Any]:
    settings = get_settings()
    url = (public_url or settings.a2a_public_url).rstrip("/")
    token_url = _token_url(url)
    return {
        "issuer": url,
        "token_endpoint": token_url,
        "grant_types_supported": ["client_credentials", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
        "scopes_supported": sorted(_oauth_scopes(list_spoke_skills()).keys()),
        "response_types_supported": ["token"],
    }


def build_agent_card(
    *,
    skills: Iterable[SpokeSkill] | None = None,
    public_url: str | None = None,
) -> dict[str, Any]:
    """Public Agent Card (Hub registration URL)."""
    return build_public_agent_card(skills=skills, public_url=public_url)

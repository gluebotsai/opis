"""Build CCaaS-compatible agent catalog payloads."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.sft_catalog.registry import (
    CatalogAgentRef,
    agent_document_path,
    get_catalog_ref,
    list_catalog_refs,
)
from app.sft_catalog.skills import skills_for_ref
from app.sft_catalog.tools import tools_for_ref

CATALOG_VERSION = "1.0.0"
CATALOG_SOURCE = "campaign-mas-agent-definitions"
FAMILY = "campaign_coworker"


def _prompt_version(path: Path) -> str:
    if not path.is_file():
        return "legacy"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest[:12]


def _load_system_prompt(ref: CatalogAgentRef) -> tuple[str, str, bool]:
    path = ref.package_dir / "agent.md"
    if not path.is_file():
        return "", "legacy", True
    return path.read_text(encoding="utf-8"), _prompt_version(path), False


def _load_samples(ref: CatalogAgentRef) -> list[dict[str, Any]]:
    path = ref.package_dir / "samples.json"
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict) and isinstance(data.get("conversations"), list):
        return [row for row in data["conversations"] if isinstance(row, dict)]
    return []


def _full_agent(ref: CatalogAgentRef) -> dict[str, Any]:
    system_prompt, prompt_version, missing_md = _load_system_prompt(ref)
    tools = tools_for_ref(ref)
    skills = skills_for_ref(ref)
    samples = _load_samples(ref)
    return {
        "id": ref.id,
        "name": ref.name,
        "family": FAMILY,
        "layer": ref.layer,
        "surfaces": list(ref.surfaces),
        "systemPrompt": system_prompt,
        "promptVersion": prompt_version,
        "agentDocumentPath": agent_document_path(ref),
        "mcpServers": list(ref.mcp_servers),
        "tools": tools,
        "skills": skills,
        "handoffTargets": list(ref.handoff_targets),
        "sampleConversations": samples,
        "metricDomains": [],
        "maxToolRounds": ref.max_tool_rounds,
        "description": ref.description,
        "agentMdMissing": missing_md,
    }


def _summary(agent: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": agent["id"],
        "name": agent["name"],
        "family": agent["family"],
        "layer": agent["layer"],
        "surfaces": agent["surfaces"],
        "promptVersion": agent["promptVersion"],
        "mcpServers": agent["mcpServers"],
        "skillCount": len(agent.get("skills") or []),
        "toolCount": len(agent.get("tools") or []),
        "sampleConversationCount": len(agent.get("sampleConversations") or []),
    }


def list_agents() -> dict[str, Any]:
    agents = [_summary(_full_agent(ref)) for ref in list_catalog_refs()]
    return {
        "version": CATALOG_VERSION,
        "source": CATALOG_SOURCE,
        "agentCount": len(agents),
        "agents": agents,
    }


def get_agent(agent_id: str) -> dict[str, Any] | None:
    ref = get_catalog_ref(agent_id)
    if ref is None:
        return None
    return {
        "version": CATALOG_VERSION,
        "source": CATALOG_SOURCE,
        "agent": _full_agent(ref),
    }


def export_agents() -> dict[str, Any]:
    agents = [_full_agent(ref) for ref in list_catalog_refs()]
    return {
        "version": CATALOG_VERSION,
        "source": CATALOG_SOURCE,
        "agentCount": len(agents),
        "agents": agents,
    }

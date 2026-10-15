"""Derived coworker/support-agent catalog for SFT / synthetic data export.

Built at request time from NLP AgentDefinition, MCP servers, skill packs, and
``agents/<name>/samples.json``. Do not hand-maintain a parallel dump.
"""

from __future__ import annotations

import inspect
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, get_args, get_origin

from app.agents.definitions import ALL_AGENT_DEFINITIONS
from app.agents.prompt_loader import AGENT_DOCUMENT_ROOT
from app.mcp.registry import get_mcp_registry
from app.runtime.agent import ROUTE_TO_AGENT_SCHEMA
from app.skills.registry import get_skill_registry

CATALOG_VERSION = "1.0.0"

_JSON_TYPES = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    dict: "object",
    list: "array",
}


def _family(name: str) -> str:
    return "support_bot" if name == "support_bot" else "coworker"


def _json_type(annotation: Any) -> dict[str, Any]:
    origin = get_origin(annotation)
    if origin is None:
        if annotation in _JSON_TYPES:
            return {"type": _JSON_TYPES[annotation]}
        return {"type": "string"}
    args = [arg for arg in get_args(annotation) if arg is not type(None)]
    if origin is list and args:
        return {"type": "array", "items": _json_type(args[0])}
    if origin is dict:
        return {"type": "object"}
    if args:
        return _json_type(args[0])
    return {"type": "string"}


def _schema_from_handler(handler: Any) -> dict[str, Any]:
    try:
        signature = inspect.signature(handler)
    except (TypeError, ValueError):
        return {"type": "object"}
    properties: dict[str, Any] = {}
    required: list[str] = []
    for name, param in signature.parameters.items():
        if name in {"self", "cls"}:
            continue
        if param.kind in {param.VAR_KEYWORD, param.VAR_POSITIONAL}:
            continue
        annotation = param.annotation if param.annotation is not inspect.Parameter.empty else str
        properties[name] = _json_type(annotation)
        if param.default is inspect.Parameter.empty:
            required.append(name)
    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _fastmcp_tool(server: Any, tool_name: str) -> Any | None:
    manager = getattr(getattr(server, "mcp", None), "_tool_manager", None)
    if manager is None:
        return None
    tools = getattr(manager, "_tools", None)
    if isinstance(tools, dict) and tool_name in tools:
        return tools[tool_name]
    getter = getattr(manager, "get_tool", None)
    if callable(getter):
        try:
            return getter(tool_name)
        except Exception:  # noqa: BLE001
            return None
    return None


def _tool_payload(server_name: str, server: Any, tool_name: str) -> dict[str, Any]:
    tool = _fastmcp_tool(server, tool_name)
    description = str(getattr(tool, "description", "") or "")
    input_schema = getattr(tool, "parameters", None)
    if not isinstance(input_schema, dict):
        input_schema = _schema_from_handler(getattr(server, tool_name, None))
    if not description:
        handler = getattr(server, tool_name, None)
        description = (inspect.getdoc(handler) or "").strip()
    return {
        "server": server_name,
        "name": tool_name,
        "description": description,
        "inputSchema": input_schema or {"type": "object"},
        "kind": "mcp",
    }


def _handoff_tool(targets: tuple[str, ...]) -> dict[str, Any]:
    schema = ROUTE_TO_AGENT_SCHEMA["function"]
    parameters = dict(schema["parameters"])
    properties = dict(parameters.get("properties") or {})
    properties["agent_name"] = {
        "type": "string",
        "enum": list(targets),
        "description": "Declared handoff target only.",
    }
    parameters["properties"] = properties
    return {
        "server": "runtime",
        "name": "route_to_agent",
        "description": schema["description"],
        "inputSchema": parameters,
        "kind": "runtime_handoff",
    }


def _skill_payload(skill_id: str, *, required: bool) -> dict[str, Any]:
    pack = get_skill_registry().get_skill(skill_id)
    if pack is None:
        return {"id": skill_id, "required": required, "missing": True}
    return {
        "id": str(pack.get("id") or skill_id),
        "name": pack.get("name"),
        "description": str(pack.get("description") or "").strip(),
        "version": pack.get("version"),
        "required": required,
        "triggers": list(pack.get("triggers") or []),
        "toolsPreferred": list(pack.get("tools_preferred") or []),
        "workflow": list(pack.get("workflow") or []),
        "rules": list(pack.get("rules") or []),
        "body": str(pack.get("body") or ""),
        "missing": False,
    }


def _load_samples(agent_name: str) -> list[dict[str, Any]]:
    path = Path(AGENT_DOCUMENT_ROOT) / agent_name / "samples.json"
    if not path.is_file():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    conversations = payload.get("conversations") if isinstance(payload, dict) else None
    if isinstance(conversations, list):
        return [item for item in conversations if isinstance(item, dict)]
    return []


def _agent_document_path(agent_name: str) -> str | None:
    path = Path(AGENT_DOCUMENT_ROOT) / agent_name / "agent.md"
    return str(path) if path.is_file() else None


def build_agent_detail(definition: Any) -> dict[str, Any]:
    registry = get_mcp_registry()
    tools: list[dict[str, Any]] = []
    for server_name in definition.mcp_servers:
        server = registry.get_server(server_name)
        if server is None:
            continue
        for tool_name in getattr(server, "tool_names", ()):
            tools.append(_tool_payload(server_name, server, tool_name))
    if definition.can_handoff:
        tools.append(_handoff_tool(definition.handoff_targets))

    required = set(definition.required_skills)
    skill_ids = list(dict.fromkeys([*definition.allowed_skills, *definition.required_skills]))
    return {
        "id": definition.name,
        "name": definition.name,
        "family": _family(definition.name),
        "layer": definition.layer,
        "surfaces": list(definition.allowed_surfaces),
        "promptVersion": definition.prompt_version,
        "systemPrompt": definition.system_prompt,
        "agentDocumentPath": _agent_document_path(definition.name),
        "mcpServers": list(definition.mcp_servers),
        "handoffTargets": list(definition.handoff_targets),
        "metricDomains": list(definition.metric_domains),
        "maxToolRounds": definition.max_tool_rounds,
        "tools": tools,
        "skills": [_skill_payload(skill_id, required=skill_id in required) for skill_id in skill_ids],
        "sampleConversations": _load_samples(definition.name),
    }


def _summarize(detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": detail["id"],
        "name": detail["name"],
        "family": detail["family"],
        "layer": detail["layer"],
        "surfaces": detail["surfaces"],
        "promptVersion": detail["promptVersion"],
        "mcpServers": detail["mcpServers"],
        "skillCount": len(detail["skills"]),
        "toolCount": len(detail["tools"]),
        "sampleConversationCount": len(detail["sampleConversations"]),
    }


@lru_cache(maxsize=1)
def _catalog_payload() -> dict[str, Any]:
    agents = [build_agent_detail(definition) for definition in ALL_AGENT_DEFINITIONS]
    return {
        "version": CATALOG_VERSION,
        "source": "nlp-agent-definitions",
        "agentCount": len(agents),
        "agents": agents,
    }


def clear_agent_catalog_cache() -> None:
    _catalog_payload.cache_clear()


def list_agent_summaries() -> dict[str, Any]:
    payload = _catalog_payload()
    return {
        "version": payload["version"],
        "source": payload["source"],
        "agentCount": payload["agentCount"],
        "agents": [_summarize(agent) for agent in payload["agents"]],
    }


def get_agent_detail(agent_id: str) -> dict[str, Any] | None:
    for agent in _catalog_payload()["agents"]:
        if agent["id"] == agent_id:
            return {
                "version": CATALOG_VERSION,
                "source": "nlp-agent-definitions",
                "agent": agent,
            }
    return None


def export_all_agents() -> dict[str, Any]:
    return dict(_catalog_payload())

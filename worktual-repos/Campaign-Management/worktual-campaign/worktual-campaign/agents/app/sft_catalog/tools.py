"""Export OpenAI tool schemas as CCaaS-compatible catalog tools."""

from __future__ import annotations

from typing import Any

from app.mas.catalog import domain_for_executor
from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST
from app.mas.runtime.tools_schemas import (
    INVOKE_EXECUTOR_TOOL,
    REQUEST_DOMAIN_HANDOFF_TOOL,
    ROUTE_TO_DOMAIN_TOOL,
)
from app.sft_catalog.registry import CatalogAgentRef


def _openai_to_catalog_tool(tool: dict[str, Any], *, kind: str) -> dict[str, Any]:
    fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
    name = str(fn.get("name") or tool.get("name") or "").strip()
    params = fn.get("parameters") if isinstance(fn.get("parameters"), dict) else {}
    if not params and isinstance(tool.get("inputSchema"), dict):
        params = tool["inputSchema"]
    return {
        "server": "campaign",
        "name": name,
        "description": str(fn.get("description") or tool.get("description") or ""),
        "inputSchema": params or {"type": "object", "properties": {}},
        "kind": kind,
    }


def _stub_tool(name: str) -> dict[str, Any]:
    return {
        "server": "campaign",
        "name": name,
        "description": f"Campaign runtime tool {name}",
        "inputSchema": {"type": "object", "properties": {}},
        "kind": "runtime",
    }


def _index_openai_tools(tools: list) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
        name = str(fn.get("name") or "").strip()
        if name:
            out[name] = tool
    return out


def _executor_openai_tools(executor_id: str) -> list:
    eid = str(executor_id or "").strip().lower()
    domain = domain_for_executor(eid) or ""

    if eid in ("contact", "audience_selection", "audience_pull"):
        from app.agents.contacts.tools.schemas import tools_for_mas_audience_executor

        return tools_for_mas_audience_executor(eid)

    if domain == "creation" or eid == "recommendation":
        from app.agents.create_campaign.tools import tools_for_mas_executor

        return tools_for_mas_executor(eid)

    if domain == "optimization":
        from app.agents.monitoring.tools.schemas import tools_for_mas_optimization_executor

        surface = "reports" if eid == "analytics" else "monitoring"
        return tools_for_mas_optimization_executor(eid, surface=surface)

    if domain == "content":
        from app.mas.runtime.content_tools import tools_for_mas_content_executor

        return tools_for_mas_content_executor(eid)

    if domain == "image":
        from app.agents.image.tools.schemas import tools_for_mas_image_executor

        return tools_for_mas_image_executor(eid)

    if domain == "forms":
        from app.agents.forms.tools.schemas import tools_for_mas_forms_executor

        return tools_for_mas_forms_executor(eid)

    return []


def tools_for_ref(ref: CatalogAgentRef) -> list[dict[str, Any]]:
    if ref.layer == "super":
        return [_openai_to_catalog_tool(ROUTE_TO_DOMAIN_TOOL, kind="runtime_handoff")]

    if ref.layer == "domain":
        return [
            _openai_to_catalog_tool(INVOKE_EXECUTOR_TOOL, kind="runtime_handoff"),
            _openai_to_catalog_tool(REQUEST_DOMAIN_HANDOFF_TOOL, kind="runtime_handoff"),
        ]

    # Executor
    openai_tools = _executor_openai_tools(ref.id)
    index = _index_openai_tools(openai_tools)
    allow = EXECUTOR_TOOL_ALLOWLIST.get(ref.id, frozenset())
    if not allow and openai_tools:
        return [_openai_to_catalog_tool(t, kind="runtime") for t in openai_tools]

    out: list[dict[str, Any]] = []
    names = allow or frozenset(index.keys())
    for name in sorted(names):
        tool = index.get(name)
        if tool:
            out.append(_openai_to_catalog_tool(tool, kind="runtime"))
        else:
            out.append(_stub_tool(name))
    return out

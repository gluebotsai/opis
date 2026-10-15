"""CRM SFT agent catalog — live prompts + tools for synthetic-data export.

This is not the Hub Agent Card. Hub skills stay in ``app.a2a.catalog``.
These payloads are the assembled teacher prompts the SFT cron restamps into
handwritten coworker threads.
"""

from __future__ import annotations

import hashlib
import importlib
from typing import Any, Iterable

from app.agents.coworker_native import (
    CONTENT_GENERATOR_TOOLS,
    SPECIALIST_INSTRUCTIONS,
)
from app.agents.crm_tools import build_system_prompt
from app.agents.llm_result import sectioned_system_prompt
from app.mcp.catalog import get_tool, list_tools

SFT_CATALOG_VERSION = "1.0.0"
SFT_CATALOG_SOURCE = "nlp-agent-definitions"

COWORKER_HANDOFF_TARGETS = (
    "contact-agent",
    "company-agent",
    "deal-agent",
    "proposal-agent",
    "product-agent",
    "reports-analytics-agent",
    "link-agent",
    "seo-content-generator",
)

ROUTE_TO_AGENT_TOOL: dict[str, Any] = {
    "server": "runtime",
    "name": "route_to_agent",
    "description": (
        "Hand the current request to another declared CRM coworker specialist. "
        "Call alone this turn."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "agent_name": {
                "type": "string",
                "description": (
                    "Target: contact-agent, company-agent, deal-agent, "
                    "proposal-agent, product-agent, reports-analytics-agent, "
                    "link-agent, seo-content-generator, crm_super"
                ),
            },
            "query": {
                "type": "string",
                "description": "Short restated user request for the target agent",
            },
        },
        "required": ["agent_name", "query"],
        "additionalProperties": False,
    },
    "kind": "runtime_handoff",
}

# Skip REGISTRY names already published as coworker specialists.
_JOB_SKIP = frozenset({"crm-agent"})

_COWORKER_SPECS: tuple[dict[str, Any], ...] = (
    {
        "id": "crm_super",
        "aliases": ("crm-agent",),
        "layer": "super",
        "modules": (),
        "surfaces": ["dashboard"],
        "handoffTargets": list(COWORKER_HANDOFF_TARGETS),
        "maxToolRounds": 1,
        "proposalOnly": False,
    },
    {
        "id": "contact-agent",
        "layer": "executor",
        "modules": ("contact",),
        "surfaces": ["contact-list", "contact-create", "contact-detail"],
        "handoffTargets": ["crm_super", "company-agent", "deal-agent"],
        "maxToolRounds": 6,
        "proposalOnly": False,
        "promptModule": "contact",
        "promptPath": "/contact",
    },
    {
        "id": "company-agent",
        "layer": "executor",
        "modules": ("company",),
        "surfaces": ["company-list", "company-create", "company-detail"],
        "handoffTargets": ["crm_super", "contact-agent", "deal-agent"],
        "maxToolRounds": 6,
        "proposalOnly": False,
        "promptModule": "company",
        "promptPath": "/company",
    },
    {
        "id": "deal-agent",
        "layer": "executor",
        "modules": ("sales",),
        "surfaces": ["sales-list", "sales-create", "sales-detail"],
        "handoffTargets": [
            "crm_super",
            "proposal-agent",
            "link-agent",
            "product-agent",
        ],
        "maxToolRounds": 6,
        "proposalOnly": False,
        "promptModule": "sales",
        "promptPath": "/sales",
    },
    {
        "id": "proposal-agent",
        "layer": "executor",
        "modules": ("sales",),
        "surfaces": ["proposal-detail"],
        "handoffTargets": ["crm_super", "deal-agent"],
        "maxToolRounds": 6,
        "proposalOnly": True,
        "promptModule": "sales",
        "promptPath": "/sales/proposals",
    },
    {
        "id": "product-agent",
        "layer": "executor",
        "modules": ("product",),
        "surfaces": ["product-list", "product-create", "product-detail"],
        "handoffTargets": ["crm_super", "deal-agent"],
        "maxToolRounds": 6,
        "proposalOnly": False,
        "promptModule": "product",
        "promptPath": "/product",
    },
    {
        "id": "reports-analytics-agent",
        "layer": "executor",
        "modules": ("reports", "dashboard"),
        "surfaces": ["dashboard", "reports"],
        "handoffTargets": ["crm_super", "deal-agent", "contact-agent"],
        "maxToolRounds": 6,
        "proposalOnly": False,
        "promptModule": "reports",
        "promptPath": "/reports",
    },
    {
        "id": "link-agent",
        "layer": "executor",
        "modules": ("quotes", "finance", "activities", "dashboard", "sales"),
        "surfaces": ["dashboard", "quotes", "finance", "activities"],
        "handoffTargets": ["crm_super"],
        "maxToolRounds": 6,
        "proposalOnly": False,
        "promptModule": "quotes",
        "promptPath": "/sales/quotes",
    },
    {
        "id": "seo-content-generator",
        "layer": "executor",
        "modules": ("marketing",),
        "surfaces": ["marketing-seo"],
        "handoffTargets": ["crm_super", "deal-agent"],
        "maxToolRounds": 6,
        "proposalOnly": False,
        "promptModule": "marketing",
        "promptPath": "/marketing/seo",
        "seo": True,
    },
)


def _prompt_version(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def _mcp_tool_payload(raw: dict[str, Any]) -> dict[str, Any]:
    schema = raw.get("inputSchema") if isinstance(raw.get("inputSchema"), dict) else {}
    return {
        "server": "coworker",
        "name": str(raw.get("name") or ""),
        "description": str(raw.get("description") or ""),
        "inputSchema": {
            "type": "object",
            "properties": schema.get("properties") or {},
            "required": schema.get("required") or [],
            "additionalProperties": False,
        },
        "kind": "mcp",
    }


def _coworker_tool_rows(spec: dict[str, Any]) -> list[dict[str, Any]]:
    if spec["id"] == "crm_super":
        return [dict(ROUTE_TO_AGENT_TOOL)]
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []
    common = {"navigate", "open_entity", "ask_clarification", "remember_memory", "clear_memory"}
    for module in spec["modules"]:
        for surface in ("list", "create", "detail"):
            entity_id = "entity" if surface == "detail" else None
            for tool in list_tools(module=module, surface=surface, entity_id=entity_id):
                name = str(tool.get("name") or "")
                if not name or name in seen:
                    continue
                if spec.get("seo") and name not in CONTENT_GENERATOR_TOOLS:
                    continue
                if spec.get("proposalOnly") and name not in common and "proposal" not in name:
                    continue
                seen.add(name)
                rows.append(_mcp_tool_payload(tool))
    if "route_to_agent" not in seen:
        rows.append(dict(ROUTE_TO_AGENT_TOOL))
    return rows


def _super_prompt() -> str:
    return sectioned_system_prompt(
        role="You are the L1 CRM Super Agent for Worktual AI-Native CRM.",
        goal="Route each user request to exactly one coworker specialist.",
        instructions=(
            "Understand intent from the full request, runtime surface, role, "
            "and recent task context.\n"
            "Call route_to_agent once with the selected specialist and a concise, "
            "lossless query.\n"
            "If intent is materially ambiguous, ask one focused question before routing.\n"
            "Do not call business tools or invent CRM data."
        ),
        context=(
            "Runtime may supply tenant, signed-in user, role, module, surface, path, "
            "and entityId. Do not invent ids.\n"
            "Handoff targets: " + ", ".join(COWORKER_HANDOFF_TARGETS)
        ),
        output=(
            "Call route_to_agent once with the selected specialist and a concise, "
            "lossless query."
        ),
        guardrails=(
            "Never invent specialist names. Never execute MCP business tools. "
            "Do not use keyword or regex routing."
        ),
    )


def _coworker_prompt(spec: dict[str, Any]) -> str:
    if spec["id"] == "crm_super":
        return _super_prompt()
    module = str(spec.get("promptModule") or "dashboard")
    ctx = {
        "pathname": spec.get("promptPath") or "",
        "module": module,
        "surface": "list",
        "entityId": "",
    }
    base = build_system_prompt(module, "list", ctx)
    extra = SPECIALIST_INSTRUCTIONS.get(spec["id"]) or ""
    if extra:
        return f"{base}\n\nNative specialist:\n{extra}"
    return base


def _document_path(agent_id: str) -> str | None:
    paths = {
        "seo-content-generator": "ai-service/app/agents/seo-content-generator/agent.md",
    }
    return paths.get(agent_id)


def _ccaas_fields(agent_id: str, *, metric_domains: list[str] | None = None) -> dict[str, Any]:
    return {
        "agentDocumentPath": _document_path(agent_id),
        "skills": [],
        "sampleConversations": [],
        "metricDomains": list(metric_domains or []),
    }


def _coworker_agent(spec: dict[str, Any]) -> dict[str, Any]:
    tools = _coworker_tool_rows(spec)
    prompt = _coworker_prompt(spec)
    metrics = ["reports"] if spec["id"] == "reports-analytics-agent" else []
    return {
        "id": spec["id"],
        "name": spec["id"],
        "family": "coworker",
        "layer": spec["layer"],
        "surfaces": list(spec["surfaces"]),
        "systemPrompt": prompt,
        "promptVersion": _prompt_version(prompt),
        "mcpServers": [] if spec["id"] == "crm_super" else ["coworker"],
        "tools": tools,
        "handoffTargets": list(spec["handoffTargets"]),
        "maxToolRounds": int(spec["maxToolRounds"]),
        **_ccaas_fields(spec["id"], metric_domains=metrics),
        "aliases": list(spec.get("aliases") or ()),
    }


def _looks_like_sectioned_prompt(text: str) -> bool:
    lowered = text.lstrip()
    return lowered.startswith("Role:") and "Goal:" in text and len(text) > 80


def _job_prompt_from_module(mod: Any, agent_id: str, fallback: str) -> str:
    chunks: list[str] = []
    for name in sorted(dir(mod)):
        if name.startswith("_"):
            continue
        val = getattr(mod, name, None)
        if isinstance(val, str) and _looks_like_sectioned_prompt(val):
            chunks.append(f"## {name}\n{val.strip()}")
    if chunks:
        return "\n\n".join(chunks)
    return fallback


def _job_fallback_prompt(agent_id: str, description: str) -> str:
    return sectioned_system_prompt(
        role=f"You are the CRM named job agent `{agent_id}`.",
        goal=description or f"Run the `{agent_id}` job from authorized CRM context.",
        instructions=(
            "Use only evidence in the job payload. Do not invent ids, amounts, "
            "or CRM mutations the job does not own."
        ),
        context="Runtime supplies organizationId and the job entity ids. Do not invent ids.",
        output="Return the job's structured result.",
        guardrails="Heuristics are offline fallback only when the LLM is unavailable.",
    )


def _job_agents() -> list[dict[str, Any]]:
    from app.a2a.catalog import NAMED_BLURBS
    from app.agents import REGISTRY

    out: list[dict[str, Any]] = []
    for agent_id, fn in REGISTRY.items():
        if agent_id in _JOB_SKIP:
            continue
        title, description, _tags, _examples = NAMED_BLURBS.get(
            agent_id,
            (
                agent_id.replace("-", " ").title(),
                f"CRM named agent {agent_id}.",
                ("crm", agent_id),
                (f"Run {agent_id}",),
            ),
        )
        del title
        module_name = getattr(fn, "__module__", "") or ""
        try:
            mod = importlib.import_module(module_name) if module_name else None
        except Exception:  # noqa: BLE001
            mod = None
        fallback = _job_fallback_prompt(agent_id, description)
        prompt = (
            _job_prompt_from_module(mod, agent_id, fallback) if mod is not None else fallback
        )
        out.append(
            {
                "id": agent_id,
                "name": agent_id,
                "family": "job",
                "layer": "executor",
                "surfaces": ["job"],
                "systemPrompt": prompt,
                "promptVersion": _prompt_version(prompt),
                "mcpServers": [],
                "tools": [],
                "handoffTargets": [],
                "maxToolRounds": 1,
                **_ccaas_fields(agent_id),
                "aliases": [],
            }
        )
    return out


def list_sft_agents(*, full: bool = True) -> list[dict[str, Any]]:
    agents = [_coworker_agent(spec) for spec in _COWORKER_SPECS]
    agents.extend(_job_agents())
    if full:
        return agents
    return [summarize_sft_agent(agent) for agent in agents]


def summarize_sft_agent(agent: dict[str, Any]) -> dict[str, Any]:
    tools = agent.get("tools") if isinstance(agent.get("tools"), list) else []
    skills = agent.get("skills") if isinstance(agent.get("skills"), list) else []
    samples = (
        agent.get("sampleConversations")
        if isinstance(agent.get("sampleConversations"), list)
        else []
    )
    return {
        "id": agent["id"],
        "name": agent["name"],
        "family": agent["family"],
        "layer": agent["layer"],
        "surfaces": list(agent.get("surfaces") or []),
        "promptVersion": agent.get("promptVersion"),
        "mcpServers": list(agent.get("mcpServers") or []),
        "skillCount": len(skills),
        "toolCount": len(tools),
        "sampleConversationCount": len(samples),
    }


def get_sft_agent(agent_id: str) -> dict[str, Any] | None:
    needle = str(agent_id or "").strip()
    if not needle:
        return None
    for agent in list_sft_agents(full=True):
        aliases = {str(a) for a in (agent.get("aliases") or [])}
        if agent["id"] == needle or needle in aliases:
            return agent
    return None


def export_sft_catalog() -> dict[str, Any]:
    agents = list_sft_agents(full=True)
    return {
        "version": SFT_CATALOG_VERSION,
        "source": SFT_CATALOG_SOURCE,
        "agentCount": len(agents),
        "agents": agents,
    }


def list_sft_catalog() -> dict[str, Any]:
    agents = list_sft_agents(full=True)
    return {
        "version": SFT_CATALOG_VERSION,
        "source": SFT_CATALOG_SOURCE,
        "agentCount": len(agents),
        "agents": [summarize_sft_agent(agent) for agent in agents],
    }


def openai_tools_for_agent(agent: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for tool in agent.get("tools") or []:
        if not isinstance(tool, dict) or not tool.get("name"):
            continue
        schema = tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {}
        out.append(
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description") or "",
                    "parameters": {
                        "type": "object",
                        "properties": schema.get("properties") or {},
                        "required": schema.get("required") or [],
                        "additionalProperties": False,
                    },
                },
            }
        )
    return out


def restamp_conversations(
    conversations: Iterable[dict[str, Any]],
    agents: Iterable[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Replace each handwritten thread's system prompt and offered tools."""
    by_id = {row["id"]: row for row in (agents or list_sft_agents(full=True))}
    for row in agents or []:
        for alias in row.get("aliases") or []:
            by_id.setdefault(str(alias), row)
    out: list[dict[str, Any]] = []
    for conv in conversations:
        next_conv = dict(conv)
        agent = by_id.get(str(conv.get("agent") or ""))
        sample = dict(conv.get("sample") or {})
        messages = list(sample.get("messages") or [])
        if agent:
            replaced = False
            stamped: list[dict[str, Any]] = []
            for msg in messages:
                row = dict(msg)
                if not replaced and row.get("role") == "system":
                    row["content"] = agent["systemPrompt"]
                    replaced = True
                stamped.append(row)
            sample["messages"] = stamped
            sample["tools_used"] = openai_tools_for_agent(agent)
        next_conv["sample"] = sample
        out.append(next_conv)
    return out


def compact_catalog_for_sft_json(agents: Iterable[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    rows = agents if agents is not None else list_sft_agents(full=True)
    compact: list[dict[str, Any]] = []
    for agent in rows:
        tools = agent.get("tools") if isinstance(agent.get("tools"), list) else []
        compact.append(
            {
                "id": agent["id"],
                "name": agent["name"],
                "family": agent["family"],
                "layer": agent["layer"],
                "mcp_servers": list(agent.get("mcpServers") or []),
                "tools": [str(t.get("name")) for t in tools if isinstance(t, dict) and t.get("name")],
                "handoff_targets": list(agent.get("handoffTargets") or []),
                "promptVersion": agent.get("promptVersion"),
            }
        )
    return compact


def get_tool_schema(name: str) -> dict[str, Any] | None:
    if name == "route_to_agent":
        return dict(ROUTE_TO_AGENT_TOOL)
    raw = get_tool(name)
    return _mcp_tool_payload(raw) if raw else None

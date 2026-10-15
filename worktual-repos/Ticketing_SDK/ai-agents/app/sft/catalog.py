"""Live SFT catalog: coworker agent.md folders + proactive AGENTS registry."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.contracts.execution import AgentDefinition, RunBudgets
from app.contracts.tools import ToolDefinition
from app.mcp.catalog import ROUTE_TO_DOMAIN, catalog_by_name, delegate_to_executor_tool
from app.prompts.builder import load_agent_definitions
from app.proactive.registry_agents import AGENTS, harness_binding_for
from app.skills.catalog import load_skill_definition, skills_for_executor

CATALOG_VERSION = "1.0.0"
CATALOG_SOURCE = "ticketing-nlp-agent-definitions"
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFINITIONS_ROOT = Path(__file__).resolve().parents[1] / "agents" / "definitions"

_SUPER_HANDOFF = (
    "route_to_domain",
    "continue_active_task",
    "resume_task",
    "refuse_capability",
)
_DOMAIN_HANDOFF = (
    "delegate_to_executor",
    "return_to_super",
    "refuse_capability",
)

_CONTINUE_ACTIVE_TASK = ToolDefinition(
    name="continue_active_task",
    description=(
        "Keep the live TaskState pin when this utterance continues the same Skill."
    ),
    input_schema={"type": "object", "properties": {}, "required": []},
    kind="route",
)
_RESUME_TASK = ToolDefinition(
    name="resume_task",
    description="Resume a parked TaskState for the same Skill without re-asking filled fields.",
    input_schema={
        "type": "object",
        "properties": {"task_id": {"type": "string"}},
        "required": [],
    },
    kind="route",
)
_REFUSE_CAPABILITY = ToolDefinition(
    name="refuse_capability",
    description=(
        "Return a typed capability refusal when the request is unsupported, "
        "forbidden, missing trusted context, or temporarily unavailable. "
        "message is a polite human paragraph; leave alternatives empty; "
        "never CDP/360/Skill jargon or an Alternatives list."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "enum": [
                    "unsupported_product",
                    "unsupported_operation",
                    "forbidden",
                    "missing_context",
                    "approval_required",
                    "temporarily_unavailable",
                ],
            },
            "message": {"type": "string"},
            "alternatives": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["code", "message"],
    },
    kind="route",
)
_RETURN_TO_SUPER = ToolDefinition(
    name="return_to_super",
    description=(
        "Park the active task and return a different or side-quest request to Super."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "reason": {"type": "string"},
            "action": {"type": "string", "enum": ["park", "cancel"]},
        },
        "required": ["action"],
    },
    kind="route",
)

_SURFACES_BY_DOMAIN: dict[str, list[str]] = {
    "intake_deflection_domain": ["tickets", "portal"],
    "triage_routing_domain": ["tickets"],
    "resolution_lifecycle_domain": ["tickets"],
    "knowledge_domain": ["tickets", "kb"],
    "catalog_administration_domain": [
        "customers",
        "teams",
        "kb",
        "macros",
        "admin",
    ],
}


def _prompt_version(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:12]


def _repo_rel(path: str | None) -> str | None:
    if not path:
        return None
    resolved = Path(path).resolve()
    try:
        return str(resolved.relative_to(_REPO_ROOT))
    except ValueError:
        return str(resolved)


def _title_from_id(agent_id: str) -> str:
    return (agent_id or "").replace("_", " ").title()


def _coworker_display_name(definition: AgentDefinition) -> str:
    for line in (definition.prompt or "").splitlines():
        if line.startswith("# "):
            heading = line[2:].strip()
            if heading and heading != definition.id and "_" not in heading:
                return heading
            break
    return _title_from_id(definition.id)


def _tool_payload(tool: ToolDefinition, *, kind: str) -> dict[str, Any]:
    return {
        "server": "ticketing",
        "name": tool.name,
        "description": tool.description,
        "inputSchema": tool.input_schema or {"type": "object", "properties": {}},
        "kind": kind,
    }


def _mcp_tool_payload(name: str) -> dict[str, Any]:
    catalog = catalog_by_name()
    tool = catalog.get(name)
    if tool:
        return _tool_payload(tool, kind="mcp")
    return {
        "server": "ticketing",
        "name": name,
        "description": name,
        "inputSchema": {"type": "object", "properties": {}},
        "kind": "mcp",
    }


def _skill_payload(skill_name: str) -> dict[str, Any] | None:
    try:
        skill = load_skill_definition(skill_name)
    except ValueError:
        return None
    return {
        "id": skill.name,
        "name": skill.name.replace("-", " ").title(),
        "description": skill.description,
        "version": skill.version,
        "required": False,
        "triggers": [],
        "toolsPreferred": list(skill.allowed_tools),
        "workflow": [],
        "rules": [],
        "body": skill.body or "",
        "missing": False,
    }


def _sample_conversations(agent_id: str) -> list[dict[str, Any]]:
    path = _DEFINITIONS_ROOT / agent_id / "samples.json"
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(raw, list):
        return [row for row in raw if isinstance(row, dict)]
    if isinstance(raw, dict) and isinstance(raw.get("conversations"), list):
        return [row for row in raw["conversations"] if isinstance(row, dict)]
    return []


def _surfaces_for_coworker(definition: AgentDefinition) -> list[str]:
    if definition.layer == "super":
        return ["staff-chat"]
    if definition.layer == "domain":
        return list(_SURFACES_BY_DOMAIN.get(definition.id, ["staff-chat"]))
    for skill in skills_for_executor(definition.id, active_only=False):
        surfaces = _SURFACES_BY_DOMAIN.get(skill.domain)
        if surfaces:
            return list(surfaces)
    return ["staff-chat"]


def _handoff_tools(definition: AgentDefinition) -> list[dict[str, Any]]:
    by_name: dict[str, ToolDefinition] = {
        ROUTE_TO_DOMAIN.name: ROUTE_TO_DOMAIN,
        _CONTINUE_ACTIVE_TASK.name: _CONTINUE_ACTIVE_TASK,
        _RESUME_TASK.name: _RESUME_TASK,
        _REFUSE_CAPABILITY.name: _REFUSE_CAPABILITY,
        _RETURN_TO_SUPER.name: _RETURN_TO_SUPER,
    }
    if definition.layer == "super":
        names = _SUPER_HANDOFF
    elif definition.layer == "domain":
        names = _DOMAIN_HANDOFF
        by_name["delegate_to_executor"] = delegate_to_executor_tool(definition.id)
    else:
        return []
    return [_tool_payload(by_name[name], kind="runtime_handoff") for name in names]


def _executor_tools(definition: AgentDefinition) -> list[dict[str, Any]]:
    names: set[str] = set()
    for skill in skills_for_executor(definition.id, active_only=False):
        names.update(skill.allowed_tools)
    for skill_name in definition.skills:
        packed = _skill_payload(skill_name)
        if packed:
            names.update(packed.get("toolsPreferred") or [])
    return [_mcp_tool_payload(name) for name in sorted(names)]


def _coworker_skills(definition: AgentDefinition) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for skill in skills_for_executor(definition.id, active_only=False):
        packed = _skill_payload(skill.name)
        if packed:
            seen[packed["id"]] = packed
    for skill_name in definition.skills:
        if skill_name in seen:
            continue
        packed = _skill_payload(skill_name)
        if packed:
            seen[packed["id"]] = packed
    return [seen[key] for key in sorted(seen)]


def _coworker_agent(definition: AgentDefinition) -> dict[str, Any]:
    if definition.layer in {"super", "domain"}:
        tools = _handoff_tools(definition)
        skills: list[dict[str, Any]] = []
        mcp_servers: list[str] = []
    else:
        tools = _executor_tools(definition)
        skills = _coworker_skills(definition)
        mcp_servers = list(definition.mcp_servers or ["ticketing"])
    samples = _sample_conversations(definition.id)
    return {
        "id": definition.id,
        "name": _coworker_display_name(definition),
        "family": "coworker",
        "layer": definition.layer,
        "surfaces": _surfaces_for_coworker(definition),
        "systemPrompt": definition.prompt,
        "promptVersion": _prompt_version(definition.prompt),
        "agentDocumentPath": _repo_rel(definition.prompt_path),
        "mcpServers": mcp_servers,
        "tools": tools,
        "skills": skills,
        "handoffTargets": list(definition.handoff_targets),
        "sampleConversations": samples,
        "metricDomains": [],
        "maxToolRounds": RunBudgets().max_rounds,
    }


def _proactive_system_prompt(module: Any) -> str:
    spec = module.SPEC
    doc = (module.__doc__ or "").strip()
    tools = ", ".join(sorted(spec.tools_used))
    triggers = ", ".join(spec.trigger)
    return (
        f"# {spec.full_name}\n\n"
        f"{doc}\n\n"
        f"Triggers: {triggers}\n"
        f"Tools: {tools}\n"
        f"Output: {spec.output_type}\n"
        f"Risk: {spec.risk_level}\n"
    )


def _proactive_agent(module: Any) -> dict[str, Any]:
    spec = module.SPEC
    binding = harness_binding_for(spec.agent_id) or {}
    skill_name = str(binding.get("skill_name") or "").strip()
    skills = []
    packed = _skill_payload(skill_name) if skill_name else None
    if packed:
        skills.append(packed)
    tools = [_mcp_tool_payload(name) for name in sorted(spec.tools_used)]
    prompt = _proactive_system_prompt(module)
    doc_path = Path(module.__file__).resolve() if getattr(module, "__file__", None) else None
    return {
        "id": spec.catalog_id,
        "name": spec.full_name,
        "family": "proactive",
        "layer": "executor",
        "surfaces": ["approvals"],
        "systemPrompt": prompt,
        "promptVersion": _prompt_version(prompt),
        "agentDocumentPath": _repo_rel(str(doc_path) if doc_path else None),
        "mcpServers": ["ticketing"],
        "tools": tools,
        "skills": skills,
        "handoffTargets": [],
        "sampleConversations": [],
        "metricDomains": [],
        "maxToolRounds": RunBudgets().max_rounds,
    }


def list_catalog_agents() -> list[dict[str, Any]]:
    """Every coworker definition on disk plus every registered proactive agent."""
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for definition in load_agent_definitions().values():
        agent = _coworker_agent(definition)
        if agent["id"] in seen:
            raise ValueError(f"duplicate catalog id: {agent['id']}")
        seen.add(agent["id"])
        rows.append(agent)
    for module in AGENTS.values():
        agent = _proactive_agent(module)
        if agent["id"] in seen:
            raise ValueError(f"duplicate catalog id: {agent['id']}")
        seen.add(agent["id"])
        rows.append(agent)
    return rows


def get_catalog_agent(agent_id: str) -> dict[str, Any] | None:
    clean = (agent_id or "").strip()
    if not clean:
        return None
    for agent in list_catalog_agents():
        if agent["id"] == clean:
            return agent
    return None


def summarize_agent(agent: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": agent["id"],
        "name": agent["name"],
        "family": agent["family"],
        "layer": agent["layer"],
        "surfaces": agent.get("surfaces") or [],
        "promptVersion": agent.get("promptVersion"),
        "mcpServers": agent.get("mcpServers") or [],
        "skillCount": len(agent.get("skills") or []),
        "toolCount": len(agent.get("tools") or []),
        "sampleConversationCount": len(agent.get("sampleConversations") or []),
    }

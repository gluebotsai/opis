"""Three-layer MAS assignment for Hub-typed A2A skills.

Hub sends a catalog skillId. Contact Center Super (L1) assigns that task to the
skill's L2 domain; L2 assigns to the L3 executor; L3 runs the mapped tool.
L1 and L2 never call business MCP tools. The Hub skillId is never re-interpreted.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from cc_a2a.catalog import L1_AGENT, SkillSpec, get_skill
from cc_a2a.overlay import clone_definition_with_overlay

# A2A-only L2/L3 identities until NLP adds Omnichannel Engagement domain agents.
_OMNICHANNEL_DOMAIN = "omnichannel_engagement_domain"
_WEBCHAT_EXECUTOR = "webchat"
_VOICE_EXECUTOR = "voice"
_OMNICHANNEL_EXECUTORS = (_WEBCHAT_EXECUTOR, _VOICE_EXECUTOR)


@dataclass(frozen=True)
class LayerAssignment:
    layer: str
    agent: str
    skill_id: str | None = None


def assignment_chain(skill: SkillSpec) -> tuple[LayerAssignment, ...]:
    """Honor the Hub skillId: L1 assigns to the catalog domain, L2 to the executor."""
    if skill.orchestration:
        steps = [LayerAssignment("super", L1_AGENT, skill.skill_id)]
        for step_id in skill.orchestration:
            step = get_skill(step_id)
            if step is None:
                continue
            steps.append(LayerAssignment("domain", step.domain, step.skill_id))
            steps.append(LayerAssignment("executor", step.specialist, step.skill_id))
        return tuple(steps)
    return (
        LayerAssignment("super", L1_AGENT, skill.skill_id),
        LayerAssignment("domain", skill.domain, skill.skill_id),
        LayerAssignment("executor", skill.specialist, skill.skill_id),
    )


def _a2a_stub_definition(name: str, layer: str, *, handoff_targets: tuple[str, ...] = ()):
    from app.runtime.agent import AgentDefinition

    if name == _OMNICHANNEL_DOMAIN:
        prompt = (
            "You are the L2 Omnichannel Engagement Domain Agent for Hub-delegated work. "
            "Assign the Hub skill to the catalog executor. Do not answer the user and "
            "do not call business tools."
        )
        return AgentDefinition(
            name=name,
            system_prompt=prompt,
            layer=layer,
            handoff_instruction="Choose the omnichannel executor for this Hub skill.",
            handoff_targets=handoff_targets or _OMNICHANNEL_EXECUTORS,
            max_tool_rounds=1,
        )
    if name == _WEBCHAT_EXECUTOR:
        prompt = (
            "You are the L3 webchat delivery executor. Trigger the mapped Chat Service "
            "engagement only. Do not invent adjacent tools."
        )
        return AgentDefinition(
            name=name,
            system_prompt=prompt,
            layer=layer,
            mcp_servers=(),
            allowed_surfaces=("webchat",),
            max_tool_rounds=1,
        )
    if name == _VOICE_EXECUTOR:
        prompt = (
            "You are the L3 voice delivery executor. Trigger the mapped auto-bot call "
            "only. Do not invent adjacent tools."
        )
        return AgentDefinition(
            name=name,
            system_prompt=prompt,
            layer=layer,
            mcp_servers=(),
            allowed_surfaces=("voice",),
            max_tool_rounds=1,
        )
    raise KeyError(name)


def definition_for(agent_name: str):
    from app.agents import definitions as agent_definitions

    mapping = {
        L1_AGENT: agent_definitions.CONTACT_CENTER_SUPER_DEFINITION,
        "agent_assist_domain": agent_definitions.AGENT_ASSIST_DOMAIN_DEFINITION,
        "interaction_operations_domain": agent_definitions.INTERACTION_OPERATIONS_DOMAIN_DEFINITION,
        "workforce_management_domain": agent_definitions.WORKFORCE_MANAGEMENT_DOMAIN_DEFINITION,
        "performance_intelligence_domain": agent_definitions.PERFORMANCE_INTELLIGENCE_DOMAIN_DEFINITION,
        "contact": agent_definitions.CONTACT_AGENT_DEFINITION,
        "inbox": agent_definitions.INBOX_AGENT_DEFINITION,
        "task": agent_definitions.TASK_AGENT_DEFINITION,
        "queue": agent_definitions.QUEUE_AGENT_DEFINITION,
        "analytics": agent_definitions.ANALYTICS_AGENT_DEFINITION,
        "monitoring": agent_definitions.MONITORING_AGENT_DEFINITION,
        "general": agent_definitions.GENERAL_AGENT_DEFINITION,
    }
    if agent_name in mapping:
        return mapping[agent_name]
    if agent_name == _OMNICHANNEL_DOMAIN:
        return _a2a_stub_definition(agent_name, "domain")
    if agent_name in {_WEBCHAT_EXECUTOR, _VOICE_EXECUTOR}:
        return _a2a_stub_definition(agent_name, "executor")
    return None


def activate_assignment(
    skill: SkillSpec,
    *,
    execution_profile: str,
) -> list[dict[str, Any]]:
    """Clone L1/L2/L3 definitions with the Hub overlay. Does not run an LLM."""
    activated: list[dict[str, Any]] = []
    for step in assignment_chain(skill):
        base = definition_for(step.agent)
        if base is None:
            raise RuntimeError(f"No MAS agent definition for {step.layer} '{step.agent}'")
        cloned = clone_definition_with_overlay(base, execution_profile=execution_profile)
        mcp_servers = tuple(getattr(cloned, "mcp_servers", ()) or ())
        layer = str(getattr(cloned, "layer", step.layer))
        if step.layer in {"super", "domain"} and mcp_servers:
            raise RuntimeError(f"{step.agent} must not expose business MCP at {step.layer}")
        if (
            step.layer == "domain"
            and skill.specialist not in {"super", "webchat", "voice"}
            and cloned.handoff_targets
            and skill.specialist not in cloned.handoff_targets
            and not skill.orchestration
        ):
            raise RuntimeError(
                f"L2 {step.agent} cannot assign Hub skill {skill.skill_id} to L3 {skill.specialist}"
            )
        activated.append(
            {
                "layer": step.layer,
                "agent": step.agent,
                "skillId": step.skill_id,
                "definitionLayer": layer,
                "overlayApplied": execution_profile == "hub-delegated",
                "mcpServers": list(mcp_servers),
                "handoffTargets": list(getattr(cloned, "handoff_targets", ()) or ()),
            }
        )
    return activated


def executor_agent_name(skill: SkillSpec) -> str:
    """L3 identity used for MCP authorization. Never L1/L2."""
    if skill.specialist == "super":
        return "analytics"
    return skill.specialist

"""Authenticated Hub-only overlay applied to fresh MAS agent instances."""

from __future__ import annotations

OVERLAY_VERSION = "1.1.0"

HUB_DELEGATED_OVERLAY = """
# Hub-delegated execution overlay (A2A)

You are executing a single authenticated Intelligent Hub request on behalf of a
trusted CDP/CVM workload. Apply these rules strictly:

1. Honor the Hub skillId from the Agent Card. Do not invent or substitute another skill.
2. L1 Contact Center Super Agent assigns the task to the skill's L2 domain only.
   L2 assigns to the L3 executor only. L1 and L2 must not call business MCP tools.
3. L3 executes ONLY the mapped tool for that skillId. Do not invent adjacent tools
   or UI actions.
4. Treat tenant_id, user_id, organizationId, and actor identity as immutable trusted
   context. Never ask the caller to "confirm" tenant identity in chat.
5. Prefer structured outcomes. If required arguments are missing, return a typed
   INPUT_REQUIRED status with missing field names — never enter a conversational loop.
6. Preserve existing MCP authorization, surface allowlists, and confirmation gates.
7. Produce evidence suitable for Hub audit: layer assignment, tool names, affected IDs,
   warnings.
8. Never call navigate, stage_*_draft, open_task_workspace, or customer-channel send.
9. Never mix this task memory with browser Copilot or Support Bot sessions.
""".strip()


def apply_overlay(system_prompt: str, *, execution_profile: str) -> str:
    """Append the Hub overlay only for authenticated hub-delegated execution."""
    if execution_profile != "hub-delegated":
        return system_prompt
    return f"{system_prompt.rstrip()}\n\n{HUB_DELEGATED_OVERLAY}\n"


def clone_definition_with_overlay(definition: object, *, execution_profile: str) -> object:
    """Clone an AgentDefinition and append overlay without mutating singletons."""
    from app.runtime.agent import AgentDefinition

    if not isinstance(definition, AgentDefinition):
        raise TypeError("definition must be AgentDefinition")

    system_prompt = (
        apply_overlay(definition.system_prompt, execution_profile=execution_profile)
        if execution_profile == "hub-delegated"
        else definition.system_prompt
    )
    return AgentDefinition(
        name=definition.name,
        system_prompt=system_prompt,
        prompt_version=definition.prompt_version,
        handoff_instruction=definition.handoff_instruction,
        layer=definition.layer,
        handoff_targets=definition.handoff_targets,
        mcp_servers=definition.mcp_servers,
        allowed_skills=definition.allowed_skills,
        required_skills=definition.required_skills,
        metric_domains=definition.metric_domains,
        allowed_surfaces=definition.allowed_surfaces,
        max_tool_rounds=definition.max_tool_rounds,
    )

"""Shared mutation repair + false-success blocking for coworker tool turns."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from app.agents.coworker_shared import sanitize_assistant_text_for_user
from app.orchestrator.contracts import AgentContext, AgentSpec
from app.orchestrator.errors import OrchestratorError
from app.orchestrator.mutation_gate import (
    llm_mutation_not_applied_speech,
    llm_open_record_mutation_requested,
    llm_speech_claims_mutation_done,
    mutation_repair_agent,
    open_record_mutation_repair_instruction,
    turn_has_mutation_action,
    turn_has_navigation_action,
)
from app.orchestrator.tool_loop import BoundedToolLoop, ToolLoopResult

_MODULE_TO_AGENT = {
    "contact": "contact-agent",
    "company": "company-agent",
    "sales": "deal-agent",
    "product": "product-agent",
    "finance": "finance-agent",
    "quotes": "quotes-agent",
}


def specialist_agent_for_module(module: str, *, pathname: str = "") -> str:
    mod = (module or "").lower()
    if mod == "sales" and pathname.startswith("/sales/proposals/"):
        return "proposal-agent"
    return _MODULE_TO_AGENT.get(mod, "link-agent")


@dataclass(frozen=True)
class OpenRecordRepairOutcome:
    result: ToolLoopResult | None
    mutation_requested: bool


async def repair_open_record_mutation(
    *,
    agent_name: str,
    module: str,
    surface: str,
    entity_id: str | None,
    context: AgentContext,
    spec: AgentSpec,
    base_messages: list[dict[str, Any]],
    loop_client: Any,
    proposals: list[dict[str, Any]],
    loop_max_tokens: int,
    catalog: dict[str, Any],
    user_text: str,
    with_leading_system: Any,
    loop_content: str = "",
) -> OpenRecordRepairOutcome:
    if not mutation_repair_agent(agent_name):
        return OpenRecordRepairOutcome(None, False)
    if surface not in ("detail", "create"):
        return OpenRecordRepairOutcome(None, False)
    if surface == "detail" and not entity_id:
        return OpenRecordRepairOutcome(None, False)
    if turn_has_mutation_action(proposals=proposals, patch={}):
        return OpenRecordRepairOutcome(None, False)

    remaining = context.envelope.remaining_seconds()
    mutation_requested = await llm_open_record_mutation_requested(
        user_text=user_text,
        agent_name=agent_name,
        module=module,
        surface=surface,
        entity_id=entity_id,
        catalog=catalog,
        remaining_seconds=remaining,
        messages=context.messages,
    )
    if not mutation_requested and (loop_content or "").strip():
        mutation_requested = await llm_speech_claims_mutation_done(
            assistant_text=loop_content,
            remaining_seconds=remaining,
        )
    if not mutation_requested or remaining <= 12:
        return OpenRecordRepairOutcome(None, mutation_requested)

    repair_messages = with_leading_system(
        base_messages,
        open_record_mutation_repair_instruction(
            agent_name=agent_name,
            module=module,
            surface=surface,
            entity_id=entity_id,
        ),
    )
    try:
        loop_result = await BoundedToolLoop().run(
            spec=spec,
            context=context,
            messages=repair_messages,
            client=loop_client,
            max_tokens=min(700, loop_max_tokens),
            tool_choice="required",
            tool_choice_rounds=1,
        )
    except OrchestratorError:
        return OpenRecordRepairOutcome(None, True)
    return OpenRecordRepairOutcome(loop_result, True)


async def block_false_mutation_success_speech(
    *,
    agent_name: str,
    module: str,
    surface: str,
    entity_id: str | None,
    catalog: dict[str, Any],
    user_text: str,
    proposals: Sequence[dict[str, Any]],
    patch: dict[str, Any] | None,
    loop_content: str,
    mutation_requested_hint: bool,
    remaining_seconds: float,
    messages: Sequence[dict[str, Any]] | None = None,
) -> str:
    """Replace chat-only success when a persist was intended but no mutation tool ran."""
    if not mutation_repair_agent(agent_name):
        return loop_content
    if surface == "detail" and not entity_id:
        return loop_content
    if surface not in ("detail", "create"):
        return loop_content
    if turn_has_mutation_action(proposals=proposals, patch=patch):
        return loop_content
    if turn_has_navigation_action(proposals):
        return loop_content

    claimed = await llm_speech_claims_mutation_done(
        assistant_text=loop_content,
        remaining_seconds=remaining_seconds,
    )
    mutation_still_wanted = mutation_requested_hint or claimed
    if not mutation_still_wanted:
        mutation_still_wanted = await llm_open_record_mutation_requested(
            user_text=user_text,
            agent_name=agent_name,
            module=module,
            surface=surface,
            entity_id=entity_id,
            catalog=catalog,
            remaining_seconds=remaining_seconds,
            messages=messages,
        )
    if not mutation_still_wanted:
        return loop_content
    return await llm_mutation_not_applied_speech(
        user_text=user_text,
        agent_name=agent_name,
        remaining_seconds=remaining_seconds,
    )


async def finalize_legacy_native_turn_mutations(
    *,
    module: str,
    surface: str,
    entity_id: str | None,
    pathname: str,
    catalog: dict[str, Any],
    user_text: str,
    proposals: list[dict[str, Any]],
    patch: dict[str, Any],
    speech: str,
    remaining_seconds: float = 25.0,
    messages: Sequence[dict[str, Any]] | None = None,
) -> str:
    """Legacy single-pass native turn: block false success; no BoundedToolLoop repair."""
    agent_name = specialist_agent_for_module(module, pathname=pathname)
    blocked = await block_false_mutation_success_speech(
        agent_name=agent_name,
        module=module,
        surface=surface,
        entity_id=entity_id,
        catalog=catalog,
        user_text=user_text,
        proposals=proposals,
        patch=patch,
        loop_content=speech,
        mutation_requested_hint=False,
        remaining_seconds=remaining_seconds,
        messages=messages,
    )
    return sanitize_assistant_text_for_user(blocked)

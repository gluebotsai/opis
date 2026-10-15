"""Overlay isolation tests."""

from cc_a2a.overlay import HUB_DELEGATED_OVERLAY, apply_overlay, clone_definition_with_overlay


def test_overlay_only_for_hub_delegated() -> None:
    base = "You are a specialist."
    assert apply_overlay(base, execution_profile="other") == base
    overlaid = apply_overlay(base, execution_profile="hub-delegated")
    assert HUB_DELEGATED_OVERLAY in overlaid
    assert overlaid.startswith(base)


def test_clone_does_not_mutate_singleton() -> None:
    from app.agents.definitions import CONTACT_AGENT_DEFINITION

    original = CONTACT_AGENT_DEFINITION.system_prompt
    cloned = clone_definition_with_overlay(
        CONTACT_AGENT_DEFINITION,
        execution_profile="hub-delegated",
    )
    assert CONTACT_AGENT_DEFINITION.system_prompt == original
    assert HUB_DELEGATED_OVERLAY in cloned.system_prompt  # type: ignore[attr-defined]
    assert cloned is not CONTACT_AGENT_DEFINITION
    assert cloned.layer == CONTACT_AGENT_DEFINITION.layer  # type: ignore[attr-defined]
    assert cloned.handoff_targets == CONTACT_AGENT_DEFINITION.handoff_targets  # type: ignore[attr-defined]

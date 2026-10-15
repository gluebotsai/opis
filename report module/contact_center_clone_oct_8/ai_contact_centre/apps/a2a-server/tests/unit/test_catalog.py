"""Catalogue and dispatch contract tests."""

from cc_a2a.catalog import EXCLUDED_CAPABILITIES, get_skill, list_all_skills, list_skills, skill_ids
from cc_a2a.supervisor import DISPATCH

HUB_SKILLS = {
    "cc.contact.list",
    "cc.contact.read",
    "cc.contact.create",
    "cc.contact.update",
    "cc.contact.status.update",
    "cc.contact.enrich",
    "cc.conversation.context.read",
    "cc.queue.list",
    "cc.queue.agent-eligibility.read",
    "cc.agent.presence.read",
    "cc.queue.agent.add",
    "cc.queue.agent.remove",
    "cc.monitoring.callback-channels.read",
    "cc.callback.create",
    "cc.analytics.query",
    "cc.webchat.proactive-engagement.trigger",
    "cc.voice.auto-bot-call.trigger",
    "cc.anomaly.investigate",
}


def test_every_skill_has_dispatch_entry() -> None:
    for skill in list_skills():
        assert skill.skill_id in DISPATCH
        assert DISPATCH[skill.skill_id].skill_id == skill.skill_id


def test_hub_card_is_the_allowlisted_surface() -> None:
    ids = skill_ids()
    assert ids == HUB_SKILLS
    assert "cc.organization.read" not in ids
    assert "cc.queue.delete" not in ids
    assert "cc.task.list" not in ids
    assert "navigate" not in ids


def test_composite_inner_tools_are_unpublished() -> None:
    root_cause = get_skill("cc.analytics.root-cause.analyze")
    snapshot = get_skill("cc.monitoring.snapshot.read")
    assert root_cause is not None and root_cause.published is False
    assert snapshot is not None and snapshot.published is False
    assert root_cause.skill_id not in skill_ids()
    assert snapshot.skill_id in {skill.skill_id for skill in list_all_skills()}


def test_excluded_capabilities_documented() -> None:
    assert "navigate" in EXCLUDED_CAPABILITIES
    assert "stage_contact_draft" in EXCLUDED_CAPABILITIES
    assert "coworker task inbox" in EXCLUDED_CAPABILITIES
    assert "queue create/status/delete" in EXCLUDED_CAPABILITIES


def test_scopes_and_risks_present() -> None:
    for skill in list_skills():
        assert skill.scope.startswith("cc.")
        assert skill.risk in {"read", "reversible_write", "high_impact"}
        assert skill.domain
        assert skill.specialist
        assert skill.examples


def test_hub_card_has_no_high_impact_skills() -> None:
    high = {s.skill_id for s in list_skills() if s.risk == "high_impact"}
    assert high == set()


def test_anomaly_orchestration_is_read_only() -> None:
    skill = get_skill("cc.anomaly.investigate")
    assert skill is not None
    assert skill.risk == "read"
    for step_id in skill.orchestration:
        step = get_skill(step_id)
        assert step is not None
        assert step.risk == "read"
        assert step.published is False

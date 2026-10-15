"""Three-layer MAS assignment for Hub-typed skills."""

from cc_a2a.catalog import L1_AGENT, get_skill, list_skills
from cc_a2a.mas import activate_assignment, assignment_chain, executor_agent_name
from cc_a2a.overlay import HUB_DELEGATED_OVERLAY


def test_queue_staff_assignment_is_super_domain_executor() -> None:
    skill = get_skill("cc.queue.agent.add")
    assert skill is not None
    chain = assignment_chain(skill)
    assert [(step.layer, step.agent) for step in chain] == [
        ("super", L1_AGENT),
        ("domain", "workforce_management_domain"),
        ("executor", "queue"),
    ]
    assert executor_agent_name(skill) == "queue"


def test_webchat_assignment_uses_omnichannel_domain() -> None:
    skill = get_skill("cc.webchat.proactive-engagement.trigger")
    assert skill is not None
    chain = assignment_chain(skill)
    assert chain[0].agent == L1_AGENT
    assert chain[1].agent == "omnichannel_engagement_domain"
    assert chain[2].agent == "webchat"


def test_voice_bot_assignment_uses_omnichannel_domain() -> None:
    skill = get_skill("cc.voice.auto-bot-call.trigger")
    assert skill is not None
    chain = assignment_chain(skill)
    assert chain[0].agent == L1_AGENT
    assert chain[1].agent == "omnichannel_engagement_domain"
    assert chain[2].agent == "voice"
    activated = activate_assignment(skill, execution_profile="hub-delegated")
    assert activated[2]["mcpServers"] == []


def test_anomaly_assignment_coordinates_two_executors() -> None:
    skill = get_skill("cc.anomaly.investigate")
    assert skill is not None
    chain = assignment_chain(skill)
    agents = [(step.layer, step.agent) for step in chain]
    assert agents[0] == ("super", L1_AGENT)
    assert ("domain", "performance_intelligence_domain") in agents
    assert ("executor", "analytics") in agents
    assert ("domain", "workforce_management_domain") in agents
    assert ("executor", "monitoring") in agents


def test_activate_clones_layers_with_overlay_and_no_l1_mcp() -> None:
    skill = get_skill("cc.contact.list")
    assert skill is not None
    activated = activate_assignment(skill, execution_profile="hub-delegated")
    assert [row["layer"] for row in activated] == ["super", "domain", "executor"]
    assert activated[0]["agent"] == L1_AGENT
    assert activated[1]["agent"] == "interaction_operations_domain"
    assert activated[2]["agent"] == "contact"
    assert activated[0]["mcpServers"] == []
    assert activated[1]["mcpServers"] == []
    assert "contact" in activated[2]["mcpServers"]
    from app.agents.definitions import CONTACT_CENTER_SUPER_DEFINITION

    assert HUB_DELEGATED_OVERLAY not in CONTACT_CENTER_SUPER_DEFINITION.system_prompt


def test_published_skills_have_domain_and_executor() -> None:
    for skill in list_skills():
        assert skill.domain
        assert skill.specialist
        chain = assignment_chain(skill)
        assert chain[0].layer == "super"
        activate_assignment(skill, execution_profile="hub-delegated")

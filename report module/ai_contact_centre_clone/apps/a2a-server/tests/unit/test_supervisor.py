"""Supervisor missing-input and dispatch helpers."""

from unittest.mock import AsyncMock, patch

import pytest

from cc_a2a.auth import CallerContext
from cc_a2a.catalog import get_skill
from cc_a2a.config import A2ASettings
from cc_a2a.contracts import MissingInputStatus, SkillResultArtifact, WorktualEnvelope
from cc_a2a.supervisor import (
    SuperAgentExecutor,
    missing_required_fields,
    normalize_arguments,
    queue_staff_mcp_arguments,
)


def test_normalize_question_alias() -> None:
    skill = get_skill("cc.analytics.query")
    assert skill is not None
    args = normalize_arguments(skill, {"question": "How many contacts today?"})
    assert args["query"] == "How many contacts today?"
    assert "question" not in args
    assert missing_required_fields(skill, args) == []


def test_anomaly_investigate_accepts_hub_question() -> None:
    skill = get_skill("cc.anomaly.investigate")
    assert skill is not None
    question = "What is the current staffing distribution across open tickets?"
    assert missing_required_fields(skill, {"question": question}) == []
    assert missing_required_fields(skill, {"query": question}) == []
    args = normalize_arguments(skill, {"question": question})
    assert args["query"] == question
    assert missing_required_fields(skill, args) == []
    assert missing_required_fields(skill, {}) == ["question"]


def test_missing_required_fields() -> None:
    skill = get_skill("cc.webchat.proactive-engagement.trigger")
    assert skill is not None
    assert missing_required_fields(skill, {}) == ["visitorId"]
    assert missing_required_fields(skill, {"visitorId": "v1"}) == []
    assert missing_required_fields(skill, {"webchatId": "wc_x"}) == ["visitorId"]


def test_normalize_queue_agent_add_from_agent_name() -> None:
    skill = get_skill("cc.queue.agent.add")
    assert skill is not None
    args = normalize_arguments(
        skill,
        {"queueName": "Support", "agentName": "Jane Doe", "shiftType": "Regular"},
    )
    assert args["addAgents"] == [{"name": "Jane Doe", "shiftType": "Regular"}]
    assert missing_required_fields(skill, args) == []
    mcp_args = queue_staff_mcp_arguments(skill, args)
    assert mcp_args == {
        "queueName": "Support",
        "addAgents": [{"name": "Jane Doe", "shiftType": "Regular"}],
    }
    assert "agentName" not in mcp_args


def test_normalize_queue_agent_remove_names_and_ids() -> None:
    skill = get_skill("cc.queue.agent.remove")
    assert skill is not None
    args = normalize_arguments(
        skill,
        {"queueName": "Support", "agentName": "Jane Doe", "agentId": "1001"},
    )
    assert args["removeAgentNames"] == ["Jane Doe"]
    assert args["removeAgentIds"] == ["1001"]
    assert missing_required_fields(skill, args) == []
    assert missing_required_fields(skill, {"queueName": "Support"}) == ["removeAgentNames"]
    queued = normalize_arguments(skill, {"queueId": "12", "agentName": "Jane"})
    assert missing_required_fields(skill, queued) == []


def test_queue_agent_add_accepts_queue_id_without_name() -> None:
    skill = get_skill("cc.queue.agent.add")
    assert skill is not None
    args = normalize_arguments(skill, {"queueId": "12", "addAgents": ["Jane Doe"]})
    assert missing_required_fields(skill, args) == []


@pytest.mark.asyncio
async def test_executor_returns_input_required() -> None:
    executor = SuperAgentExecutor(A2ASettings(A2A_ENABLED=True, A2A_ALLOW_DEV_AUTH=True))
    caller = CallerContext(
        subject="hub:test",
        client_id="test",
        organization_ids=frozenset({"42"}),
        scopes=frozenset({"*"}),
        execution_profile="hub-delegated",
    )
    envelope = WorktualEnvelope(
        commandId="cmd-input-001",
        skillId="cc.contact.update",
        organizationId="42",
        arguments={},
    )
    result = await executor.execute(envelope, caller)
    assert isinstance(result, MissingInputStatus)
    assert "contactId" in result.missingFields


@pytest.mark.asyncio
async def test_anomaly_investigate_does_not_require_question_after_alias() -> None:
    executor = SuperAgentExecutor(A2ASettings(A2A_ENABLED=True, A2A_ALLOW_DEV_AUTH=True))
    caller = CallerContext(
        subject="hub:test",
        client_id="test",
        organization_ids=frozenset({"1003"}),
        scopes=frozenset({"*"}),
        execution_profile="hub-delegated",
    )
    envelope = WorktualEnvelope(
        commandId="hub-cmd-anomaly-001",
        skillId="cc.anomaly.investigate",
        organizationId="1003",
        arguments={
            "question": (
                "What is the current staffing distribution across open tickets "
                "and what SLA target vs observed resolution times exist?"
            )
        },
    )
    with patch.object(
        executor,
        "_execute_anomaly",
        new=AsyncMock(
            return_value=SkillResultArtifact(
                commandId=envelope.commandId,
                skillId=envelope.skillId,
                outcome="succeeded",
                message="ok",
            )
        ),
    ) as execute_anomaly:
        result = await executor.execute(envelope, caller)

    assert isinstance(result, SkillResultArtifact)
    assert result.outcome == "succeeded"
    execute_anomaly.assert_awaited_once()
    passed_args = execute_anomaly.await_args.args[3]
    assert passed_args["query"].startswith("What is the current staffing")
    assert "question" not in passed_args


@pytest.mark.asyncio
async def test_unpublished_inner_skill_is_rejected() -> None:
    executor = SuperAgentExecutor(A2ASettings(A2A_ENABLED=True, A2A_ALLOW_DEV_AUTH=True))
    caller = CallerContext(
        subject="hub:test",
        client_id="test",
        organization_ids=frozenset({"42"}),
        scopes=frozenset({"*"}),
        execution_profile="hub-delegated",
    )
    envelope = WorktualEnvelope(
        commandId="cmd-internal-001",
        skillId="cc.analytics.root-cause.analyze",
        organizationId="42",
        arguments={"question": "why"},
    )
    result = await executor.execute(envelope, caller)
    assert isinstance(result, SkillResultArtifact)
    assert result.outcome == "rejected"


@pytest.mark.asyncio
async def test_webchat_trigger_requires_visitor_only() -> None:
    executor = SuperAgentExecutor(A2ASettings(A2A_ENABLED=True, A2A_ALLOW_DEV_AUTH=True))
    caller = CallerContext(
        subject="hub:test",
        client_id="test",
        organization_ids=frozenset({"1003"}),
        scopes=frozenset({"cc.webchat.engagement.write"}),
        execution_profile="hub-delegated",
    )
    envelope = WorktualEnvelope(
        commandId="cmd-webchat-input-001",
        skillId="cc.webchat.proactive-engagement.trigger",
        organizationId="1003",
        arguments={},
    )
    result = await executor.execute(envelope, caller)
    assert isinstance(result, MissingInputStatus)
    assert result.missingFields == ["visitorId"]


@pytest.mark.asyncio
async def test_webchat_trigger_resolves_default_webchat_when_missing() -> None:
    executor = SuperAgentExecutor(A2ASettings(A2A_ENABLED=True, A2A_ALLOW_DEV_AUTH=True))
    caller = CallerContext(
        subject="hub:test",
        client_id="test",
        organization_ids=frozenset({"1003"}),
        scopes=frozenset({"cc.webchat.engagement.write"}),
        execution_profile="hub-delegated",
    )
    envelope = WorktualEnvelope(
        commandId="cmd-webchat-resolve-001",
        skillId="cc.webchat.proactive-engagement.trigger",
        organizationId="1003",
        arguments={"visitorId": "visitor_test"},
    )

    with (
        patch(
            "cc_a2a.supervisor.resolve_default_active_webchat",
            new=AsyncMock(
                return_value={
                    "webchatId": "wc_796fe56fa6f94e4c81039fbe90547468",
                    "channelConfigId": "1025",
                    "title": "Lola",
                }
            ),
        ),
        patch(
            "cc_a2a.supervisor.trigger_proactive_engagement",
            new=AsyncMock(
                return_value={
                    "ok": True,
                    "outcome": "delivered",
                    "conversationId": "97824",
                    "sessionStarted": True,
                }
            ),
        ),
    ):
        result = await executor.execute(envelope, caller)

    assert isinstance(result, SkillResultArtifact)
    assert result.outcome == "succeeded"
    assert result.affectedIds["webchatId"] == "wc_796fe56fa6f94e4c81039fbe90547468"
    assert result.evidence["resolvedWebchat"]["title"] == "Lola"


@pytest.mark.asyncio
async def test_voice_bot_trigger_requires_number() -> None:
    executor = SuperAgentExecutor(A2ASettings(A2A_ENABLED=True, A2A_ALLOW_DEV_AUTH=True))
    caller = CallerContext(
        subject="hub:test",
        client_id="test",
        organization_ids=frozenset({"1012"}),
        scopes=frozenset({"cc.voice.auto-bot.write"}),
        execution_profile="hub-delegated",
    )
    envelope = WorktualEnvelope(
        commandId="cmd-voice-input-001",
        skillId="cc.voice.auto-bot-call.trigger",
        organizationId="1012",
        arguments={},
    )
    result = await executor.execute(envelope, caller)
    assert isinstance(result, MissingInputStatus)
    assert result.missingFields == ["number"]


@pytest.mark.asyncio
async def test_voice_bot_trigger_publishes_call() -> None:
    executor = SuperAgentExecutor(A2ASettings(A2A_ENABLED=True, A2A_ALLOW_DEV_AUTH=True))
    caller = CallerContext(
        subject="hub:test",
        client_id="test",
        organization_ids=frozenset({"1012"}),
        scopes=frozenset({"cc.voice.auto-bot.write"}),
        execution_profile="hub-delegated",
    )
    envelope = WorktualEnvelope(
        commandId="cmd-voice-001",
        skillId="cc.voice.auto-bot-call.trigger",
        organizationId="1012",
        arguments={
            "number": "919150911820",
            "data": {"customer_name": "Subaz Bharathi"},
            "instruction": "Greet the customer and confirm the recent order.",
        },
    )
    with patch(
        "cc_a2a.supervisor.trigger_auto_bot_call",
        new=AsyncMock(
            return_value={
                "ok": True,
                "outcome": "succeeded",
                "sessionId": "7903dc44-9282-45ae-9d18-0758ba56e2f9",
                "channel": "CAMPAIGN_ACD_QA_70",
                "domainName": "1012.call.worktual.com",
                "cli": "+919003009126",
            }
        ),
    ) as publish:
        result = await executor.execute(envelope, caller)

    assert isinstance(result, SkillResultArtifact)
    assert result.outcome == "succeeded"
    assert result.affectedIds["sessionId"] == "7903dc44-9282-45ae-9d18-0758ba56e2f9"
    assert result.evidence["channel"] == "CAMPAIGN_ACD_QA_70"
    publish.assert_awaited_once()
    assert publish.await_args.kwargs["organization_id"] == "1012"
    assert publish.await_args.kwargs["number"] == "919150911820"

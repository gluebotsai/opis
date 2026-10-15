"""Policy and confirmation-ID tests."""

import pytest

from cc_a2a.auth import CallerContext
from cc_a2a.catalog import SkillSpec, get_skill
from cc_a2a.contracts import ApprovalEvidence, WorktualEnvelope
from cc_a2a.policy import PolicyError, confirmation_ids_for_policy, evaluate_policy


def _caller(*scopes: str, orgs: tuple[str, ...] = ("42",)) -> CallerContext:
    return CallerContext(
        subject="hub:test",
        client_id="test",
        organization_ids=frozenset(orgs),
        scopes=frozenset(scopes),
        execution_profile="hub-delegated",
    )


def _envelope(skill_id: str, approval: ApprovalEvidence | None = None) -> WorktualEnvelope:
    return WorktualEnvelope(
        commandId="cmd-12345678",
        skillId=skill_id,
        organizationId="42",
        arguments={},
        approval=approval,
    )


def _high_impact_skill() -> SkillSpec:
    return SkillSpec(
        skill_id="cc.test.high",
        name="High impact test",
        description="Policy unit fixture; not published on the Hub card.",
        domain="workforce_management_domain",
        specialist="queue",
        surface="queue-detail",
        mcp_server="queue",
        mcp_tool="delete_queue",
        scope="cc.queue.write",
        risk="high_impact",
        tags=("test",),
        examples=("test",),
        published=False,
    )


def test_read_requires_scope() -> None:
    skill = get_skill("cc.contact.list")
    assert skill is not None
    with pytest.raises(PolicyError) as exc:
        evaluate_policy(skill, _caller("cc.queue.read"), _envelope(skill.skill_id))
    assert exc.value.outcome == "auth_required"


def test_read_allowed_with_scope() -> None:
    skill = get_skill("cc.contact.list")
    assert skill is not None
    decision = evaluate_policy(skill, _caller("cc.contact.read"), _envelope(skill.skill_id))
    assert decision.allowed


def test_high_impact_requires_approval() -> None:
    skill = _high_impact_skill()
    with pytest.raises(PolicyError) as exc:
        evaluate_policy(
            skill,
            _caller("cc.queue.write"),
            _envelope(skill.skill_id),
            tool_arguments={"queueId": "1"},
        )
    assert exc.value.outcome == "auth_required"


def test_high_impact_with_approval_injects_exact_confirmation() -> None:
    skill = _high_impact_skill()
    args = {"queueId": "1"}
    approval = ApprovalEvidence(
        approvalId="apr-1",
        approvedSkillId=skill.skill_id,
        approvedAt="2026-01-01T00:00:00Z",
    )
    decision = evaluate_policy(
        skill,
        _caller("cc.queue.write"),
        _envelope(skill.skill_id, approval),
        tool_arguments=args,
    )
    confirmed = confirmation_ids_for_policy(skill, args, decision)
    assert decision.confirmationId
    assert confirmed == {decision.confirmationId}
    assert len(confirmed) == 1

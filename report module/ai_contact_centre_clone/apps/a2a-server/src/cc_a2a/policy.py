"""Write policy, scope enforcement, and MCP confirmation-ID translation."""

from __future__ import annotations

from typing import Any

from cc_a2a.auth import AuthError, CallerContext, has_scope
from cc_a2a.catalog import SkillSpec
from cc_a2a.contracts import ApprovalEvidence, PolicyDecision, WorktualEnvelope

# Reuse the exact MCP confirmation hash algorithm.
try:
    from app.mcp.context import operation_id as mcp_operation_id
except ImportError:  # pragma: no cover - unit tests without NLP path
    import hashlib
    import json

    def mcp_operation_id(tool_name: str, arguments: dict[str, Any]) -> str:
        payload = json.dumps(
            {"tool": tool_name, "args": arguments},
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


class PolicyError(Exception):
    def __init__(
        self,
        message: str,
        *,
        outcome: str = "rejected",
        retryable: bool = False,
        policy: PolicyDecision | None = None,
    ) -> None:
        super().__init__(message)
        self.outcome = outcome
        self.retryable = retryable
        self.policy = policy


def _approval_covers(skill: SkillSpec, approval: ApprovalEvidence | None) -> bool:
    if approval is None:
        return False
    return approval.approvedSkillId == skill.skill_id and bool(approval.approvalId)


def evaluate_policy(
    skill: SkillSpec,
    caller: CallerContext,
    envelope: WorktualEnvelope,
    *,
    tool_arguments: dict[str, Any] | None = None,
) -> PolicyDecision:
    if not has_scope(caller, skill.scope):
        decision = PolicyDecision(
            allowed=False,
            risk=skill.risk,
            scope=skill.scope,
            reason=f"Missing required scope {skill.scope}",
            requiresApproval=False,
        )
        raise PolicyError(
            decision.reason,
            outcome="auth_required",
            policy=decision,
        )

    confirmation_id = None
    if skill.mcp_tool and tool_arguments is not None:
        confirmation_id = mcp_operation_id(skill.mcp_tool, tool_arguments)

    if skill.risk == "read":
        return PolicyDecision(
            allowed=True,
            risk=skill.risk,
            scope=skill.scope,
            reason="Read skills execute automatically when scoped",
            confirmationId=confirmation_id,
        )

    if skill.risk == "reversible_write":
        return PolicyDecision(
            allowed=True,
            risk=skill.risk,
            scope=skill.scope,
            reason="Reversible write authorized by scope",
            confirmationId=confirmation_id,
        )

    # high_impact
    if not _approval_covers(skill, envelope.approval):
        decision = PolicyDecision(
            allowed=False,
            risk=skill.risk,
            scope=skill.scope,
            reason="High-impact write requires signed Hub approval evidence",
            requiresApproval=True,
            confirmationId=confirmation_id,
        )
        raise PolicyError(
            decision.reason,
            outcome="auth_required",
            policy=decision,
        )

    return PolicyDecision(
        allowed=True,
        risk=skill.risk,
        scope=skill.scope,
        reason="High-impact write authorized by Hub approval evidence",
        requiresApproval=True,
        confirmationId=confirmation_id,
    )


def confirmation_ids_for_policy(
    skill: SkillSpec,
    tool_arguments: dict[str, Any],
    policy: PolicyDecision,
) -> set[str]:
    """Translate Hub approval into the exact MCP confirmation id — never blanket-confirm."""
    if skill.risk == "read":
        return set()
    if not policy.allowed or not policy.confirmationId:
        return set()
    if skill.risk in {"reversible_write", "high_impact"}:
        return {policy.confirmationId}
    return set()


def assert_feature_flags(
    *,
    enabled: bool,
    organization_id: str,
    skill_id: str,
    enabled_tenants: set[str] | None,
    enabled_skills: set[str] | None,
) -> None:
    if not enabled:
        raise AuthError("A2A spoke is disabled", status_code=503)
    if enabled_tenants is not None and organization_id not in enabled_tenants:
        raise AuthError("A2A is not enabled for this tenant", status_code=403)
    if enabled_skills is not None and skill_id not in enabled_skills:
        raise AuthError("Skill is not enabled on this spoke", status_code=403)

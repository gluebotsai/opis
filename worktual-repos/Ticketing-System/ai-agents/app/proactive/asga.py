"""ASGA — deterministic safety middleware (not an LLM peer)."""

from __future__ import annotations

from app.proactive.contract import (
    HIGH_RISK_STATUS,
    HIGH_RISK_TOOLS,
    GateResult,
    Proposal,
)
from app.tools.registry import tools_for_agent


def _is_inbox_notification(proposal: Proposal) -> bool:
    """Staff pings are informational — never Approvals Confirm/Reject."""
    return (proposal.tool_name or "").strip() == "send_staff_notification"


def _is_tsaa_summary(proposal: Proposal) -> bool:
    """Rolling ticket ai_summary writes — execute or reject, never Approvals."""
    if (proposal.agent_id or "").strip().lower() != "tsaa":
        return False
    if (proposal.tool_name or "").strip() != "update_ticket":
        return False
    args = proposal.tool_args or {}
    if "ai_summary" not in args:
        return False
    # Only ai_summary — no status/assignee mutations mixed in.
    risky = {"status", "assignee", "resolver", "priority"}
    return not any(k in args and args.get(k) is not None for k in risky)


def _is_rcaa_learning(proposal: Proposal) -> bool:
    """RCAA routing-weight learning — audit/execute only, never Approvals."""
    return (proposal.agent_id or "").strip().lower() == "rcaa"


def _is_high_risk(proposal: Proposal) -> bool:
    if _is_inbox_notification(proposal):
        return False
    if proposal.risk_level == "high":
        return True
    tool = (proposal.tool_name or "").strip()
    if tool in HIGH_RISK_TOOLS:
        return True
    args = proposal.tool_args or {}
    status = str(args.get("status") or "").strip().lower()
    if status in HIGH_RISK_STATUS:
        return True
    vis = str(args.get("visibility") or "").strip().lower()
    if tool == "add_ticket_note" and vis == "public":
        return True
    if tool == "update_ticket" and args.get("assignee") and proposal.agent_id == "itra":
        # assignment is gated by confidence; steal/reassign of an existing assignee is high
        if str(args.get("steal_assignment") or "").lower() in {"1", "true", "yes"}:
            return True
    return False


def gate(
    proposal: Proposal,
    *,
    recent_count: int = 0,
    max_per_ticket: int = 3,
    already_handled: bool = False,
) -> GateResult:
    allowed = tools_for_agent(proposal.agent_id)
    tool = (proposal.tool_name or "").strip()
    if tool and tool not in allowed:
        return GateResult("reject", "undeclared_tool", proposal)
    if already_handled:
        return GateResult("reject", "idempotent_skip", proposal)

    from app.proactive.registry_agents import spec_for

    spec = spec_for(proposal.agent_id)
    threshold = spec.confidence_threshold if spec else 0.7

    # Deliver to the nav bell inbox; never queue Approvals Confirm/Reject.
    if _is_inbox_notification(proposal) and tool:
        if proposal.confidence < threshold:
            return GateResult("reject", "low_confidence", proposal)
        if proposal.ticket_id and recent_count >= max_per_ticket:
            return GateResult("reject", "rate_limited", proposal)
        return GateResult("execute", "inbox_notification", proposal)

    # TSAA documentation write — never Approvals Recommendations/Confirm.
    if _is_tsaa_summary(proposal) and tool:
        if proposal.confidence < threshold:
            return GateResult("reject", "low_confidence", proposal)
        # Lifecycle rewrites (resolve/reopen/create) must not be dropped by rate limit.
        bypass = bool((proposal.payload or {}).get("bypass_rate_limit"))
        if (
            not bypass
            and proposal.ticket_id
            and recent_count >= max_per_ticket
        ):
            return GateResult("reject", "rate_limited", proposal)
        return GateResult("execute", "tsaa_summary", proposal)

    # RCAA continuous learning — weights already written in propose(); never Approvals.
    if _is_rcaa_learning(proposal):
        if proposal.confidence < threshold:
            return GateResult("reject", "low_confidence", proposal)
        return GateResult("execute", "rcaa_learning", proposal)

    if proposal.ticket_id and recent_count >= max_per_ticket:
        return GateResult("recommend", "rate_limited", proposal)
    if proposal.confidence < threshold:
        return GateResult("recommend", "low_confidence", proposal)
    if proposal.output_type == "RECOMMENDATION" or not tool:
        return GateResult("recommend", "recommendation_only", proposal)
    if _is_high_risk(proposal):
        return GateResult("approve", "high_risk", proposal)
    return GateResult("execute", "allowed", proposal)

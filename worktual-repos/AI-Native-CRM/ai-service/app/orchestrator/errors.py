"""Typed failures raised by the native agent runtime."""

from __future__ import annotations

from typing import Any, Dict, Optional


class OrchestratorError(Exception):
    """Base error carrying a stable machine-readable code."""

    code = "orchestrator_error"

    def __init__(
        self,
        message: str,
        *,
        detail: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.detail = detail or {}


class ContractError(OrchestratorError):
    code = "invalid_contract"


class AgentNotFoundError(OrchestratorError):
    code = "agent_not_found"


class DeadlineExceededError(OrchestratorError):
    code = "deadline_exceeded"


class BudgetExceededError(OrchestratorError):
    code = "budget_exceeded"


class ToolCycleError(OrchestratorError):
    code = "tool_cycle_detected"


class ToolAuthorizationError(OrchestratorError):
    code = "tool_not_authorized"


class HandoffLimitError(OrchestratorError):
    code = "handoff_limit_exceeded"


class HandoffCycleError(OrchestratorError):
    code = "handoff_cycle_detected"


class PipelineError(OrchestratorError):
    code = "pipeline_failed"


class PolicyViolationError(OrchestratorError):
    code = "policy_violation"

"""Imperative proactive pipeline (separate from interactive chat supervisor)."""

from __future__ import annotations

from typing import Any, Callable

from app.proactive.contract import Proposal
from app.proactive.executor import execute_tool


StepFn = Callable[[dict[str, Any]], dict[str, Any] | None]


def run_steps(
    steps: list[StepFn],
    *,
    initial: dict[str, Any] | None = None,
    stop_on_error: bool = True,
) -> dict[str, Any]:
    """
    Linear conditional-step runner for proactive jobs.

    Each step receives the accumulating context and may return a patch dict
    or None. This is infrastructure only — agent LLMs still own decisions.
    """
    ctx: dict[str, Any] = dict(initial or {})
    results: list[dict[str, Any]] = []
    for i, step in enumerate(steps):
        try:
            out = step(ctx) or {}
        except Exception as exc:  # noqa: BLE001
            err = {"step": i, "error": str(exc)}
            results.append(err)
            ctx["last_error"] = err
            if stop_on_error:
                ctx["status"] = "error"
                ctx["step_results"] = results
                return ctx
            continue
        if isinstance(out, dict):
            ctx.update(out)
            results.append({"step": i, "ok": True, "keys": list(out.keys())})
    ctx["status"] = ctx.get("status") or "ok"
    ctx["step_results"] = results
    return ctx


def run_proposal_pipeline(proposal: Proposal | None) -> dict[str, Any] | None:
    """ASGA gate + apply_decision using the existing proactive contract."""
    from app.proactive.runtime import handle_proposal

    return handle_proposal(proposal)


def execute_approved_tool(
    agent_id: str,
    tool_name: str,
    tool_args: dict[str, Any],
) -> dict[str, Any]:
    """Execute a proactive tool via the shared executor (MCP/Express)."""
    return execute_tool(agent_id, tool_name, tool_args)

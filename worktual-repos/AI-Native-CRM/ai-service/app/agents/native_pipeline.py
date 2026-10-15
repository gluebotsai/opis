"""Small imperative executor for legacy agent node functions.

Node handlers retain the same contract they had under LangGraph: each receives
a snapshot of the accumulated state and may return either a partial update or
the full state. Keeping this adapter deliberately narrow makes control flow
visible in each agent and avoids introducing another graph framework.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Iterable
from typing import Any, Union

PipelineState = dict[str, Any]
NodeResult = Union[PipelineState, Awaitable[PipelineState]]
Node = Callable[[PipelineState], NodeResult]


async def run_steps(initial_state: PipelineState, steps: Iterable[Node]) -> PipelineState:
    """Run ordered nodes and merge each result into isolated run state."""

    state = dict(initial_state)
    for step in steps:
        update = step(dict(state))
        if inspect.isawaitable(update):
            update = await update
        if update:
            state.update(update)
    return state

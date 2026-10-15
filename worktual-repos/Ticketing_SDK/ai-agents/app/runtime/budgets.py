"""Tool-loop budgets and cycle detection."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any

from app.contracts.execution import RunBudgets
from app.contracts.errors import ToolLoopExhausted


@dataclass
class BudgetTracker:
    budgets: RunBudgets
    started_at: float = field(default_factory=time.perf_counter)
    rounds: int = 0
    tool_calls: int = 0
    call_signatures: list[str] = field(default_factory=list)

    def check_deadline(self) -> None:
        elapsed_ms = (time.perf_counter() - self.started_at) * 1000
        if elapsed_ms > self.budgets.deadline_ms:
            raise ToolLoopExhausted(
                "Tool loop deadline exceeded",
                details={"elapsed_ms": int(elapsed_ms)},
            )

    def begin_round(self) -> None:
        self.check_deadline()
        self.rounds += 1
        if self.rounds > self.budgets.max_rounds:
            raise ToolLoopExhausted(
                "Tool loop exceeded max rounds",
                details={"rounds": self.rounds},
            )

    def record_tool_call(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        count_toward_cycle: bool = True,
    ) -> None:
        self.tool_calls += 1
        if self.tool_calls > self.budgets.max_tool_calls:
            raise ToolLoopExhausted(
                "Tool loop exceeded max tool calls",
                details={"tool_calls": self.tool_calls},
            )
        if not count_toward_cycle:
            return
        sig = tool_call_signature(name, arguments)
        self.call_signatures.append(sig)
        # Same signature three times in a row = cycle
        if len(self.call_signatures) >= 3 and len(set(self.call_signatures[-3:])) == 1:
            raise ToolLoopExhausted(
                "Repeated tool-call cycle detected",
                details={"signature": sig},
            )


def tool_call_signature(name: str, arguments: dict[str, Any]) -> str:
    raw = json.dumps({"name": name, "arguments": arguments}, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

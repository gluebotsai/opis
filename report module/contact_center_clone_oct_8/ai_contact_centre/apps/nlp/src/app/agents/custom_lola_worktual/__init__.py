"""Worktual-specific custom Lola support bot."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agents.custom_lola_worktual.agent import CustomLolaWorktualAgent

__all__ = ["CustomLolaWorktualAgent"]


def __getattr__(name: str):
    if name == "CustomLolaWorktualAgent":
        from app.agents.custom_lola_worktual.agent import CustomLolaWorktualAgent

        return CustomLolaWorktualAgent
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

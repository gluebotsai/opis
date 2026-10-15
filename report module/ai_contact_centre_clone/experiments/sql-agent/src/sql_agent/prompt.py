"""Compose the MiniMax system prompt from agent.md + optional skill."""

from __future__ import annotations

from pathlib import Path

EXPERIMENT_ROOT = Path(__file__).resolve().parents[2]


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def build_system_prompt(agent_name: str = "sql_developer") -> str:
    agent = load_text(EXPERIMENT_ROOT / "agents" / agent_name / "agent.md")
    if agent_name != "sql_developer":
        return (
            f"{agent}\n\n"
            "Call route_to_agent to hand analytics questions to sql_developer. "
            "Do not invent SQL or warehouse totals."
        )
    skill = load_text(EXPERIMENT_ROOT / "skill.yaml")
    return (
        f"{agent}\n\n"
        "ACTIVE SKILL [sql-developer]:\n"
        f"{skill}\n\n"
        "Call tools to inspect the catalog. Do not dump SQL in the user-visible reply."
    )

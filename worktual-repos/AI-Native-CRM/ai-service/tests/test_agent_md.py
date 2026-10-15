"""Shared agent.md loader — prompt sections for finance job agents."""

from __future__ import annotations

from pathlib import Path

from app.agents.agent_md import agent_md_path, load_agent_md, parse_agent_md

ROOT = Path(__file__).resolve().parents[1]


def test_parse_agent_md_sections():
    text = """
# demo

## role
Analyst

## goal
Judge risk

## instructions
Step one

## output
JSON only

## guardrails
Never invent data
"""
    sections = parse_agent_md(text)
    assert sections["role"] == "Analyst"
    assert sections["goal"] == "Judge risk"
    assert "Step one" in sections["instructions"]


def test_load_finance_agent_md_files():
    caller = str(ROOT / "app" / "agents" / "__init__.py")
    for name in ("company-collection-risk", "revenue-gap-forecast", "invoice-dunning"):
        path = agent_md_path(caller, name)
        assert Path(path).is_file()
        sections = load_agent_md(path)
        for key in ("role", "goal", "instructions", "output", "guardrails"):
            assert sections[key].strip(), f"{name} missing {key}"

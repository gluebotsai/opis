"""Forbidden framework import guard for the native AI packages."""

from __future__ import annotations

from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "app"

# Packages that must never import LangChain / LangGraph.
NATIVE_PACKAGES = (
    "contracts",
    "llm",
    "runtime",
    "mcp",
    "memory",
    "api",
    "observability",
    "skills",
    "proactive",
    "agents",
    "tools",
    "prompts",
)

FORBIDDEN = ("langchain", "langchain_core", "langchain_openai", "langgraph")


def _scan(root: Path) -> list[str]:
    hits: list[str] = []
    if not root.exists():
        return hits
    for path in root.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            for name in FORBIDDEN:
                if f"import {name}" in stripped or f"from {name}" in stripped:
                    hits.append(f"{path.relative_to(APP.parent)}: {stripped}")
    return hits


def test_native_packages_forbid_langchain_langgraph():
    hits: list[str] = []
    for pkg in NATIVE_PACKAGES:
        hits.extend(_scan(APP / pkg))
    assert hits == [], "Forbidden framework imports:\n" + "\n".join(hits)


def test_app_requirements_exclude_langchain_langgraph():
    req = (APP.parent / "requirements.txt").read_text(encoding="utf-8").lower()
    for name in FORBIDDEN:
        assert name not in req, f"{name} still listed in requirements.txt"


def test_parity_inventory_customer_can_create():
    from app.parity_inventory import ROLE_CAN_CREATE_TICKET

    assert ROLE_CAN_CREATE_TICKET["customer"] is True
    assert ROLE_CAN_CREATE_TICKET["portal_customer"] is True
    assert ROLE_CAN_CREATE_TICKET["resolver"] is False
    assert ROLE_CAN_CREATE_TICKET["portal_guest"] is False


def test_form_chat_parity_tools_are_in_mcp_catalog():
    from app.mcp.catalog import catalog_by_name, tools_for_specialist
    from app.parity_inventory import FORM_CHAT_PARITY, SPECIALISTS

    catalog = catalog_by_name()
    for row in FORM_CHAT_PARITY:
        tool = row["tool"]
        assert tool in catalog, f"missing catalog tool {tool}"
    for specialist in SPECIALISTS:
        tools = tools_for_specialist(specialist, include_route=True)
        assert tools, f"specialist {specialist} has no tools"
        assert any(t.name == "route_to_agent" for t in tools)


def test_proactive_native_pipeline_imports():
    from app.proactive.native_pipeline import run_proposal_pipeline, run_steps
    from app.parity_inventory import PROACTIVE_AGENTS

    assert callable(run_steps)
    assert callable(run_proposal_pipeline)
    assert len(PROACTIVE_AGENTS) >= 5

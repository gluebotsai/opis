"""Quotes create must hand off to Sales for proposal intent — not quote draft."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from app.agents.crm_agent import handle_agent_turn
from app.agents.deal_coworker_agent import resolve_proposal_not_quote_turn


def test_resolve_proposal_not_quote_on_quotes_create() -> None:
    out = resolve_proposal_not_quote_turn(
        user_text="create proposal",
        mod="quotes",
        pathname="/sales/quotes/new",
        catalog={"deals": []},
    )
    assert out and out.get("ok")
    tools = out.get("toolProposals") or []
    assert any(t.get("name") == "navigate" for t in tools)
    assert out.get("reason") == "proposal_not_quote"
    assert "proposal" in (out.get("assistantText") or "").lower()
    assert "quote" in (out.get("assistantText") or "").lower()


async def _quotes_create_turn(text: str, catalog: dict | None = None) -> dict:
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch("app.agents.coworker_runtime.run_skill_turn", return_value=None),
        patch("app.agents.crm_agent.run_native_agent_turn", return_value=None),
        patch(
            "app.agents.crm_agent._run_module_draft",
            return_value={
                "ok": True,
                "assistantText": "Which deal is this quote for?",
                "source": "heuristic",
            },
        ),
    ):
        return await handle_agent_turn(
            {
                "messages": [{"role": "user", "text": text}],
                "context": {
                    "module": "quotes",
                    "surface": "create",
                    "pathname": "/sales/quotes/new",
                    "draft": {},
                },
                "catalog": catalog or {"deals": []},
            }
        )


def test_handle_agent_turn_quotes_create_proposal_not_quote_draft() -> None:
    r = asyncio.run(_quotes_create_turn("create proposal"))
    assert r and r.get("ok")
    assert r.get("reason") == "proposal_not_quote"
    tools = r.get("toolProposals") or []
    assert any(
        t.get("name") == "navigate"
        and str((t.get("args") or {}).get("href") or "").startswith("/sales")
        for t in tools
    )
    speech = (r.get("assistantText") or "").lower()
    assert "proposal" in speech
    assert "which deal is this quote" not in speech

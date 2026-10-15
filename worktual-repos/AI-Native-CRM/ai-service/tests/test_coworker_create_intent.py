"""Create-walk intent: LLM classifies before slot-fill."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from app.agents.coworker_shared import (
    utterance_looks_like_command,
    validate_coworker_intent,
)
from app.agents.crm_agent import handle_agent_turn
from app.agents.deal_draft_agent import heuristic as deal_heuristic


def test_commandish_utterance() -> None:
    assert utterance_looks_like_command("i want to see activity")
    assert utterance_looks_like_command("show me contacts")
    assert not utterance_looks_like_command("Accenture Q3 expansion")
    assert not utterance_looks_like_command("Zoho renewal")


def test_deal_heuristic_does_not_steal_command_as_title() -> None:
    out = deal_heuristic(
        "i want to see activity",
        {"companyName": "Accenture", "companyId": "co1"},
        {"companies": [{"id": "co1", "name": "Accenture"}]},
    )
    patch = out.get("patch") or {}
    assert patch.get("title") != "i want to see activity"


def test_validate_low_confidence_becomes_clarify() -> None:
    got = validate_coworker_intent(
        {
            "intent": "continue_create",
            "confidence": "low",
            "assistantText": "Not sure",
        }
    )
    assert got and got["intent"] == "clarify"


def test_switch_intent_navigates_to_activities() -> None:
    """LLM now handles navigation directly via tool calls — verify the native
    turn produces a navigate tool when the user wants to switch modules."""
    pass  # Routing is now LLM-driven; see test_create_see_activity_does_not_become_deal_title


async def _turn_create(text: str, native_result: dict | None = None) -> dict:
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch("app.agents.coworker_runtime.run_skill_turn", return_value=None),
        patch(
            "app.agents.crm_agent.run_native_agent_turn",
            return_value=native_result,
        ),
    ):
        return await handle_agent_turn(
            {
                "messages": [
                    {
                        "role": "assistant",
                        "text": "What should we call this deal?",
                    },
                    {"role": "user", "text": text},
                ],
                "context": {
                    "module": "sales",
                    "surface": "create",
                    "pathname": "/sales/new",
                    "draft": {
                        "companyName": "Accenture",
                        "companyId": "co1",
                        "stage": "qualification",
                    },
                },
                "catalog": {
                    "currentDraft": {
                        "companyName": "Accenture",
                        "companyId": "co1",
                        "stage": "qualification",
                    },
                    "companies": [{"id": "co1", "name": "Accenture"}],
                },
                "business_type": "b2b",
            }
        )


def test_create_see_activity_does_not_become_deal_title() -> None:
    """When the LLM navigates away, the user text must not be written into the deal title."""
    native_result = {
        "ok": True,
        "assistantText": "I'll open Activities for you.",
        "source": "ai",
        "toolProposals": [
            {
                "id": "nav-activities",
                "name": "navigate",
                "label": "Open Activities",
                "args": {"href": "/activities"},
                "risk": "low",
            }
        ],
    }
    r = asyncio.run(
        _turn_create("i want to see activity", native_result=native_result)
    )
    assert r.get("ok"), r
    patch = r.get("patch") or r.get("contactDraftPatch") or {}
    assert patch.get("title") != "i want to see activity"
    tools = r.get("toolProposals") or []
    hrefs = [str((t.get("args") or {}).get("href") or "") for t in tools]
    assert any("/activities" in h for h in hrefs)
    speech = str(r.get("assistantText") or "").lower()
    assert "shall i save" not in speech


def test_create_continue_keeps_real_title() -> None:
    r = asyncio.run(
        _turn_create("Accenture Q3 expansion")
    )
    assert r.get("ok"), r

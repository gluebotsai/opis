"""Tests for shared LLM result helpers and LLM-first agent fallbacks."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.llm_result import (
    extract_json,
    label_ai,
    label_fallback,
    sectioned_system_prompt,
)
from app.agents.lifecycle_lead_agent import (
    decide_via_llm,
    decide_lifecycle_heuristic,
    decision_for_persist,
)
from app.agents.nurture_lead_agent import decide_via_llm as nurture_decide_via_llm
from app.agents.nurture_lead_agent import heuristic_decide


def test_sectioned_system_prompt_order():
    text = sectioned_system_prompt(
        role="R",
        goal="G",
        instructions="I",
        context="C",
        output="O",
        guardrails="X",
    )
    assert text.index("Role:") < text.index("Goal:")
    assert text.index("Goal:") < text.index("Instructions:")
    assert text.index("Instructions:") < text.index("Context:")
    assert text.index("Context:") < text.index("Output:")
    assert text.index("Output:") < text.index("Guardrails:")


def test_extract_json_fenced_and_raw():
    assert extract_json('{"a":1}') == {"a": 1}
    assert extract_json('```json\n{"b":2}\n```') == {"b": 2}
    assert extract_json("noise {\"c\":3} trailing") == {"c": 3}
    assert extract_json("") is None


def test_label_ai_and_fallback():
    assert label_ai({"score": 1})["source"] == "ai"
    fb = label_fallback({"score": 1}, "llm_empty")
    assert fb["source"] == "heuristic"
    assert fb["reason"] == "llm_empty"


@pytest.mark.asyncio
async def test_lifecycle_llm_ok_returns_ai_decision():
    raw = (
        '{"action":{"kind":"wait","waitHours":12},"ladder":"none",'
        '"from":null,"to":null,"reason":"No signal yet"}'
    )
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.llm.generate_ai_text",
            new_callable=AsyncMock,
            return_value=raw,
        ),
    ):
        decision, reason = await decide_via_llm(
            {"displayName": "Ada", "leadStatus": "new", "signals": {}}
        )
    assert reason is None
    assert decision is not None
    assert decision["action"]["kind"] == "wait"


@pytest.mark.asyncio
async def test_lifecycle_llm_off_falls_back_reason():
    with patch("app.llm.is_ai_configured", return_value=False):
        decision, reason = await decide_via_llm({"displayName": "Ada"})
    assert decision is None
    assert reason == "llm_not_configured"
    heur = decide_lifecycle_heuristic(
        {
            "contactStatus": "active",
            "contactType": "lead",
            "leadStatus": "new",
            "outboundTouches": 0,
            "signals": {},
        }
    )
    assert heur["action"]["kind"] == "wait"


def test_lifecycle_persist_keeps_domain_reason_after_ai_label():
    persist = decision_for_persist(
        {
            "action": {"kind": "lead_status", "to": "contacted"},
            "ladder": "lead_status",
            "from": "new",
            "to": "contacted",
            "reason": "First outreach logged (1 outbound touch).",
        },
        source="ai",
    )
    assert persist.get("source") is None
    assert persist["reason"] == "First outreach logged (1 outbound touch)."
    assert persist["from"] == "new"
    assert persist["to"] == "contacted"


def test_lifecycle_persist_keeps_domain_reason_after_heuristic_label():
    persist = decision_for_persist(
        {
            "action": {"kind": "close_won"},
            "ladder": "pipeline",
            "from": "negotiate",
            "to": "closed_won",
            "reason": "Invoice paid — closing won from CRM commercial state",
        },
        source="heuristic",
        fallback_reason="commercial_win_db",
    )
    assert persist.get("source") is None
    assert persist["reason"] == "Invoice paid — closing won from CRM commercial state"


@pytest.mark.asyncio
async def test_nurture_llm_ok_returns_ai_decision():
    raw = (
        '{"decision":"nurture_now","score":72,'
        '"rationale":"Quiet but viable","waitDays":null}'
    )
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.llm.generate_ai_text",
            new_callable=AsyncMock,
            return_value=raw,
        ),
    ):
        decision, reason = await nurture_decide_via_llm(
            {"displayName": "Ada", "leadStatus": "contacted"}
        )
    assert reason is None
    assert decision is not None
    assert decision["decision"] == "nurture_now"
    assert decision["score"] == 72


@pytest.mark.asyncio
async def test_nurture_llm_off_uses_heuristic_path_reason():
    with patch("app.llm.is_ai_configured", return_value=False):
        decision, reason = await nurture_decide_via_llm({"displayName": "Ada"})
    assert decision is None
    assert reason == "llm_not_configured"
    heur = heuristic_decide(
        {
            "leadStatus": "disqualified",
            "notes": "not interested",
            "activities": [],
        }
    )
    assert heur["decision"] == "skip_not_interested"

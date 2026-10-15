"""Reports chat visual gating — include_visual tool flag."""

from __future__ import annotations

from app.agents.reports.visual_policy import (
    analytics_for_chat_payload,
    resolve_include_visual,
    tool_result_include_visual,
)
from app.mas.runtime.transcript import extract_turn_chat_meta


def test_resolve_include_visual_defaults():
    assert resolve_include_visual("query_analytics", {}) is True
    assert resolve_include_visual("LIST_MONITOR_CAMPAIGNS", {}) is False
    assert resolve_include_visual("GET_CAMPAIGN_REPORT", {}) is False
    assert resolve_include_visual("query_analytics", {"include_visual": False}) is False
    assert resolve_include_visual("LIST_MONITOR_CAMPAIGNS", {"include_visual": True}) is True


def test_analytics_for_chat_payload_requires_visual():
    assert analytics_for_chat_payload(None) is None
    assert analytics_for_chat_payload({"findings": {"summary": "x"}}) is None
    assert analytics_for_chat_payload({"include_visual": False, "visual": {"kind": "kpi"}}) is None
    out = analytics_for_chat_payload({"visual": {"kind": "kpi", "title": "KPIs"}})
    assert out is not None
    assert out.get("include_visual") is True


def test_tool_result_include_visual_honors_result_flag():
    assert tool_result_include_visual(
        "LIST_MONITOR_CAMPAIGNS", {"include_visual": True}
    )
    assert not tool_result_include_visual(
        "LIST_MONITOR_CAMPAIGNS", {"include_visual": False}
    )


def test_extract_turn_chat_meta_from_domain_result():
    meta = extract_turn_chat_meta(
        {
            "domain_result": {
                "reply": "3 live campaigns.",
                "analytics": {
                    "visual": {"kind": "kpi", "title": "Counts"},
                    "findings": {"summary": "3 live"},
                },
                "suggestions": ["Open rate this week"],
            }
        }
    )
    assert meta is not None
    assert meta["analytics"]["visual"]["kind"] == "kpi"
    assert meta["suggestions"] == ["Open rate this week"]


def test_extract_turn_chat_meta_skips_when_no_visual():
    assert extract_turn_chat_meta({"domain_result": {"reply": "Audience: 500 contacts."}}) is None
    assert extract_turn_chat_meta(
        {
            "domain_result": {
                "analytics": {"include_visual": False, "visual": {"kind": "kpi"}},
            }
        }
    ) is None

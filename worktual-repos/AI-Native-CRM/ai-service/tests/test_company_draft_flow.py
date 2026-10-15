"""Company draft conversation — collect name + location before ready."""

from __future__ import annotations

from app.agents.company_draft_agent import (
    _parse_company_name_correction,
    company_heuristic,
)
from app.agents.draft_conversation import (
    company_draft_ready,
    next_company_prompt,
    should_persist_ready_company,
)


def test_ready_requires_name_and_location():
    assert not company_draft_ready({"name": "OvalEdge"})
    assert not company_draft_ready({"locationName": "Mumbai"})
    assert company_draft_ready({"name": "OvalEdge", "locationName": "Mumbai"})


def test_name_only_asks_for_location():
    r = company_heuristic("OvalEdge", {})
    assert r["ok"]
    assert r["patch"]["name"] == "OvalEdge"
    assert not r.get("assistantText")
    assert not company_draft_ready(r["patch"])


def test_name_correction_acknowledged():
    r = company_heuristic(
        "sorry name is ovaledge",
        {"name": "oveledge"},
    )
    assert r["patch"]["name"].lower() == "ovaledge"
    assert not r.get("assistantText")


def test_domain_does_not_mark_ready_without_location():
    r = company_heuristic(
        "ovaledge.com",
        {"name": "ovaledge"},
    )
    assert r["patch"]["domain"] == "ovaledge.com"
    assert not company_draft_ready({"name": "ovaledge", "domain": "ovaledge.com"})
    assert not r.get("assistantText")


def test_location_then_ready_offer():
    r = company_heuristic(
        "Mumbai",
        {"name": "ovaledge", "domain": "ovaledge.com"},
    )
    assert r["patch"]["locationName"] == "Mumbai"
    assert company_draft_ready(
        {"name": "ovaledge", "domain": "ovaledge.com", "locationName": "Mumbai"}
    )
    assert not r.get("assistantText")


def test_parse_name_correction():
    assert _parse_company_name_correction("sorry name is ovaledge") == "ovaledge"
    assert _parse_company_name_correction("name is Acme Corp") == "Acme Corp"


def test_clamp_keeps_location_given_with_the_name():
    from app.agents.draft_conversation import clamp_company_patch_to_walk

    clean = clamp_company_patch_to_walk(
        {
            "name": "Oveledge India Pvt Ltd",
            "locationName": "Hyderabad",
            "domain": "oveledge.com",
        },
        ask="name",
    )
    assert clean["name"] == "Oveledge India Pvt Ltd"
    assert clean["locationName"] == "Hyderabad"
    assert "domain" not in clean


def test_persist_when_location_completes_the_company():
    before = {"name": "Oveledge India Pvt Ltd"}
    merged = {**before, "locationName": "Hyderabad"}
    assert should_persist_ready_company("Hyderabad", before=before, merged=merged)
    assert should_persist_ready_company(
        "create company Oveledge India Pvt Ltd in Hyderabad",
        before={},
        merged=merged,
    )
    assert should_persist_ready_company("save it", before=merged, merged=merged)


def test_do_not_persist_a_question_or_a_half_draft():
    ready = {"name": "Oveledge India Pvt Ltd", "locationName": "Hyderabad"}
    assert not should_persist_ready_company(
        "what about industry?",
        before=ready,
        merged=ready,
    )
    assert not should_persist_ready_company(
        "Hyderabad?",
        before={"name": "Oveledge India Pvt Ltd"},
        merged=ready,
    )
    assert not should_persist_ready_company(
        "Hyderabad",
        before={"name": "Oveledge India Pvt Ltd"},
        merged={"name": "Oveledge India Pvt Ltd"},
    )


def test_next_prompt_order():
    assert "company" in next_company_prompt({}).lower()
    assert "office" in next_company_prompt({"name": "X"}).lower()
    prompt = next_company_prompt({"name": "X", "locationName": "HQ"})
    assert "save" in prompt.lower()

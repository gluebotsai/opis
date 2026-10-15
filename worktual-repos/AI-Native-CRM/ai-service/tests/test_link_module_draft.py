"""Smoke tests for quote / invoice / activity create-confirm flow."""

from __future__ import annotations

import pytest

from app.agents.draft_conversation import (
    activity_draft_ready,
    invoice_draft_ready,
    looks_like_create_confirm,
    quote_draft_ready,
    ready_create_chat,
)
from app.agents.misc_draft_agents import (
    activity_heuristic,
    invoice_heuristic,
    quote_heuristic,
)
from app.agents.crm_tools import map_tool_calls_to_result


def test_invoice_draft_ready_and_confirm_proposal():
    draft = {"dealId": "deal-1"}
    assert invoice_draft_ready(draft)
    assert looks_like_create_confirm("yes save it")
    res = invoice_heuristic("yes", deals=[{"id": "deal-1", "title": "Acme"}], draft=draft)
    assert res["ok"]
    props = res.get("toolProposals") or []
    assert any(
        p["name"] == "propose_create_invoice" and p["args"].get("auto") is True
        for p in props
    )
    assert not res.get("assistantText")


def test_activity_draft_ready_and_confirm_proposal():
    draft = {"contactId": "c1", "subject": "Follow up call"}
    assert activity_draft_ready(draft)
    res = activity_heuristic(
        "create",
        contacts=[{"id": "c1", "displayName": "Ada Lovelace"}],
        draft=draft,
    )
    props = res.get("toolProposals") or []
    assert any(p["name"] == "propose_create_activity" for p in props)


def test_quote_draft_ready_prompt():
    draft = {"dealId": "d1", "productId": "p1", "quantity": "1"}
    assert quote_draft_ready(draft)
    prompt = ready_create_chat(draft)
    assert "shall i save" in prompt.lower()
    assert "type yes" not in prompt.lower()
    assert "say skip" not in prompt.lower()
    assert not quote_draft_ready({"dealId": "d1"})


def test_field_add_clarifies_not_create():
    from app.agents.link_module_coworker_agent import _wants_create, heuristic

    assert not _wants_create("add a discount", "quotes")
    assert not _wants_create("add a currency", "finance")
    assert _wants_create("create a quote", "quotes")
    assert _wants_create("add a quote", "quotes")
    r = heuristic(
        kind="quotes",
        text="add a discount",
        context={"module": "quotes", "surface": "list"},
        catalog={},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )
    assert "which" in r["assistantText"].lower()


def test_quote_heuristic_confirm():
    draft = {"dealId": "d1", "productId": "p1", "quantity": "1"}
    res = quote_heuristic(
        "yes please",
        deals=[{"id": "d1", "title": "Big deal"}],
        draft=draft,
    )
    props = res.get("toolProposals") or []
    assert any(p["name"] == "propose_create_quote" for p in props)


def test_map_propose_create_quote_auto_on_confirm():
    r = map_tool_calls_to_result(
        None,
        [{"function": {"name": "propose_create_quote", "arguments": {}}}],
        mod="quotes",
        pathname="/sales/quotes",
        user_text="create",
        current_draft={"dealId": "d1", "productId": "p1", "quantity": "1"},
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(
        t["name"] == "propose_create_quote" and t["args"].get("auto") is True
        for t in props
    )
    assert not (r.get("assistantText") or "").strip()


def test_invoice_prompt_asks_to_save_not_notes():
    from app.agents.draft_conversation import next_invoice_prompt

    text = next_invoice_prompt({"dealId": "d1"}, just_patched=True)
    lower = text.lower()
    assert "shall i create" in lower or "shall i save" in lower
    assert "currency" not in lower
    assert "notes" not in lower


def test_invoice_heuristic_matches_deal_by_contact():
    deals = [
        {
            "id": "deal-tick",
            "title": "Ticketing",
            "contactName": "Manoj Sharma",
            "companyName": "nvidia",
        },
        {
            "id": "deal-other",
            "title": "Other",
            "contactName": "Priya",
            "companyName": "Acme",
        },
    ]
    res = invoice_heuristic(
        "create an invoice for Manoj Ticketing",
        deals=deals,
        draft={},
    )
    assert res["ok"]
    assert (res.get("patch") or {}).get("dealId") == "deal-tick"
    assert not res.get("assistantText")


def test_invoice_create_with_deal_opens_create_and_patches():
    from app.agents.link_module_coworker_agent import heuristic

    r = heuristic(
        kind="finance",
        text="create an invoice for Manoj on Ticketing",
        context={"module": "finance", "surface": "list"},
        catalog={
            "deals": [
                {
                    "id": "deal-tick",
                    "title": "Ticketing",
                    "contactName": "Manoj Sharma",
                    "companyName": "nvidia",
                }
            ]
        },
    )
    assert r and r["ok"]
    assert (r.get("patch") or {}).get("dealId") == "deal-tick"
    props = r.get("toolProposals") or []
    assert any(
        p.get("name") == "set_workspace"
        and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )
    # No seed re-ask when deal already linked
    assert not any((p.get("args") or {}).get("seedPrompt") for p in props)
    lower = r["assistantText"].lower()
    assert "currency" not in lower
    assert "notes" not in lower


def test_native_invoice_patch_overrides_notes_fishing():
    r = map_tool_calls_to_result(
        "Got it — do you want to add notes or specify a currency?",
        [
            {
                "function": {
                    "name": "patch_invoice_draft",
                    "arguments": {"dealId": "deal-1"},
                }
            }
        ],
        mod="finance",
        pathname="/finance",
        user_text="link the Ticketing deal",
        current_draft={},
    )
    assert r["ok"]
    assert (r.get("patch") or {}).get("dealId") == "deal-1"
    assert "got it" in (r.get("assistantText") or "").lower()


@pytest.mark.asyncio
async def test_link_leaves_contact_slot_answer_unhandled():
    from app.agents.link_module_coworker_agent import handle

    state = await handle(
        {
            "messages": [
                {
                    "role": "assistant",
                    "text": "Sure, let's log it. Who is this activity for — which contact?",
                },
                {"role": "user", "text": "yaswanth"},
            ],
            "context": {"module": "activities", "surface": "list"},
            "catalog": {
                "contacts": [{"id": "c1", "displayName": "Yaswanth Kumar"}]
            },
            "kind": "activities",
        }
    )
    assert (state.get("result") or {}).get("_unhandled") is True
    tools = (state.get("result") or {}).get("toolProposals") or []
    assert not any(
        t.get("name") == "set_workspace"
        and (t.get("args") or {}).get("search")
        for t in tools
    )


def test_activity_log_from_list_opens_create_not_search():
    from app.agents.link_module_coworker_agent import _wants_create, heuristic

    text = 'Log a note for Yaswanth: "he said to have a meet today evening 5 pm"'
    assert _wants_create(text.lower(), "activities")
    hit = heuristic(
        kind="activities",
        text=text,
        context={"module": "activities", "surface": "list"},
        catalog={"contacts": [{"id": "c1", "displayName": "Yaswanth Kumar"}]},
    )
    tools = (hit or {}).get("toolProposals") or []
    assert any(
        t.get("name") == "set_workspace"
        and (t.get("args") or {}).get("mode") == "create"
        for t in tools
    )
    assert not any((t.get("args") or {}).get("search") for t in tools)

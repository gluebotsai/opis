"""Deal co-worker intent routing — create vs edit vs search."""

from __future__ import annotations

from app.agents.crm_agent import sanitize_tool_proposals
from app.agents.deal_coworker_agent import (
    _wants_create,
    _wants_edit,
    deals_heuristic,
    resolve_deal_match,
)
from app.agents.deal_draft_agent import heuristic as deal_draft_heuristic
from app.agents.draft_conversation import deal_draft_ready


def test_want_to_edit_is_not_create():
    assert _wants_edit("i want to edit deal")
    assert not _wants_create("i want to edit deal")
    assert not _wants_create("edit deal")


def test_create_phrases_still_match():
    assert _wants_create("create a new deal")
    assert _wants_create("help me create a deal")
    assert _wants_create("add a deal")
    assert _wants_create("insert deal")


def test_add_field_is_update_not_create():
    assert _wants_edit("add an amount")
    assert not _wants_create("add an amount")
    assert _wants_edit("add a stage")
    assert not _wants_create("add a stage")
    assert _wants_create("create a deal")
    r = deals_heuristic(
        "add an amount",
        {"module": "sales", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )


def test_create_opens_workspace():
    r = deals_heuristic(
        "create deal",
        {"module": "sales", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "create"


def test_edit_asks_which_deal():
    r = deals_heuristic("i want to edit deal", {"module": "sales", "surface": "list"})
    assert r and r["ok"]
    assert "which deal" in r["assistantText"].lower()
    assert not r.get("toolProposals")


def test_edit_with_name_opens_unique_match():
    catalog = {
        "deals": [
            {
                "id": "d1",
                "title": "Acme Expansion",
                "companyName": "Acme Corp",
            }
        ]
    }
    r = deals_heuristic(
        "open Acme Expansion",
        {"module": "sales", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "detail"
    assert props[0]["args"]["entityId"] == "d1"


def test_resolve_deal_match_by_company():
    catalog = {
        "deals": [
            {"id": "d1", "title": "Q3 renewal", "companyName": "Acme"},
        ]
    }
    match = resolve_deal_match(catalog, "acme")
    assert match and match["id"] == "d1"


def test_draft_ready_needs_title_and_company():
    assert not deal_draft_ready({"title": "X"})
    assert deal_draft_ready({"title": "X", "companyId": "c1"})
    assert deal_draft_ready({"title": "X", "companyName": "Acme"})


def test_draft_amount_shorthand_parses_k():
    from app.agents.draft_conversation import parse_money_amount

    assert parse_money_amount("amount 25k") == "25000.0"
    assert parse_money_amount("2.5k") == "2500.0"
    assert parse_money_amount("$1,200") == "1200"
    assert parse_money_amount("amount: 5000") == "5000"
    assert parse_money_amount("set amount to 15k") == "15000.0"

    r = deal_draft_heuristic(
        "amount 25k",
        {"title": "Renewal"},
        {"companies": [], "contacts": []},
    )
    assert r["ok"]
    assert r.get("patch", {}).get("amount") == "25000.0"


def test_detail_amount_k_proposes_update():
    r = deals_heuristic(
        "set amount to 15k",
        {"module": "sales", "surface": "detail", "entityId": "d1"},
        catalog={"deals": [{"id": "d1", "title": "Old"}]},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    update = next(p for p in props if p["name"] == "propose_update_deal")
    assert update["args"]["amount"] == "15000.0"


def test_draft_confirm_proposes_create():
    draft = {"title": "Acme deal", "companyId": "c1", "locationId": "l1"}
    r = deal_draft_heuristic("yes", draft, {"companies": [], "contacts": []})
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_create_deal"


def test_sanitize_allows_deal_propose_tools():
    tools = sanitize_tool_proposals(
        [
            {
                "id": "1",
                "name": "propose_create_deal",
                "label": "Create deal",
                "args": {"auto": True},
                "risk": "low",
            },
            {
                "id": "2",
                "name": "propose_update_deal",
                "label": "Update deal",
                "args": {"dealId": "d1", "title": "New", "auto": True},
                "risk": "low",
            },
            {
                "id": "3",
                "name": "propose_delete_deal",
                "label": "Delete deal",
                "args": {"dealId": "d1", "auto": True},
                "risk": "low",
            },
        ],
        "yes",
        "sales",
    )
    assert tools and len(tools) == 3
    assert {t["name"] for t in tools} == {
        "propose_create_deal",
        "propose_update_deal",
        "propose_delete_deal",
    }


def test_detail_field_update_proposes_update():
    r = deals_heuristic(
        "set title as Mega deal",
        {"module": "sales", "surface": "detail", "entityId": "d1"},
        catalog={"deals": [{"id": "d1", "title": "Old"}]},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert any(p["name"] == "propose_update_deal" for p in props)
    update = next(p for p in props if p["name"] == "propose_update_deal")
    assert update["args"]["title"] == "Mega deal"


def test_stage_move_on_detail():
    r = deals_heuristic(
        "move to propose",
        {"module": "sales", "surface": "detail", "entityId": "d1"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_stage_change"
    assert props[0]["args"]["stage"] == "propose"


def test_memory_first_delete_deal_without_this_keyword():
    r = deals_heuristic(
        "get rid of it",
        {"module": "sales", "surface": "detail", "entityId": "d1"},
        catalog={"deals": [{"id": "d1", "title": "Acme Renew"}]},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_delete_deal"
    assert props[0]["args"]["dealId"] == "d1"


def test_fuzzy_resolve_typo_contact_name():
    catalog = {
        "deals": [
            {
                "id": "d1",
                "title": "Enterprise renewal",
                "companyName": "Acme",
                "contactName": "Manoj Kumar",
            },
            {
                "id": "d2",
                "title": "Other",
                "companyName": "Zed",
                "contactName": "Priya",
            },
        ]
    }
    match = resolve_deal_match(catalog, "monaj")
    assert match and match["id"] == "d1"


def test_create_proposal_on_deal_detail_does_not_ask_which_deal():
    catalog = {
        "openDeal": {
            "id": "d1",
            "title": "MICE Global — Divya",
            "contactName": "Divya",
        },
        "deals": [
            {"id": "d1", "title": "MICE Global — Divya", "contactName": "Divya"},
            {"id": "d2", "title": "Acme", "contactName": "A"},
        ],
        "products": [{"id": "p1", "name": "CRM"}],
    }
    r = deals_heuristic(
        "create proposal",
        {"module": "sales", "surface": "detail", "entityId": "d1"},
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "which deal" not in r["assistantText"].lower()
    assert "paperclip" in r["assistantText"].lower() or any(
        p.get("name") == "propose_create_proposal"
        for p in (r.get("toolProposals") or [])
    )


def test_create_proposal_asks_which_deal_when_many():
    catalog = {
        "deals": [
            {"id": "d1", "title": "Acme", "contactName": "A"},
            {"id": "d2", "title": "Zoho", "contactName": "B"},
        ]
    }
    r = deals_heuristic(
        "create proposal",
        {"module": "sales", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "which deal" in r["assistantText"].lower()
    assert "ask again" not in r["assistantText"].lower()
    assert "create the proposal" not in r["assistantText"].lower()
    assert not any(
        p.get("name") == "set_workspace"
        and (p.get("args") or {}).get("mode") == "create"
        for p in (r.get("toolProposals") or [])
    )


def test_create_proposal_deal_pick_continues_conversationally():
    catalog = {
        "deals": [
            {"id": "d1", "title": "Acme Renew", "contactName": "Ada"},
            {"id": "d2", "title": "Zoho", "contactName": "Yaswanth"},
        ],
        "products": [{"id": "p1", "name": "CRM"}],
    }
    r = deals_heuristic(
        "Zoho",
        {"module": "sales", "surface": "list"},
        messages=[
            {"role": "user", "text": "create proposal"},
            {
                "role": "assistant",
                "text": "Sure — which deal is this for? **Acme Renew**, **Zoho**.",
            },
            {"role": "user", "text": "Zoho"},
        ],
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "ask again" not in r["assistantText"].lower()
    assert "paperclip" in r["assistantText"].lower() or "product" in r["assistantText"].lower() or any(
        p.get("name") == "propose_create_proposal"
        for p in (r.get("toolProposals") or [])
    )


def test_create_proposal_uses_sole_deal():
    catalog = {
        "deals": [
            {
                "id": "d1",
                "title": "Zoho — Yaswanth",
                "contactName": "Yaswanth",
                "companyName": "Zoho",
            }
        ],
        "products": [{"id": "p1", "name": "CRM"}],
    }
    r = deals_heuristic(
        "create proposal",
        {"module": "sales", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "product" in r["assistantText"].lower() or "paperclip" in r["assistantText"].lower() or any(
        p.get("name") == "propose_create_proposal"
        for p in (r.get("toolProposals") or [])
    )


def test_create_proposal_on_create_surface_no_duplicate_open():
    r = deals_heuristic(
        "create proposal",
        {"module": "sales", "surface": "create"},
        catalog={"deals": []},
    )
    assert r and r["ok"]
    assert "ask again" not in r["assistantText"].lower()
    assert "company" in r["assistantText"].lower() or "contact" in r["assistantText"].lower()
    assert not (r.get("toolProposals") or [])


def test_create_proposal_empty_catalog_omits_bare_seed():
    r = deals_heuristic(
        "create proposal",
        {"module": "sales", "surface": "list"},
        catalog={"deals": []},
    )
    assert r and r["ok"]
    assert "create the proposal" not in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    args = props[0].get("args") or {}
    assert "seedPrompt" not in args
    assert args.get("afterCreate") == "proposal"


def test_create_proposal_this_customer_not_fake_topic():
    from app.agents.deal_coworker_agent import extract_proposal_topic

    assert extract_proposal_topic("Create a proposal for this customer") is None


def test_create_proposal_fuzzy_contact_typo():
    catalog = {
        "deals": [
            {
                "id": "d1",
                "title": "Enterprise renewal",
                "companyName": "Acme",
                "contactName": "Manoj Kumar",
            }
        ]
    }
    r = deals_heuristic(
        "create proposal for monaj",
        {"module": "sales", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(p.get("name") == "propose_create_proposal" for p in props)
    assert "paperclip" in r["assistantText"].lower()
    assert "enter" in r["assistantText"].lower()


def test_create_proposal_asks_product_when_catalog_has_products():
    catalog = {
        "deals": [
            {
                "id": "d1",
                "title": "Acme deal",
                "companyName": "Acme",
                "contactName": "Manoj Kumar",
            }
        ],
        "products": [
            {"id": "p1", "name": "CCaaS Voice"},
            {"id": "p2", "name": "Ticketing System"},
        ],
    }
    r = deals_heuristic(
        "create proposal for manoj",
        {"module": "sales", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "which" in r["assistantText"].lower() or "paperclip" in r["assistantText"].lower()
    assert not r.get("toolProposals")


def test_create_proposal_ticketing_scopes_product():
    catalog = {
        "deals": [
            {
                "id": "d1",
                "title": "Acme deal",
                "companyName": "Acme",
                "contactName": "Manoj Kumar",
            }
        ],
        "products": [
            {"id": "p1", "name": "CCaaS Voice"},
            {"id": "p2", "name": "Ticketing System"},
        ],
    }
    r = deals_heuristic(
        "create proposal for manoj for ticketing system",
        {"module": "sales", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(p.get("name") == "propose_create_proposal" for p in props)
    assert "paperclip" in r["assistantText"].lower()


def test_create_proposal_product_reply_after_ask():
    catalog = {
        "deals": [
            {
                "id": "d1",
                "title": "Acme deal",
                "companyName": "Acme",
                "contactName": "Manoj Kumar",
            }
        ],
        "products": [
            {"id": "p1", "name": "CCaaS Voice"},
            {"id": "p2", "name": "Ticketing System"},
        ],
    }
    messages = [
        {"role": "user", "text": "create proposal for manoj"},
        {
            "role": "assistant",
            "text": (
                "Before I create a proposal for **Manoj**, which **product or "
                "products** should it cover? Available products: **CCaaS Voice**, "
                "**Ticketing System**."
            ),
        },
    ]
    r = deals_heuristic(
        "ticketing",
        {"module": "sales", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(p.get("name") == "propose_create_proposal" for p in props)
    assert "paperclip" in r["assistantText"].lower()


def test_yes_after_proposal_offer_does_not_navigate():
    messages = [
        {"role": "user", "text": "create proposal for manoj"},
        {
            "role": "assistant",
            "text": (
                "Found **Opportunity — manoj Sharma** — I'll create a customer "
                "proposal from your active template."
            ),
        },
    ]
    r = deals_heuristic(
        "yes",
        {"module": "sales", "surface": "list"},
        messages=messages,
        catalog={"deals": []},
    )
    assert r and r["ok"]
    assert "finishing the proposal" in r["assistantText"].lower()
    assert not r.get("toolProposals")

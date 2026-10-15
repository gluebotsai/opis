"""Conversational CRUD through chat — create collects slots, update/delete stay human."""

from __future__ import annotations

from app.agents.company_coworker_agent import companies_heuristic
from app.agents.contact_coworker_agent import contacts_heuristic
from app.agents.coworker_shared import (
    is_generic_coworker_speech,
    should_commit_native_turn,
)
from app.agents.crm_agent import resolve_create_navigate
from app.agents.crm_tools import map_tool_calls_to_result
from app.agents.deal_coworker_agent import deals_heuristic
from app.agents.link_module_coworker_agent import heuristic as link_heuristic
from app.agents.product_coworker_agent import products_heuristic
from app.agents.proposal_coworker_agent import handle as proposal_handle
import asyncio
from unittest.mock import patch


def test_generic_speech_detected() -> None:
    assert is_generic_coworker_speech("Okay.")
    assert is_generic_coworker_speech("What would you like to do next?")
    assert is_generic_coworker_speech("Happy to help — what would you like to do next?")
    assert is_generic_coworker_speech(
        "Nice — I'll open create and pull in what you shared."
    )
    assert not is_generic_coworker_speech(
        "Thanks. What's the best email for Yaswanth?"
    )


def test_do_not_commit_speech_only_on_bare_email() -> None:
    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "Thanks! Could you please provide the primary phone number?",
        },
        user_text="yaswanthguna2001@gmail.com",
    )
    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "Got the email — what's their phone?",
            "toolProposals": [
                {"name": "set_workspace", "args": {"mode": "create", "auto": True}}
            ],
        },
        user_text="yaswanthguna2001@gmail.com",
    )
    assert should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "Thanks — email saved. What's their phone?",
            "patch": {"email": "yaswanthguna2001@gmail.com"},
        },
        user_text="yaswanthguna2001@gmail.com",
    )


def test_do_not_commit_speech_only_on_field_assignment() -> None:
    """Regression: 'city as X' has no edit verb — must not accept create-draft chat."""
    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "Got it, Namakkal is noted. And what's the first name?",
        },
        user_text="city as namakkal",
    )


def test_do_not_commit_workspace_only_on_field_assignment() -> None:
    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "Got it — Namakkal. And what's the first name?",
            "toolProposals": [
                {"name": "set_workspace", "args": {"mode": "create", "auto": True}}
            ],
        },
        user_text="city as Namakkal",
    )


def test_commit_draft_patch_on_labeled_create_dump() -> None:
    """Regression: 'title = Developer' must not discard patch_contact_draft."""
    user = (
        "yaswanth M G, yaswanthmg1@gmail.com, company = Netflix, title = Developer"
    )
    assert should_commit_native_turn(
        {
            "ok": True,
            "assistantText": (
                "Got it — creating a new contact for Yaswanth M G from Netflix "
                "with the Developer title. Ready to save when you are!"
            ),
            "patch": {
                "firstName": "Yaswanth",
                "lastName": "M G",
                "email": "yaswanthmg1@gmail.com",
                "companyName": "Netflix",
                "title": "Developer",
            },
            "toolProposals": [
                {"name": "set_workspace", "args": {"mode": "create", "auto": True}}
            ],
        },
        user_text=user,
    )
    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": (
                "Got it — creating a new contact for Yaswanth M G from Netflix "
                "with the Developer title."
            ),
            "toolProposals": [
                {"name": "set_workspace", "args": {"mode": "create", "auto": True}}
            ],
        },
        user_text=user,
    )


def test_do_not_commit_list_search_when_updating_open_contact() -> None:
    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "I'll search for their email.",
            "toolProposals": [
                {
                    "name": "set_workspace",
                    "args": {"mode": "list", "search": "their email", "auto": True},
                }
            ],
        },
        user_text="change their email to priya.test@example.com",
    )


def test_do_not_commit_generic_native_on_create() -> None:
    assert not should_commit_native_turn(
        {"ok": True, "assistantText": "What would you like to do next?"},
        user_text="Help me create a new contact",
    )
    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "I'll open create and pull in what you shared.",
            "toolProposals": [
                {"name": "set_workspace", "args": {"mode": "create", "auto": True}}
            ],
        },
        user_text="create contact",
    )
    assert should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "Thanks. What's the best email for Yaswanth?",
            "patch": {"firstName": "Yaswanth", "lastName": "M G"},
        },
        user_text="yaswanth M G",
    )
    assert should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "",
            "patch": {"firstName": "Sivaji", "lastName": "R"},
        },
        user_text="sivaji R",
    )
    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": (
                "To send this quote, I need to make sure it's tied to the right "
                "deal. Is this for the Zendesk deal or the Zoho expansion deal?"
            ),
        },
        user_text="ok fine . send this",
    )


def test_help_me_create_contact_opens_and_asks_name() -> None:
    r = resolve_create_navigate(
        "Help me create a new contact", "contact", "/contact"
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "create"
    lower = r["assistantText"].lower()
    assert "what would you like to do next" not in lower
    assert "okay." not in lower
    assert "open create" not in lower
    assert "pull in" not in lower
    assert "how many" not in lower
    assert "name" in lower
    assert (r.get("sessionMemoryPatch") or {}).get("pendingAsk") != "contact_count"


def test_company_rename_extracts_value_not_instruction() -> None:
    from app.agents.draft_conversation import (
        company_field_change_without_value,
        parse_company_field_update,
        parse_contact_field_update,
        sanitize_company_update_name,
    )

    assert parse_company_field_update("rename the company name to Red Bull") == {
        "name": "Red Bull"
    }
    assert parse_company_field_update("set company name to Acme Corp") == {
        "name": "Acme Corp"
    }
    assert parse_company_field_update("rename the company name") is None
    assert company_field_change_without_value("rename the company name") == "name"
    # Guard: instruction-shaped junk never becomes a company name
    assert sanitize_company_update_name("the company name to Red Bull") == "Red Bull"
    assert sanitize_company_update_name("rename the company name") is None
    assert sanitize_company_update_name("Red Bull") == "Red Bull"
    # "last name" must never become a company rename
    assert parse_company_field_update("update last name as guna") is None
    assert parse_contact_field_update("update last name as guna") == {
        "lastName": "guna"
    }
    assert parse_contact_field_update("update first name as Divya") == {
        "firstName": "Divya"
    }


def test_create_typo_is_not_rich_and_never_narrates_workspace() -> None:
    from app.agents.draft_conversation import (
        next_contact_prompt,
        utterance_has_details,
    )

    assert not utterance_has_details("create cotact")
    assert not utterance_has_details("Help me create a new contact")
    assert utterance_has_details("create contact yaswanth")

    start = contacts_heuristic(
        "create cotact",
        {"module": "contact", "surface": "list"},
    )
    assert start and start["ok"]
    lower = start["assistantText"].lower()
    assert "open create" not in lower
    assert "pull in" not in lower
    assert "how many" not in lower
    assert "name" in lower
    assert not (start.get("toolProposals") or [])[0]["args"].get("seedPrompt")

    assert "name" in next_contact_prompt({}).lower()
    assert "thank you" in next_contact_prompt({"firstName": "Yaswanth"}).lower()
    assert "last name" in next_contact_prompt({"firstName": "Yaswanth"}).lower()
    email_q = next_contact_prompt({"firstName": "Yaswanth", "lastName": "M G"})
    assert "email" in email_q.lower()
    phone_q = next_contact_prompt(
        {"firstName": "Yaswanth", "lastName": "M G", "email": "y@x.com"}
    )
    assert "phone" in phone_q.lower()
    assert "country code" in phone_q.lower()


def test_contact_create_then_name_then_email_then_save_offer() -> None:
    start = contacts_heuristic(
        "Help me create a new contact",
        {"module": "contact", "surface": "list"},
    )
    assert start and start["ok"]
    assert (start.get("toolProposals") or [])[0]["args"]["mode"] == "create"
    assert "open create" not in start["assistantText"].lower()
    assert "how many" not in start["assistantText"].lower()
    assert "name" in start["assistantText"].lower()

    name = map_tool_calls_to_result(
        None,
        [
            {
                "function": {
                    "name": "patch_contact_draft",
                    "arguments": {"firstName": "Yaswanth", "lastName": "M G"},
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="yaswanth M G",
        current_draft={},
    )
    assert name["ok"]
    assert name.get("patch", {}).get("firstName") == "Yaswanth"
    assert not (name.get("assistantText") or "").strip()

    email = map_tool_calls_to_result(
        "Okay.",
        [
            {
                "function": {
                    "name": "patch_contact_draft",
                    "arguments": {"email": "manojnlp04@gmail.com"},
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="manojnlp04@gmail.com",
        current_draft={"firstName": "Yaswanth", "lastName": "M G"},
    )
    assert email["ok"]
    assert email.get("patch", {}).get("email") == "manojnlp04@gmail.com"
    assert not (email.get("assistantText") or "").strip()


def test_contact_update_and_delete_stay_conversational() -> None:
    catalog = {
        "openContact": {"id": "c1", "displayName": "Priya Nair", "email": "p@x.com"},
        "contacts": [{"id": "c1", "displayName": "Priya Nair", "email": "p@x.com"}],
    }
    upd = contacts_heuristic(
        "change their email to priya.test@example.com",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        catalog=catalog,
    )
    assert upd and upd["ok"]
    assert "priya" in upd["assistantText"].lower() or "email" in upd["assistantText"].lower()
    props = upd.get("toolProposals") or []
    assert any(p["name"] == "propose_update_contact" for p in props)
    update = next(p for p in props if p["name"] == "propose_update_contact")
    assert update["args"]["contactId"] == "c1"
    assert update["args"]["email"] == "priya.test@example.com"

    delete = contacts_heuristic(
        "delete this contact",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        catalog=catalog,
    )
    assert delete and delete["ok"]
    dprops = delete.get("toolProposals") or []
    assert dprops and dprops[0]["name"] == "propose_delete_contact"


def test_deal_company_product_create_asks_first_slot() -> None:
    deal = deals_heuristic(
        "Help me create a new deal",
        {"module": "sales", "surface": "list"},
    )
    assert deal and deal["ok"]
    assert (deal.get("toolProposals") or [])[0]["args"]["mode"] == "create"
    assert "open create" not in deal["assistantText"].lower()
    assert "deal" in deal["assistantText"].lower() or "call" in deal["assistantText"].lower()

    company = companies_heuristic(
        "Help me create a new company",
        {"module": "company", "surface": "list"},
    )
    assert company and company["ok"]
    assert (company.get("toolProposals") or [])[0]["args"]["mode"] == "create"
    assert "company" in company["assistantText"].lower()

    product = products_heuristic(
        "Help me create a new product",
        {"module": "product", "surface": "list"},
    )
    assert product and product["ok"]
    assert (product.get("toolProposals") or [])[0]["args"]["mode"] == "create"
    assert "product" in product["assistantText"].lower()


def test_quote_invoice_activity_create_asks_first_slot() -> None:
    quote = link_heuristic(
        kind="quotes",
        text="Help me create a new quote",
        context={"module": "quotes", "surface": "list"},
        catalog={"deals": [{"id": "d1", "title": "Acme"}], "products": []},
    )
    assert quote and quote.get("ok")
    props = quote.get("toolProposals") or []
    assert any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    ) or "deal" in (quote.get("assistantText") or "").lower()

    invoice = link_heuristic(
        kind="finance",
        text="Help me create a new invoice",
        context={"module": "finance", "surface": "list"},
        catalog={"deals": [{"id": "d1", "title": "Acme"}]},
    )
    assert invoice and invoice.get("ok")
    assert "deal" in (invoice.get("assistantText") or "").lower() or any(
        (p.get("args") or {}).get("mode") == "create"
        for p in (invoice.get("toolProposals") or [])
    )

    activity = link_heuristic(
        kind="activities",
        text="Help me log an activity",
        context={"module": "activities", "surface": "list"},
        catalog={"contacts": [{"id": "c1", "displayName": "Priya"}]},
    )
    assert activity and activity.get("ok")
    assert "who" in (activity.get("assistantText") or "").lower() or any(
        (p.get("args") or {}).get("mode") == "create"
        for p in (activity.get("toolProposals") or [])
    )


def test_deal_update_delete_on_detail() -> None:
    catalog = {
        "openDeal": {"id": "d1", "title": "Acme rollout", "stage": "discover"},
        "deals": [{"id": "d1", "title": "Acme rollout", "stage": "discover"}],
    }
    upd = deals_heuristic(
        "rename this to Acme expansion",
        {"module": "sales", "surface": "detail", "entityId": "d1"},
        catalog=catalog,
    )
    assert upd and upd["ok"]
    props = upd.get("toolProposals") or []
    assert any(
        p["name"] in ("propose_update_deal", "set_workspace") for p in props
    ) or "acme" in upd["assistantText"].lower()

    delete = deals_heuristic(
        "delete this deal",
        {"module": "sales", "surface": "detail", "entityId": "d1"},
        catalog=catalog,
    )
    assert delete and delete["ok"]
    dprops = delete.get("toolProposals") or []
    assert any(p["name"] == "propose_delete_deal" for p in dprops)


def test_quote_update_delete_on_detail() -> None:
    catalog = {
        "openQuote": {
            "id": "q1",
            "number": "Q-1001",
            "dealTitle": "Zoho expansion",
            "notes": None,
        },
        "quotes": [
            {"id": "q1", "number": "Q-1001", "dealTitle": "Zoho expansion"}
        ],
        "products": [
            {"id": "p-crm", "name": "AI Native CRM"},
            {"id": "p-tick", "name": "AI Native Ticketing System"},
        ],
    }
    upd = link_heuristic(
        kind="quotes",
        text="change the notes to Net 30",
        context={"module": "quotes", "surface": "detail", "entityId": "q1"},
        catalog=catalog,
    )
    assert upd and upd["ok"]
    props = upd.get("toolProposals") or []
    assert any(p["name"] == "propose_update_quote" for p in props)
    update = next(p for p in props if p["name"] == "propose_update_quote")
    assert update["args"]["quoteId"] == "q1"
    assert update["args"]["notes"] == "Net 30"

    lines = link_heuristic(
        kind="quotes",
        text="update product as crm+ticketing quantity 1 and no discount as separate line items",
        context={"module": "quotes", "surface": "detail", "entityId": "q1"},
        catalog=catalog,
    )
    assert lines and lines["ok"]
    lprops = lines.get("toolProposals") or []
    assert any(p["name"] == "propose_update_quote" for p in lprops)
    line_update = next(p for p in lprops if p["name"] == "propose_update_quote")
    assert line_update["args"]["quoteId"] == "q1"
    assert line_update["args"]["discountPct"] == 0
    product_ids = {row["productId"] for row in line_update["args"]["lines"]}
    assert product_ids == {"p-crm", "p-tick"}
    assert all(row["quantity"] == 1 for row in line_update["args"]["lines"])

    delete = link_heuristic(
        kind="quotes",
        text="delete this quote",
        context={"module": "quotes", "surface": "detail", "entityId": "q1"},
        catalog=catalog,
    )
    assert delete and delete["ok"]
    dprops = delete.get("toolProposals") or []
    assert any(p["name"] == "propose_delete_quote" for p in dprops)

    send = link_heuristic(
        kind="quotes",
        text="ok fine. send this",
        context={"module": "quotes", "surface": "detail", "entityId": "q1"},
        catalog=catalog,
    )
    assert send and send["ok"]
    sprops = send.get("toolProposals") or []
    assert any(p["name"] == "propose_send_quote" for p in sprops)
    send_tool = next(p for p in sprops if p["name"] == "propose_send_quote")
    assert send_tool["args"]["quoteId"] == "q1"
    lower_send = send["assistantText"].lower()
    assert "zoho" in lower_send or "q-1001" in lower_send
    assert "which deal" not in lower_send


def test_invoice_update_delete_and_mark_paid_on_detail() -> None:
    catalog = {
        "openInvoice": {
            "id": "inv1",
            "number": "INV-1001",
            "dealTitle": "Zoho expansion",
            "status": "draft",
        },
        "invoices": [
            {"id": "inv1", "number": "INV-1001", "dealTitle": "Zoho expansion"}
        ],
        "products": [
            {"id": "p-crm", "name": "CRM"},
            {"id": "p-tick", "name": "Ticketing"},
        ],
    }
    upd = link_heuristic(
        kind="finance",
        text="change the notes to Due on receipt",
        context={"module": "finance", "surface": "detail", "entityId": "inv1"},
        catalog=catalog,
    )
    assert upd and upd["ok"]
    props = upd.get("toolProposals") or []
    assert any(p["name"] == "propose_update_invoice" for p in props)
    update = next(p for p in props if p["name"] == "propose_update_invoice")
    assert update["args"]["invoiceId"] == "inv1"
    assert "Due on receipt" in update["args"]["notes"]

    lines = link_heuristic(
        kind="finance",
        text="update product as crm+ticketing quantity 1 and no discount as separate line items",
        context={"module": "finance", "surface": "detail", "entityId": "inv1"},
        catalog=catalog,
    )
    assert lines and lines["ok"]
    lprops = lines.get("toolProposals") or []
    assert any(p["name"] == "propose_update_invoice" for p in lprops)
    line_update = next(p for p in lprops if p["name"] == "propose_update_invoice")
    assert line_update["args"]["invoiceId"] == "inv1"
    assert line_update["args"]["discountPct"] == 0
    product_ids = {row["productId"] for row in line_update["args"]["lines"]}
    assert product_ids == {"p-crm", "p-tick"}

    send = link_heuristic(
        kind="finance",
        text="ok fine. send this",
        context={"module": "finance", "surface": "detail", "entityId": "inv1"},
        catalog=catalog,
    )
    assert send and send["ok"]
    sprops = send.get("toolProposals") or []
    assert any(p["name"] == "propose_send_invoice" for p in sprops)
    send_tool = next(p for p in sprops if p["name"] == "propose_send_invoice")
    assert send_tool["args"]["invoiceId"] == "inv1"
    lower_send = send["assistantText"].lower()
    assert "zoho" in lower_send or "inv-1001" in lower_send
    assert "which deal" not in lower_send

    paid = link_heuristic(
        kind="finance",
        text="mark this invoice as paid",
        context={"module": "finance", "surface": "detail", "entityId": "inv1"},
        catalog=catalog,
    )
    assert paid and paid["ok"]
    pprops = paid.get("toolProposals") or []
    assert any(p["name"] == "propose_mark_invoice_paid" for p in pprops)

    delete = link_heuristic(
        kind="finance",
        text="delete this invoice",
        context={"module": "finance", "surface": "detail", "entityId": "inv1"},
        catalog=catalog,
    )
    assert delete and delete["ok"]
    dprops = delete.get("toolProposals") or []
    assert any(p["name"] == "propose_delete_invoice" for p in dprops)


def test_proposal_delete_on_detail() -> None:
    from unittest.mock import AsyncMock

    state = {
        "messages": [{"role": "user", "text": "delete this proposal"}],
        "context": {
            "entityId": "prop1",
            "pathname": "/sales/proposals/prop1",
            "surface": "detail",
        },
        "catalog": {
            "openProposal": {
                "id": "prop1",
                "dealId": "deal1",
                "number": "P-F4CAFF28",
                "dealTitle": "Zendesk expansion",
            }
        },
    }
    native_result = {
        "ok": True,
        "assistantText": "I'll delete the proposal P-F4CAFF28 for Zendesk expansion.",
        "toolProposals": [
            {"name": "propose_delete_proposal", "args": {"proposalId": "prop1"}},
        ],
    }
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.crm_tools.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=native_result,
        ),
    ):
        out = asyncio.run(proposal_handle(state))
    r = out["result"]
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(p["name"] == "propose_delete_proposal" for p in props)
    delete = next(p for p in props if p["name"] == "propose_delete_proposal")
    assert delete["args"]["proposalId"] == "prop1"


def test_proposal_send_and_product_update_on_detail() -> None:
    from unittest.mock import AsyncMock

    catalog = {
        "openProposal": {
            "id": "prop1",
            "dealId": "deal1",
            "number": "P-F4CAFF28",
            "dealTitle": "Zendesk expansion",
        },
        "products": [
            {"id": "p-crm", "name": "CRM"},
            {"id": "p-tick", "name": "Ticketing"},
        ],
    }
    ctx = {
        "entityId": "prop1",
        "pathname": "/sales/proposals/prop1",
        "surface": "detail",
    }
    send_native = {
        "ok": True,
        "assistantText": "Sending proposal P-F4CAFF28 for Zendesk expansion.",
        "toolProposals": [
            {"name": "propose_send_proposal", "args": {"proposalId": "prop1"}},
        ],
    }
    lines_native = {
        "ok": True,
        "assistantText": "Updating products to CRM + Ticketing.",
        "toolProposals": [
            {
                "name": "propose_personalize_proposal",
                "args": {"proposalId": "prop1", "productIds": ["p-crm", "p-tick"]},
            },
        ],
    }
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.crm_tools.run_native_agent_turn",
            new_callable=AsyncMock,
            side_effect=[send_native, lines_native],
        ),
    ):
        send = asyncio.run(
            proposal_handle(
                {
                    "messages": [{"role": "user", "text": "ok fine. send this"}],
                    "context": ctx,
                    "catalog": catalog,
                }
            )
        )["result"]
        lines = asyncio.run(
            proposal_handle(
                {
                    "messages": [
                        {
                            "role": "user",
                            "text": (
                                "update product as crm+ticketing quantity 1 "
                                "as separate line items"
                            ),
                        }
                    ],
                    "context": ctx,
                    "catalog": catalog,
                }
            )
        )["result"]
    assert send["ok"]
    sprops = send.get("toolProposals") or []
    assert any(p["name"] == "propose_send_proposal" for p in sprops)
    send_tool = next(p for p in sprops if p["name"] == "propose_send_proposal")
    assert send_tool["args"]["proposalId"] == "prop1"
    lower_send = str(send.get("assistantText") or "").lower()
    assert "zendesk" in lower_send or "p-f4caff28" in lower_send
    assert "which deal" not in lower_send

    assert lines["ok"]
    lprops = lines.get("toolProposals") or []
    assert any(p["name"] == "propose_personalize_proposal" for p in lprops)
    update = next(p for p in lprops if p["name"] == "propose_personalize_proposal")
    assert update["args"]["proposalId"] == "prop1"
    assert set(update["args"]["productIds"]) == {"p-crm", "p-tick"}

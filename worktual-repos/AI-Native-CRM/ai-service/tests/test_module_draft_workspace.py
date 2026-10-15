"""Cross-module draft chat: heuristic fill + workspace fields (parity with contact)."""

from __future__ import annotations

import pytest

from app.agents.company_draft_agent import (
    company_heuristic,
    enrich_company_draft_result,
    sanitize_company,
)
from app.agents.coworker_shared import (
    enrich_draft_result,
    merge_llm_and_heuristic_patch,
    sanitize_assistant_text_for_user,
)
from app.agents.deal_draft_agent import (
    enrich_deal_draft_result,
    heuristic as deal_heuristic,
    sanitize_patch as sanitize_deal,
)
from app.agents.misc_draft_agents import (
    activity_heuristic,
    enrich_activity_draft_result,
    enrich_invoice_draft_result,
    enrich_product_draft_result,
    invoice_heuristic,
    product_heuristic,
    quote_heuristic,
    sanitize_product,
)
from app.agents.draft_conversation import merge_draft, next_product_prompt
from app.mcp.dispatch import dispatch
from app.mcp.server import begin_agent_mcp_context, end_agent_mcp_context
from app.mcp.context import reset_ctx


def test_hyphen_strip_is_shared():
    assert sanitize_assistant_text_for_user("- Got it — amount added.") == (
        "Got it — amount added."
    )


def test_merge_llm_wins_heuristic_fills_gaps():
    merged = merge_llm_and_heuristic_patch(
        {"title": "Acme expansion", "amount": ""},
        {"title": "ignored", "amount": "5000", "notes": "Q4"},
    )
    assert merged["title"] == "Acme expansion"
    assert merged["amount"] == "5000"
    assert merged["notes"] == "Q4"


def test_enrich_draft_result_strips_bullet_and_keeps_llm_patch_only():
    out = enrich_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "- Noted the amount.",
            "patch": {"title": "Expansion"},
        },
        heur_result={"patch": {"amount": "12000"}},
    )
    assert out["assistantText"] == "Noted the amount."
    assert out["patch"]["title"] == "Expansion"
    assert "amount" not in out["patch"]


def test_company_heuristic_address_industry_linkedin():
    r = company_heuristic(
        "12 MG Road, Bengaluru",
        {"name": "OvalEdge", "locationName": "Bengaluru"},
    )
    assert r["patch"]["locationAddress"].startswith("12 MG")

    r2 = company_heuristic(
        "SaaS",
        {"name": "OvalEdge", "locationName": "Bengaluru", "locationAddress": "12 MG"},
    )
    assert r2["patch"]["industry"] == "SaaS"

    r3 = company_heuristic(
        "linkedin.com/company/ovaledge",
        {"name": "OvalEdge", "locationName": "HQ"},
    )
    assert "linkedin.com/company/ovaledge" in r3["patch"]["linkedinUrl"]


def test_company_sanitize_maps_address_alias():
    clean = sanitize_company({"name": "Acme", "address": "1 Main St"})
    assert clean["locationAddress"] == "1 Main St"


def test_clamp_company_patch_blocks_address_on_location_turn():
    from app.agents.draft_conversation import clamp_company_patch_to_walk

    raw = {"locationName": "Chennai", "locationAddress": "Chennai", "domain": "x.com"}
    clean = clamp_company_patch_to_walk(
        raw,
        ask="locationName",
    )
    assert clean.get("locationName") == "Chennai"
    assert "locationAddress" not in clean
    assert "domain" not in clean


def test_enrich_company_chennai_only_sets_location_name():
    out = enrich_company_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "Chennai noted.",
            "patch": {"locationName": "Chennai", "locationAddress": "Chennai"},
        },
        user_text="chennai",
        draft={"name": "Lyca"},
    )
    patch = out.get("patch") or {}
    assert str(patch.get("locationName") or "").lower() == "chennai"
    assert patch.get("locationAddress", "") in ("", None)
    speech = (out.get("assistantText") or "").lower()
    assert "address" in speech or "street" in speech


def test_company_city_only_does_not_duplicate_address():
    out = enrich_company_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "Keeping it at city level.",
            "patch": {"locationAddress": "Chennai"},
        },
        user_text="city",
        draft={"name": "Lyca", "locationName": "Chennai"},
    )
    patch = out.get("patch") or {}
    assert patch.get("locationAddress", "") in ("", None)
    assert "locationAddress" in (patch.get("skippedOptional") or "")


def test_enrich_company_fills_location_from_city():
    out = enrich_company_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "- Got it — Mumbai it is.",
            "patch": {"name": "OvalEdge"},
        },
        user_text="Mumbai",
        draft={"name": "OvalEdge"},
    )
    assert out["patch"]["name"] == "OvalEdge"
    assert out["patch"]["locationName"] == "Mumbai"
    speech = (out.get("assistantText") or "").lower()
    assert (
        "address" in speech
        or "location type" in speech
        or "domain" in speech
        or "everything on my list" in speech
    )
    assert not out["assistantText"].startswith("-")


def test_native_company_city_lands_on_location_name():
    from app.agents.crm_agent import bind_native_company_create

    messages = [
        {"role": "user", "text": "create company"},
        {"role": "assistant", "text": "What's the name of the company?"},
        {"role": "user", "text": "Lyca"},
        {
            "role": "assistant",
            "text": "Great, Lyca it is. Where is the company located — which city?",
        },
        {"role": "user", "text": "chennai"},
    ]
    out = bind_native_company_create(
        {
            "ok": True,
            "assistantText": (
                "Noted — Lyca in Chennai. What type of location is it — "
                "headquarters, office, or branch?"
            ),
        },
        messages=messages,
        context={"module": "company", "surface": "create", "draft": {"name": "Lyca"}},
        catalog={},
        session_memory={"pendingIntent": "create_company", "slots": {"createModule": "company"}},
    )
    patch = (out or {}).get("patch") or {}
    assert patch.get("locationName") == "chennai"
    speech = ((out or {}).get("assistantText") or "").lower()
    assert "address" in speech or "street" in speech
    tools = (out or {}).get("toolProposals") or []
    assert any(
        t.get("name") == "set_workspace" and (t.get("args") or {}).get("mode") == "create"
        for t in tools
    )


def test_create_company_opens_setup_without_using_the_command_as_the_name():
    from app.agents.crm_agent import bind_native_company_create

    out = bind_native_company_create(
        {
            "ok": True,
            "assistantText": "I'd be happy to help you add a new company. What's the name of the company?",
        },
        messages=[{"role": "user", "text": "create company"}],
        context={"module": "company", "surface": "list", "draft": {}},
        catalog={},
        session_memory={},
    )
    assert not (out or {}).get("patch")
    tools = (out or {}).get("toolProposals") or []
    assert any(
        t.get("name") == "set_workspace" and (t.get("args") or {}).get("mode") == "create"
        for t in tools
    )


def test_deal_heuristic_typed_company_and_amount():
    catalog = {"companies": [], "contacts": []}
    r = deal_heuristic("Acme Corp", {"title": "Expansion"}, catalog)
    assert r["patch"]["companyName"] == "Acme Corp"

    r2 = deal_heuristic(
        "$12,000",
        {"title": "Expansion", "companyName": "Acme Corp"},
        catalog,
    )
    assert r2["patch"]["amount"] == "12000"


def test_deal_sanitize_keeps_notes_close_date_company_name():
    clean = sanitize_deal(
        {
            "title": "Expansion",
            "companyName": "Acme",
            "notes": "Q4 close",
            "expectedCloseDate": "2026-09-30",
        },
        {"companies": [], "contacts": []},
    )
    assert clean["companyName"] == "Acme"
    assert clean["notes"] == "Q4 close"
    assert clean["expectedCloseDate"] == "2026-09-30"


def test_deal_sanitize_maps_proposal_stage_to_propose():
    from app.agents.deal_draft_agent import normalize_deal_stage

    assert normalize_deal_stage("proposal") == "propose"
    assert normalize_deal_stage("Propose") == "propose"
    assert normalize_deal_stage("qualified") == "qualification"
    clean = sanitize_deal(
        {"stage": "proposal"},
        {"companies": [], "contacts": []},
    )
    assert clean["stage"] == "propose"


def test_enrich_deal_fills_amount_from_user_text():
    out = enrich_deal_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "- Amount noted.",
            "patch": {"title": "Expansion"},
        },
        user_text="$9,500",
        draft={"title": "Expansion", "companyName": "Acme"},
        catalog={"companies": [], "contacts": []},
    )
    assert out["patch"]["amount"] == "9500"
    speech = (out.get("assistantText") or "").lower()
    assert "save" in speech or "stage" in speech
    assert not speech.startswith("-")


def test_product_heuristic_bare_price_sku_brand():
    r = product_heuristic("99", {"name": "Pro Plan"})
    assert r["patch"]["price"] == "99"
    r2 = product_heuristic("SKU-1", {"name": "Pro Plan", "price": "99"})
    assert r2["patch"]["sku"] == "SKU-1"
    r3 = product_heuristic(
        "brand is Contoso",
        {"name": "Pro Plan", "sku": "SKU-1", "price": "99"},
    )
    assert r3["patch"]["brand"] == "Contoso"


def test_enrich_product_does_not_fill_when_llm_omits_patch():
    out = enrich_product_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "- Price saved.",
            "patch": {"name": "Pro Plan"},
        },
        user_text="$49",
        draft={"name": "Pro Plan"},
    )
    # Next slot is SKU — "$49" is not a valid SKU, so price must not be invented.
    assert "price" not in (out.get("patch") or {})
    assert "sku" in (out.get("assistantText") or "").lower()


def test_enrich_product_blocks_premature_save_after_price():
    out = enrich_product_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "Got it, 35000 is set. Ready to save your AI native CRM?",
            "patch": {"price": "35000"},
        },
        user_text="35000",
        draft={"name": "AI native CRM", "sku": "CRM-1"},
    )
    assert out["patch"]["price"] == "35000"
    speech = (out.get("assistantText") or "").lower()
    assert "currency" in speech
    assert "ready to save" not in speech


def test_enrich_product_never_asks_save_mid_walk():
    """Mandatory ready is not enough for the agent to solicit save."""
    out = enrich_product_draft_result(
        {
            "ok": True,
            "assistantText": "Got it, CRM is set as a standard product. Ready to save it?",
            "patch": {"productType": "fixed"},
        },
        user_text="standard",
        draft={
            "name": "CRM",
            "sku": "crm-1",
            "price": "35000",
            "currency": "INR",
        },
    )
    speech = (out.get("assistantText") or "").lower()
    assert "ready to save" not in speech
    assert "shall i save" not in speech
    assert "one-time" in speech or "recurring" in speech or "billing" in speech


def test_enrich_product_clamps_ahead_of_walk_patches():
    """LLM must not mark billing/description done while Product type is still open."""
    out = enrich_product_draft_result(
        {
            "ok": True,
            "assistantText": "Description added. Category or tags?",
            "patch": {
                "billingType": "one_time",
                "description": "customer relation management",
                "productType": "fixed",
            },
        },
        user_text="fixed",
        draft={
            "name": "CRM",
            "sku": "crm-1",
            "price": "35000",
            "currency": "INR",
        },
    )
    patch = out.get("patch") or {}
    assert patch.get("productType") == "fixed"
    assert "billingType" not in patch
    assert "description" not in patch
    speech = (out.get("assistantText") or "").lower()
    assert "description" not in speech
    assert "one-time" in speech or "recurring" in speech


def test_enrich_product_meta_question_does_not_fill_brand():
    draft = {
        "name": "CRM",
        "sku": "crm-1",
        "price": "35000",
        "currency": "INR",
        "productType": "fixed",
        "billingType": "one_time",
        "maxDiscountPercent": "15",
    }
    out = enrich_product_draft_result(
        {
            "ok": True,
            "assistantText": "Stock on hand?",
            "patch": {"brand": "brand means?"},
        },
        user_text="brand means?",
        draft=draft,
        business_type="b2c",
    )
    assert not (out.get("patch") or {}).get("brand")
    speech = (out.get("assistantText") or "").lower()
    assert "maker" in speech or "label" in speech or "brand" in speech
    assert "stock" not in speech
    # Still asking for brand
    assert "brand" in speech and "skip" in speech


def test_enrich_product_user_can_save_when_mandatory_ready():
    out = enrich_product_draft_result(
        {
            "ok": True,
            "assistantText": "Saving now.",
            "patch": {},
        },
        user_text="save it",
        draft={"name": "CRM", "sku": "crm-1", "price": "35000"},
    )
    # User-initiated save keeps speech (does not force the next field question).
    assert out.get("assistantText") == "Saving now."


def test_product_create_chat_workspace_lockstep_e2e():
    """ind / standard / skip must patch the draft and keep chat on the guided slot."""
    from app.agents.draft_conversation import product_next_ask_key

    draft: dict = {}
    turns = [
        ("AI native CRM", "name", "AI native CRM"),
        ("crm-1", "sku", "crm-1"),
        ("35000", "price", "35000"),
        ("ind", "currency", "INR"),
        ("standard", "productType", "fixed"),
        ("one-time", "billingType", "one_time"),
    ]
    for text, key, value in turns:
        assert product_next_ask_key(draft) == key
        out = enrich_product_draft_result(
            {
                "ok": True,
                "source": "ai",
                "assistantText": "Ready to save?",
                "patch": {},
            },
            user_text=text,
            draft=draft,
        )
        patch = out.get("patch") or {}
        assert patch.get(key) == value, (text, key, patch)
        draft = merge_draft(draft, patch)
        assert "ready to save" not in (out.get("assistantText") or "").lower()

    assert product_next_ask_key(draft) == "maxDiscount"
    out = enrich_product_draft_result(
        {"ok": True, "assistantText": "ok", "patch": {}},
        user_text="skip",
        draft=draft,
    )
    draft = merge_draft(draft, out.get("patch"))
    assert "maxDiscount" in draft["skippedOptional"]
    assert product_next_ask_key(draft, business_type="b2b") == "productUrl"
    speech = (out.get("assistantText") or "").lower()
    assert "brand" not in speech
    assert "stock" not in speech

    out = enrich_product_draft_result(
        {"ok": True, "assistantText": "ok", "patch": {}},
        user_text="skip",
        draft=draft,
    )
    draft = merge_draft(draft, out.get("patch"))
    assert product_next_ask_key(draft, business_type="b2b") == "category"
    assert "category" in (out.get("assistantText") or "").lower()
    assert "brand" not in (out.get("assistantText") or "").lower()
    assert "stock" not in (out.get("assistantText") or "").lower()


def test_b2b_does_not_ask_or_patch_brand_or_stock():
    from app.agents.draft_conversation import product_next_ask_key

    draft = {
        "name": "CRM",
        "sku": "crm-1",
        "price": "35000",
        "currency": "INR",
        "productType": "fixed",
        "billingType": "one_time",
        "maxDiscountPercent": "15",
    }
    assert product_next_ask_key(draft, business_type="b2b") == "productUrl"
    out = enrich_product_draft_result(
        {
            "ok": True,
            "assistantText": "What brand is this under?",
            "patch": {"brand": "Worktual", "stockOnHand": "12"},
        },
        user_text="Worktual",
        draft=draft,
        business_type="b2b",
    )
    patch = out.get("patch") or {}
    assert "brand" not in patch
    assert "stockOnHand" not in patch
    speech = (out.get("assistantText") or "").lower()
    assert "brand" not in speech
    assert "stock" not in speech
    assert "url" in speech or "product url" in speech


def test_b2c_still_asks_brand_then_stock():
    from app.agents.draft_conversation import product_next_ask_key

    draft = {
        "name": "Earbuds",
        "sku": "EAR-1",
        "price": "79",
        "currency": "USD",
    }
    assert product_next_ask_key(draft, business_type="b2c") == "brand"
    out = enrich_product_draft_result(
        {"ok": True, "assistantText": "ok", "patch": {}},
        user_text="Worktual Home",
        draft=draft,
        business_type="b2c",
    )
    assert (out.get("patch") or {}).get("brand") == "Worktual Home"
    assert "stock" in (out.get("assistantText") or "").lower()
    draft = merge_draft(draft, out.get("patch"))
    assert product_next_ask_key(draft, business_type="b2c") == "stockOnHand"


def test_b2c_does_not_ask_or_patch_quote_fields():
    from app.agents.draft_conversation import product_next_ask_key

    draft = {
        "name": "Earbuds",
        "sku": "EAR-1",
        "price": "79",
        "currency": "USD",
    }
    assert product_next_ask_key(draft, business_type="b2c") == "brand"
    out = enrich_product_draft_result(
        {
            "ok": True,
            "assistantText": "Fixed or customizable?",
            "patch": {
                "productType": "fixed",
                "billingType": "one_time",
                "maxDiscountPercent": "10",
            },
        },
        user_text="Worktual Home",
        draft=draft,
        business_type="b2c",
    )
    patch = out.get("patch") or {}
    assert patch.get("brand") == "Worktual Home"
    assert "productType" not in patch
    assert "billingType" not in patch
    assert "maxDiscountPercent" not in patch
    speech = (out.get("assistantText") or "").lower()
    assert "customizable" not in speech
    assert "billing" not in speech
    assert "discount" not in speech
    assert "stock" in speech


def test_b2b2c_asks_quote_then_brand():
    from app.agents.draft_conversation import product_next_ask_key

    draft = {
        "name": "CRM",
        "sku": "crm-1",
        "price": "35000",
        "currency": "INR",
        "productType": "fixed",
        "billingType": "one_time",
        "maxDiscountPercent": "15",
    }
    assert product_next_ask_key(draft, business_type="b2b2c") == "brand"


def test_apply_product_slot_ind_and_standard():
    from app.agents.draft_conversation import apply_product_slot_answer

    d = {"name": "X", "sku": "Y", "price": "1"}
    assert apply_product_slot_answer("ind", d) == {"currency": "INR"}
    d2 = {**d, "currency": "INR"}
    assert apply_product_slot_answer("standard", d2) == {"productType": "fixed"}


def test_invoice_heuristic_payment_terms():
    deals = [{"id": "d1", "title": "Ticketing"}]
    r = invoice_heuristic("net 30", deals, {"dealId": "d1"})
    assert r["patch"]["paymentTerms"] == "Net 30"


def test_enrich_invoice_matches_deal_from_user_text():
    deals = [{"id": "d1", "title": "Ticketing"}]
    out = enrich_invoice_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "- Linked the Ticketing deal.",
        },
        user_text="Ticketing",
        draft={},
        deals=deals,
    )
    assert (out.get("patch") or {}).get("dealId") == "d1"
    speech = (out.get("assistantText") or "").lower()
    assert "product" in speech or "save" in speech or "everything on my list" in speech
    assert not speech.startswith("-")


def test_activity_heuristic_type_due_and_contact():
    contacts = [{"id": "c1", "displayName": "Ada Lovelace"}]
    r = activity_heuristic(
        "call Ada Lovelace about kickoff on 2026-09-01",
        contacts,
        {},
    )
    assert r["patch"]["contactId"] == "c1"
    assert r["patch"]["type"] == "call"
    assert r["patch"]["dueAt"] == "2026-09-01"
    assert "kickoff" in r["patch"]["subject"].lower()
    assert r["patch"].get("type") == "call"


def test_activity_heuristic_does_not_default_type():
    contacts = [{"id": "c1", "displayName": "Yaswanth Kumar"}]
    r = activity_heuristic("yaswanth", contacts, {})
    assert (r.get("patch") or {}).get("type") is None
    r2 = activity_heuristic("Yaswanth Kumar", contacts, {})
    assert (r2.get("patch") or {}).get("contactId") == "c1"
    assert (r2.get("patch") or {}).get("type") is None


def test_enrich_activity_matches_contact_and_asks_type():
    contacts = [{"id": "c1", "displayName": "Yaswanth Kumar"}]
    out = enrich_activity_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "Got it, I found Yaswanth. What would you like to note down?",
            "patch": {"type": "note"},
        },
        user_text="yaswanth",
        draft={},
        contacts=contacts,
    )
    assert (out.get("patch") or {}).get("contactId") == "c1"
    assert (out.get("patch") or {}).get("type") is None
    speech = (out.get("assistantText") or "").lower()
    assert "call" in speech or "meeting" in speech or "kind" in speech
    assert "note down" not in speech
    assert "got it," != speech.strip()


def test_enrich_activity_yes_does_not_fill_subject():
    contacts = [{"id": "c1", "displayName": "Yaswanth Kumar"}]
    out = enrich_activity_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "I'm not sure what you meant — is yes the subject?",
        },
        user_text="yes",
        draft={"contactId": "c1"},
        contacts=contacts,
    )
    assert (out.get("patch") or {}).get("subject") is None
    speech = (out.get("assistantText") or "").lower()
    assert "kind" in speech or "call" in speech or "meeting" in speech
    assert "not sure" not in speech


def test_enrich_activity_fills_contact_when_llm_omits_patch():
    contacts = [{"id": "c1", "displayName": "Ada Lovelace"}]
    out = enrich_activity_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "- I'll log a follow up.",
            "patch": {"subject": "Follow up"},
        },
        user_text="Ada Lovelace",
        draft={"subject": "Follow up"},
        contacts=contacts,
    )
    assert (out.get("patch") or {}).get("contactId") == "c1"
    speech = (out.get("assistantText") or "").lower()
    assert "kind" in speech or "call" in speech or "meeting" in speech


def test_enrich_activity_log_utterance_fills_contact_type_and_subject():
    contacts = [{"id": "c1", "displayName": "Yaswanth Kumar"}]
    out = enrich_activity_draft_result(
        {"ok": True, "source": "ai", "assistantText": "Searching activities…"},
        user_text=(
            'Log a note for Yaswanth: "he said to have a meet today evening 5 pm"'
        ),
        draft={},
        contacts=contacts,
    )
    patch = out.get("patch") or {}
    assert patch.get("contactId") == "c1"
    assert patch.get("type") == "note"
    assert "meet today evening" in (patch.get("subject") or "").lower()
    speech = (out.get("assistantText") or "").lower()
    assert "due" in speech or "skip" in speech
    assert "who is this" not in speech


def test_enrich_activity_yes_recovers_contact_from_history():
    contacts = [{"id": "c1", "displayName": "Yaswanth Kumar"}]
    out = enrich_activity_draft_result(
        {"ok": True, "source": "ai", "assistantText": "So who's this about?"},
        user_text="yes",
        draft={},
        contacts=contacts,
        messages=[
            {
                "role": "user",
                "text": (
                    'Log a note for Yaswanth: "he said to have a meet today evening 5 pm"'
                ),
            },
            {"role": "user", "text": "yes"},
        ],
    )
    patch = out.get("patch") or {}
    assert patch.get("contactId") == "c1"
    assert patch.get("type") == "note"


def test_looks_like_activity_log_from_list():
    from app.agents.crm_agent import (
        _looks_like_activity_log,
        _looks_like_list_command,
        _wants_create_walk,
    )

    text = 'Log a note for Yaswanth: "he said to have a meet today evening 5 pm"'
    assert _looks_like_activity_log(text)
    assert not _looks_like_activity_log("show activities for yaswanth")
    assert _wants_create_walk("activities", "list", {}, [], text)
    help_log = "Help me log a new activity"
    assert not _looks_like_list_command(help_log)
    assert _looks_like_activity_log(help_log)
    assert _wants_create_walk("activities", "list", {}, [], help_log)


def test_enrich_activity_help_me_log_does_not_steal_noreply_contact():
    contacts = [
        {
            "id": "CDP-cdc-9",
            "displayName": "Unknown",
            "email": "messages-noreply@linkedin.com",
        },
        {"id": "c1", "displayName": "Yaswanth Kumar", "email": "yaswanth@example.com"},
    ]
    out = enrich_activity_draft_result(
        {"ok": True, "source": "ai", "assistantText": ""},
        user_text="Help me log a new activity",
        draft={},
        contacts=contacts,
    )
    assert (out.get("patch") or {}).get("contactId") is None
    speech = (out.get("assistantText") or "").lower()
    assert "who" in speech or "contact" in speech
    assert "couldn't match" not in speech


def test_name_similarity_does_not_match_new_to_noreply():
    from app.agents.coworker_shared import name_similarity, resolve_catalog_id

    assert name_similarity("new", "noreply") < 0.72
    assert name_similarity("me", "messages-noreply@linkedin.com") < 0.72
    assert name_similarity("log", "com") < 0.72
    assert name_similarity("yaswanth", "Yaswanth Kumar") >= 0.9
    contacts = [
        {
            "id": "CDP-cdc-9",
            "displayName": "Unknown",
            "email": "messages-noreply@linkedin.com",
        }
    ]
    assert (
        resolve_catalog_id(
            "Help me log a new activity",
            items=contacts,
            kind="contact",
            min_score=0.72,
        )
        is None
    )


def test_quote_heuristic_qty_and_discount():
    deals = [{"id": "d1", "title": "Acme Expansion"}]
    products = [{"id": "p1", "name": "Pro Plan"}]
    r = quote_heuristic(
        "2 units with 10% discount",
        deals,
        {"dealId": "d1", "productId": "p1"},
        products,
    )
    assert r["patch"]["quantity"] == "2"
    assert r["patch"]["discountPct"] == "10"


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_company_draft_patch_city_does_not_fill_address():
    begin_agent_mcp_context(
        acting_user_id="user-1",
        organization_id="1000",
        role="sales_rep",
        module="company",
        surface="create",
        draft={"name": "Lyca"},
    )
    try:
        result = await dispatch(
            "patch_company_draft",
            {"city": "Chennai", "label": "patch"},
        )
        assert result["ok"] is True
        assert result["patch"].get("locationName") == "Chennai"
        assert "locationAddress" not in result["patch"]
    finally:
        end_agent_mcp_context()
        reset_ctx()


@pytest.mark.asyncio
async def test_company_draft_patch_maps_address_alias():
    begin_agent_mcp_context(
        acting_user_id="user-1",
        organization_id="1000",
        role="sales_rep",
        module="company",
        surface="create",
        draft={"name": "Acme", "locationName": "Boston"},
    )
    try:
        result = await dispatch(
            "patch_company_draft",
            {"address": "1 Main St", "label": "patch"},
        )
        assert result["ok"] is True
        assert result["kind"] == "draft_patch"
        assert result["patch"]["locationAddress"] == "1 Main St"
        assert "address" not in result["patch"]
        assert "label" not in result["patch"]
    finally:
        end_agent_mcp_context()
        reset_ctx()


def test_next_product_prompt_matches_workspace_order():
    """Chat ask order must match guided Product setup highlight order."""
    d: dict = {}
    assert "name" in next_product_prompt(d).lower()

    d = merge_draft(d, {"name": "AI native CRM"})
    assert "sku" in next_product_prompt(d, just_patched=True).lower()

    d = merge_draft(d, product_heuristic("CRM-1", d).get("patch"))
    assert d.get("sku") == "CRM-1"
    assert "price" in next_product_prompt(d, just_patched=True).lower()

    d = merge_draft(d, product_heuristic("35000", d).get("patch"))
    assert d.get("price") == "35000"
    assert "currency" in next_product_prompt(d, just_patched=True).lower()

    d = merge_draft(d, {"currency": "USD"})
    prompt = next_product_prompt(d, just_patched=True).lower()
    assert "fixed" in prompt or "customizable" in prompt or "standard" in prompt

    d = merge_draft(d, product_heuristic("customizable", d).get("patch"))
    assert d.get("productType") == "customizable"
    prompt = next_product_prompt(d, just_patched=True).lower()
    assert "one-time" in prompt or "recurring" in prompt

    d = merge_draft(d, {"billingType": "one_time"})
    assert "discount" in next_product_prompt(d, just_patched=True).lower()


def test_sanitize_product_rejects_per_seat_billing():
    clean = sanitize_product(
        {"billingType": "per_seat", "productType": "customizable", "price": "10"}
    )
    assert clean is not None
    assert clean.get("productType") == "customizable"
    assert clean.get("price") == "10"
    assert "billingType" not in clean


def test_product_heuristic_e2e_name_sku_price_type():
    draft: dict = {}
    for text, key, value in (
        ("AI native CRM", "name", "AI native CRM"),
        ("CRM-1", "sku", "CRM-1"),
        ("35000", "price", "35000"),
        ("USD", "currency", "USD"),
        ("customizable", "productType", "customizable"),
        ("one-time", "billingType", "one_time"),
    ):
        r = product_heuristic(text, draft)
        patch = r.get("patch") or {}
        assert patch.get(key) == value, (text, patch)
        draft = merge_draft(draft, patch)
    assert draft == {
        "name": "AI native CRM",
        "sku": "CRM-1",
        "price": "35000",
        "currency": "USD",
        "productType": "customizable",
        "billingType": "one_time",
    }


def test_apply_activity_slot_matches_partial_contact_name():
    from app.agents.draft_conversation import apply_activity_slot_answer

    contacts = [{"id": "c1", "displayName": "Yaswanth Kumar"}]
    assert apply_activity_slot_answer("yaswanth", {}, contacts) == {
        "contactId": "c1"
    }
    assert apply_activity_slot_answer("yes", {"contactId": "c1"}, contacts) is None
    assert apply_activity_slot_answer("call", {"contactId": "c1"}, contacts) == {
        "type": "call"
    }


def test_ensure_create_workspace_drops_list_search():
    from app.agents.crm_agent import _ensure_create_workspace

    out = _ensure_create_workspace(
        {
            "ok": True,
            "assistantText": "Got it,",
            "toolProposals": [
                {
                    "id": "ws-search",
                    "name": "set_workspace",
                    "args": {"mode": "list", "search": "yaswanth"},
                }
            ],
        },
        "activities",
      )
    tools = out.get("toolProposals") or []
    assert not any(
        t.get("name") == "set_workspace"
        and (t.get("args") or {}).get("mode") == "list"
        and (t.get("args") or {}).get("search")
        for t in tools
    )
    assert any(
        t.get("name") == "set_workspace"
        and (t.get("args") or {}).get("mode") == "create"
        for t in tools
    )
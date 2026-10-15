"""Requirement-PDF-aware proposal create flow."""

from __future__ import annotations

from app.agents.deal_coworker_agent import (
    _build_proposal_flow,
    _defers_products_to_requirement_pdf,
    _requirement_pdf_name,
    deals_heuristic,
)


def test_requirement_pdf_name_from_context():
    assert _requirement_pdf_name({"requirementPdfAttached": {"name": "BRD.pdf"}}) == "BRD.pdf"
    assert _requirement_pdf_name({"requirementPdfAttached": {"name": "scope.docx"}}) == "scope.docx"
    assert _requirement_pdf_name({"requirementPdfAttached": {"name": "notes.txt"}}) == "notes.txt"
    assert _requirement_pdf_name({"requirementPdfAttached": True}) == "requirement.pdf"
    assert _requirement_pdf_name({}) is None


def test_defers_products_to_pdf():
    assert _defers_products_to_requirement_pdf("generate")
    assert _defers_products_to_requirement_pdf("thats present in the requirement pdf itself")
    assert _defers_products_to_requirement_pdf("use the pdf")
    assert _defers_products_to_requirement_pdf("Use this attached file.")
    assert _defers_products_to_requirement_pdf("use the attached docx")
    assert _defers_products_to_requirement_pdf("use the word")
    assert _defers_products_to_requirement_pdf("")
    assert not _defers_products_to_requirement_pdf("AI Native CRM")


def test_build_flow_asks_for_brd_without_pdf():
    catalog = {
        "products": [
            {"id": "p1", "name": "AI Native CRM"},
        ]
    }
    out = _build_proposal_flow(
        text="create a proposal",
        catalog=catalog,
        deal_id="deal1",
        customer="positron",
        topic=None,
        title=None,
        requirement_pdf=None,
    )
    tools = out.get("toolProposals") or []
    assert not any(t.get("name") == "propose_create_proposal" for t in tools)
    assert "paperclip" in (out.get("assistantText") or "").lower()
    assert "enter" in (out.get("assistantText") or "").lower()
    assert "generate" not in (out.get("assistantText") or "").lower()
    assert "word" in (out.get("assistantText") or "").lower()


def test_build_flow_skips_product_ask_when_pdf_attached():
    catalog = {
        "products": [
            {"id": "p1", "name": "AI Native CRM"},
            {"id": "p2", "name": "Campaign Management"},
        ]
    }
    out = _build_proposal_flow(
        text="generate",
        catalog=catalog,
        deal_id="deal1",
        customer="positron",
        topic=None,
        title="positron",
        requirement_pdf="Positron - BRD.pdf",
    )
    tools = out.get("toolProposals") or []
    assert any(t.get("name") == "propose_create_proposal" for t in tools)
    assert "Positron - BRD.pdf" in (out.get("assistantText") or "")


def test_heuristic_generate_with_pdf_on_detail():
    catalog = {
        "products": [
            {"id": "p1", "name": "AI Native CRM"},
            {"id": "p2", "name": "Campaign"},
        ],
        "deals": [{"id": "deal1", "title": "positron"}],
    }
    ctx = {
        "surface": "detail",
        "entityId": "deal1",
        "module": "sales",
        "requirementPdfAttached": {"name": "Positron - BRD.pdf"},
    }
    messages = [
        {"role": "assistant", "text": "Which product(s) should I include?"},
        {"role": "user", "text": "generate"},
    ]
    out = deals_heuristic("generate", ctx, messages=messages, catalog=catalog)
    assert out is not None
    tools = out.get("toolProposals") or []
    assert any(t.get("name") == "propose_create_proposal" for t in tools)


def test_pre_route_skipped_when_llm_owns_the_turn():
    from app.agents.coworker_runtime import pre_route_proposal

    catalog = {
        "deals": [{"id": "deal1", "title": "MICE Global — Divya"}],
        "products": [{"id": "p1", "name": "AI Native CRM"}],
    }
    ctx = {
        "module": "sales",
        "surface": "detail",
        "entityId": "deal1",
        "pathname": "/sales/deal1",
    }
    out = pre_route_proposal(
        user_text='Create a proposal for "MICE Global — Divya (Bengaluru)"',
        messages=[],
        ctx=ctx,
        catalog=catalog,
        stm={},
        wm={},
        allow_keyword_intent=False,
    )
    assert out is None


def test_pre_route_skipped_with_pdf_when_llm_owns_the_turn():
    from app.agents.coworker_runtime import pre_route_proposal

    catalog = {
        "deals": [{"id": "deal1", "title": "MICE Global — Divya"}],
        "products": [{"id": "p1", "name": "AI Native CRM"}],
    }
    ctx = {
        "module": "sales",
        "surface": "detail",
        "entityId": "deal1",
        "pathname": "/sales/deal1",
        "requirementPdfAttached": {"name": "MICE Global BRD.pdf"},
    }
    out = pre_route_proposal(
        user_text="Use this attached file.",
        messages=[
            {
                "role": "assistant",
                "text": (
                    "To create a proposal for **MICE Global**, attach the "
                    "**requirement PDF (BRD)** with the paperclip, then press **Enter**."
                ),
            }
        ],
        ctx=ctx,
        catalog=catalog,
        stm={
            "pendingIntent": "create_proposal",
            "pendingAsk": "requirement_pdf",
            "slots": {"dealId": "deal1"},
        },
        wm={},
        allow_keyword_intent=False,
    )
    assert out is None


def test_pre_route_offline_asks_for_brd_without_pdf():
    from app.agents.coworker_runtime import pre_route_proposal

    catalog = {
        "deals": [{"id": "deal1", "title": "MICE Global — Divya"}],
        "products": [{"id": "p1", "name": "AI Native CRM"}],
    }
    ctx = {
        "module": "sales",
        "surface": "detail",
        "entityId": "deal1",
        "pathname": "/sales/deal1",
    }
    out = pre_route_proposal(
        user_text='Create a proposal for "MICE Global — Divya (Bengaluru)"',
        messages=[],
        ctx=ctx,
        catalog=catalog,
        stm={},
        wm={},
        allow_keyword_intent=True,
    )
    assert out is not None
    tools = out.get("toolProposals") or []
    assert not any(t.get("name") == "propose_create_proposal" for t in tools)
    assert "paperclip" in (out.get("assistantText") or "").lower()
    assert "enter" in (out.get("assistantText") or "").lower()


def test_pre_route_offline_creates_when_pdf_sent():
    from app.agents.coworker_runtime import pre_route_proposal

    catalog = {
        "deals": [{"id": "deal1", "title": "MICE Global — Divya"}],
        "products": [{"id": "p1", "name": "AI Native CRM"}],
    }
    ctx = {
        "module": "sales",
        "surface": "detail",
        "entityId": "deal1",
        "pathname": "/sales/deal1",
        "requirementPdfAttached": {"name": "MICE Global BRD.pdf"},
    }
    out = pre_route_proposal(
        user_text="Use this attached file.",
        messages=[
            {
                "role": "assistant",
                "text": (
                    "To create a proposal for **MICE Global**, attach the "
                    "**requirement PDF (BRD)** with the paperclip, then press **Enter**."
                ),
            }
        ],
        ctx=ctx,
        catalog=catalog,
        stm={
            "pendingIntent": "create_proposal",
            "pendingAsk": "requirement_pdf",
            "slots": {"dealId": "deal1"},
        },
        wm={},
        allow_keyword_intent=True,
    )
    assert out is not None
    tools = out.get("toolProposals") or []
    assert any(t.get("name") == "propose_create_proposal" for t in tools)


def test_map_create_proposal_skipped_without_pdf():
    from app.agents.crm_tools import map_tool_calls_to_result

    r = map_tool_calls_to_result(
        "I'll start the proposal.",
        [
            {
                "function": {
                    "name": "propose_create_proposal",
                    "arguments": {"dealId": "deal1", "title": "positron"},
                }
            }
        ],
        mod="sales",
        pathname="/sales/deal1",
        user_text='Create a proposal for "positron"',
        entity_id="deal1",
        context={},
    )
    tools = r.get("toolProposals") or []
    assert not any(t.get("name") == "propose_create_proposal" for t in tools)


def test_map_create_proposal_allowed_with_pdf():
    from app.agents.crm_tools import map_tool_calls_to_result

    r = map_tool_calls_to_result(
        "I'll create the proposal from the BRD.",
        [
            {
                "function": {
                    "name": "propose_create_proposal",
                    "arguments": {"dealId": "deal1"},
                }
            }
        ],
        mod="sales",
        pathname="/sales/deal1",
        user_text="Use this attached file.",
        entity_id="deal1",
        context={"requirementPdfAttached": {"name": "MICE Global BRD.pdf"}},
    )
    tools = r.get("toolProposals") or []
    assert any(t.get("name") == "propose_create_proposal" for t in tools)


def test_heuristic_pdf_answer_while_awaiting_product():
    catalog = {
        "products": [
            {"id": "p1", "name": "AI Native CRM"},
        ],
        "deals": [{"id": "deal1", "title": "positron"}],
    }
    ctx = {
        "surface": "detail",
        "entityId": "deal1",
        "module": "sales",
        "requirementPdfAttached": {"name": "Positron - BRD.pdf"},
    }
    messages = [
        {
            "role": "assistant",
            "text": "Which product(s) should I include in the proposal for positron?",
        },
    ]
    out = deals_heuristic(
        "thats present in the requirement pdf itself",
        ctx,
        messages=messages,
        catalog=catalog,
    )
    assert out is not None
    tools = out.get("toolProposals") or []
    assert any(t.get("name") == "propose_create_proposal" for t in tools)


def test_extract_text_requirement_files():
    import base64

    from app.agents.document_template_agent import extract_sample_text_from_file

    payload = base64.b64encode("Need 50 CRM seats.\n".encode()).decode()
    text, warnings = extract_sample_text_from_file("brd.txt", payload)
    assert "50 CRM seats" in text
    assert not warnings
    md, md_warnings = extract_sample_text_from_file("brief.md", payload)
    assert "50 CRM seats" in md
    assert not md_warnings
    _, bad = extract_sample_text_from_file("scan.png", payload)
    assert any("Unsupported" in w for w in bad)


def test_awaiting_brd_matches_word_or_text_copy():
    from app.agents.deal_coworker_agent import _awaiting_requirement_brd

    assert _awaiting_requirement_brd(
        [
            {
                "role": "assistant",
                "text": (
                    "To create a proposal for **Acme**, attach the **BRD** "
                    "(PDF, Word, or text) with the paperclip, then press **Enter**."
                ),
            }
        ]
    )
    assert _awaiting_requirement_brd(
        [
            {
                "role": "assistant",
                "text": (
                    "To create a proposal for **Acme**, attach the "
                    "**requirement PDF (BRD)** with the paperclip, then press **Enter**."
                ),
            }
        ]
    )

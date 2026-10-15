"""Smoke checks for assist_meeting context pack normalization + KB limit constant."""

from __future__ import annotations

from app.agents.assist_meeting_agent import (
    ASSIST_KB_LIMIT,
    SYSTEM_PROMPT,
    _normalize_context_pack,
)


def test_kb_limit_raised():
    assert ASSIST_KB_LIMIT >= 5
    assert ASSIST_KB_LIMIT <= 8


def test_normalize_context_pack_from_object():
    pack_text, catalog = _normalize_context_pack(
        {
            "packText": "Contact: Ada · opportunity / qualified\nDeal: Expansion — Proposal",
            "products": [
                {"name": "CRM Pro", "price": "99", "currency": "USD"},
                {"name": "Assist", "price": None, "currency": "USD"},
            ],
        }
    )
    assert "Ada" in pack_text
    assert "CRM Pro" in catalog
    assert "Assist" in catalog


def test_normalize_context_pack_string():
    pack_text, catalog = _normalize_context_pack("Contact: Bob")
    assert pack_text == "Contact: Bob"
    assert catalog == ""


def test_prompt_mentions_crm_and_catalog():
    assert "CRM" in SYSTEM_PROMPT
    assert "CUSTOMER QUESTION" in SYSTEM_PROMPT or "customer question" in SYSTEM_PROMPT.lower()
    assert "retrieve_knowledge" in SYSTEM_PROMPT
    assert "catalog" in SYSTEM_PROMPT.lower()


def test_sales_prompt_requires_conversation_context_and_next_best_action():
    # Regression: the JSON schema in the system prompt previously omitted
    # conversationContext/nextBestAction entirely, so the "sales" persona
    # (used by live coaching) reliably returned them as null even though the
    # frontend Information panel and TS layer fully support them. The model
    # can only include a field consistently if the schema it's told to
    # produce actually lists it as required.
    from app.agents.assist_meeting_agent import _build_system_prompt

    sales_prompt = _build_system_prompt("sales")
    assert "conversationContext" in sales_prompt
    assert "backgroundOneLine" in sales_prompt
    assert "lastDiscussionSummary" in sales_prompt
    assert "theirPositionThen" in sales_prompt
    assert "theirFocusNow" in sales_prompt
    assert "whatChanged" in sales_prompt
    assert "nextBestAction" in sales_prompt
    assert "REQUIRED" in sales_prompt
    assert "salesperson" in sales_prompt.lower()
    assert "knowledge-base facts" in sales_prompt.lower()
    presales_prompt = _build_system_prompt("presales")
    assert "presales person" in presales_prompt.lower()
    assert "knowledge-base facts" in presales_prompt.lower()
    assert "salesperson" not in presales_prompt.lower()


def test_filter_catalog_for_named_query():
    from app.agents.assist_meeting_agent import _filter_catalog_for_query

    catalog = "- Product Module — USD 99\n- CVM — USD 299\n- Cognitive CDP — USD 499"
    filtered = _filter_catalog_for_query(catalog, "explain CVM in detail")
    assert "CVM" in filtered
    assert "Product Module" not in filtered


def test_retrieve_knowledge_tool_schema():
    from app.agents.assist_meeting_agent import RETRIEVE_KNOWLEDGE_TOOL

    assert RETRIEVE_KNOWLEDGE_TOOL["function"]["name"] == "retrieve_knowledge"
    params = RETRIEVE_KNOWLEDGE_TOOL["function"]["parameters"]
    assert "query" in params["properties"]
    assert "query" in params["required"]


def test_catalog_fallback_lists_products():
    from app.agents.assist_meeting_agent import _catalog_fallback_state

    catalog = "- AI Native CRM — INR 15000\n- Cognitive Customer Data Platform — INR 76500000"
    out = _catalog_fallback_state(
        {
            "query": "What are the products you have?",
            "contact_name": "ravi r",
            "product_catalog_text": catalog,
        },
        reason="catalog_fallback_llm_unusable",
        kb_status="failure",
    )
    assert out is not None
    assert out["status"] == "ok"
    assert "AI Native CRM" in (out.get("talk_track") or "")
    assert out.get("suggestions")


def test_repair_against_tenant_catalog_only():
    from app.agents.assist_meeting_agent import repair_assist_query_against_catalog

    with_ccaas = "- CCaaS — USD 399\n- CVM — USD 299"
    repaired = repair_assist_query_against_catalog(
        "Can you tell about AAC cars?",
        with_ccaas,
    )
    assert "CCaaS" in repaired
    assert "AAC cars" not in repaired

    other_tenant = "- Fleet Tracker — USD 10\n- Dispatch Pro — USD 20"
    left = repair_assist_query_against_catalog(
        "Can you tell about AAC cars?",
        other_tenant,
    )
    assert "AAC cars" in left
    assert "CCaaS" not in left


if __name__ == "__main__":
    test_kb_limit_raised()
    test_normalize_context_pack_from_object()
    test_normalize_context_pack_string()
    test_prompt_mentions_crm_and_catalog()
    test_sales_prompt_requires_conversation_context_and_next_best_action()
    test_filter_catalog_for_named_query()
    test_retrieve_knowledge_tool_schema()
    test_catalog_fallback_lists_products()
    test_repair_against_tenant_catalog_only()
    print("assist_meeting_agent smoke: ok")

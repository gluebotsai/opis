"""Live-assist catalog listing intent (no LLM)."""

from app.agents.assist_meeting_agent import is_generic_product_listing_query


def test_generic_product_listing_queries():
    assert is_generic_product_listing_query("What are the products you have?")
    assert is_generic_product_listing_query("what products do you offer")
    assert is_generic_product_listing_query("Can you tell me your product catalog?")


def test_not_generic_listing():
    assert not is_generic_product_listing_query("CVM pricing")
    assert not is_generic_product_listing_query("ok")
    assert not is_generic_product_listing_query(
        "How does customer value management integrate with Salesforce?",
    )

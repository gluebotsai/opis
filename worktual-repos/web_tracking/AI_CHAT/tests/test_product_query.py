from app.reports.product_query import extract_product_name, is_named_product_visit_query


def test_extract_product_name_from_user_phrasing():
    assert extract_product_name("total visit for CONTRASTING MIDI DRESS") == "CONTRASTING MIDI DRESS"


def test_named_product_visit_query():
    assert is_named_product_visit_query(
        "What is the total number of visits for the product CONTRASTING MIDI DRESS in the month?"
    )

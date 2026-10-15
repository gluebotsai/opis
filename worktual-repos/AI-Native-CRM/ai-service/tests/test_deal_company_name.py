from app.agents.deal_draft_agent import coerce_deal_name_fields, sanitize_patch


def test_numeric_company_name_is_dropped():
    catalog = {
        "companies": [
            {"id": "cmtv0yx1e003qoa0urmrevsor", "name": "316445734456"},
            {"id": "zepto-id", "name": "Zepto"},
        ]
    }
    clean = sanitize_patch(
        {"title": "Kavin-CRM", "companyName": "316445734456", "amount": "10000"},
        catalog,
    )
    assert clean is not None
    assert "companyName" not in clean
    assert "companyId" not in clean
    assert clean["title"] == "Kavin-CRM"


def test_open_contact_is_in_the_deal_prompt():
    from app.agents.crm_tools import build_system_prompt

    prompt = build_system_prompt(
        "sales",
        "create",
        {
            "pathname": "/sales/new",
            "catalog": {
                "openContact": {
                    "id": "contact-kavin",
                    "displayName": "Kavin K",
                    "companyName": "Zepto",
                    "companyId": "zepto-id",
                },
                "openCompany": {"id": "zepto-id", "name": "Zepto"},
            },
        },
    )
    assert "Zepto" in prompt
    assert "Do not ask which company or which contact" in prompt


def test_catalog_company_keeps_the_readable_name():
    catalog = {"companies": [{"id": "zepto-id", "name": "Zepto"}]}
    clean = coerce_deal_name_fields(
        {"companyId": "zepto-id", "companyName": "zepto-id"},
        catalog,
    )
    assert clean is not None
    assert clean["companyName"] == "Zepto"
    assert clean["companyId"] == "zepto-id"

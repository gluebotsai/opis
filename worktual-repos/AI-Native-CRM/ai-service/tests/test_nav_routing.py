from typing import Any, Optional

from app.agents.nav_routing import (
    configuration_sub_href,
    navigation_clarification,
    quote_navigation_ambiguous,
)


def test_quote_templates_route_to_configuration():
    assert configuration_sub_href("open quote templates") == "/configuration/quote-templates"
    assert configuration_sub_href("quote template settings") == "/configuration/quote-templates"


def test_bare_quote_is_ambiguous():
    assert quote_navigation_ambiguous("open quote") is True
    assert quote_navigation_ambiguous("go to quotes") is True
    assert navigation_clarification("open quote") is not None


def test_sales_quotes_are_clear():
    assert quote_navigation_ambiguous("create a quote for this deal") is False
    assert quote_navigation_ambiguous("open sales quotes") is False
    assert configuration_sub_href("customer quotes") is None


def _nav_href(result: Optional[dict[str, Any]]) -> Optional[str]:
    tools = (result or {}).get("toolProposals") or []
    nav = [t for t in tools if t.get("name") == "navigate"]
    if not nav:
        return None
    return str((nav[-1].get("args") or {}).get("href") or "")


def test_native_cross_module_create_does_not_keyword_overlay():
    """Navigate is an LLM tool. Keyword overlay must not inject it."""
    from app.agents.crm_agent import bind_native_module_route

    speech = "Let's get that company set up — what's the company name?"
    out = bind_native_module_route(
        {
            "ok": True,
            "assistantText": speech,
            "toolProposals": [
                {
                    "name": "set_workspace",
                    "args": {"mode": "list", "search": "x", "auto": True},
                }
            ],
            "patch": {"firstName": "Nope"},
        },
        user_text="create company",
        module="contact",
        pathname="/contact",
        surface="list",
    )
    assert _nav_href(out) is None
    assert out["assistantText"] == speech
    assert (out.get("patch") or {}).get("firstName") == "Nope"


def test_native_go_to_does_not_keyword_overlay():
    from app.agents.crm_agent import bind_native_module_route

    out = bind_native_module_route(
        {"ok": True, "assistantText": "On my way."},
        user_text="go to contacts",
        module="company",
        pathname="/company",
        surface="list",
    )
    assert _nav_href(out) is None
    assert out["assistantText"] == "On my way."


def test_in_module_create_and_slot_answers_stay_on_the_page():
    from app.agents.crm_agent import bind_native_module_route

    same = bind_native_module_route(
        {"ok": True, "assistantText": "What's the company name?"},
        user_text="create company",
        module="company",
        pathname="/company",
        surface="list",
    )
    assert _nav_href(same) is None

    slot = bind_native_module_route(
        {"ok": True, "assistantText": "Got it — Raghu."},
        user_text="raghu",
        module="contact",
        pathname="/contact",
        surface="create",
    )
    assert slot["assistantText"] == "Got it — Raghu."
    assert _nav_href(slot) is None


def test_schedule_demo_for_existing_contact_opens_activity_not_contact():
    from app.agents.crm_agent import resolve_create_navigate, resolve_cross_module_create

    phrase = "schedule a demo for an existing contact"
    dash = resolve_create_navigate(phrase, "dashboard", "/dashboard")
    assert _nav_href(dash) == "/activities/log"
    on_contact = resolve_cross_module_create(phrase, "contact", "/contact/new")
    assert _nav_href(on_contact) == "/activities/log"
    named = resolve_cross_module_create(
        "schedule demo for nikila", "contact", "/contact/new"
    )
    assert _nav_href(named) == "/activities/log"


def test_dashboard_create_product_navigates_to_product_new():
    from app.agents.crm_agent import resolve_create_navigate, resolve_pending_route

    for phrase in ("create product", "create procduct", "add a prodcut"):
        out = resolve_create_navigate(phrase, "dashboard", "/dashboard")
        href = _nav_href(out)
        assert href == "/product/new", (phrase, href)
        assert (out or {}).get("toolProposals")[0]["args"].get("seedPrompt")

    pending = resolve_pending_route(
        "create procduct", "dashboard", "/dashboard", surface="list"
    )
    assert _nav_href(pending) == "/product/new"


def test_dashboard_create_finance_typo_navigates_to_finance_new():
    from app.agents.crm_agent import resolve_create_navigate, resolve_pending_route

    for phrase in ("create finance", "create finacnce", "create a finnace record"):
        out = resolve_create_navigate(phrase, "dashboard", "/dashboard")
        href = _nav_href(out)
        assert href == "/finance/new", (phrase, href)

    pending = resolve_pending_route(
        "create finacnce", "dashboard", "/dashboard", surface="list"
    )
    assert _nav_href(pending) == "/finance/new"


def test_fuzzy_module_from_text_resolves_typos_without_enumeration():
    """One shared fuzzy matcher covers arbitrary typos — no per-word regex."""
    from app.agents.nav_routing import fuzzy_module_from_text

    cases = {
        "finacnce": "finance",
        "procduct": "product",
        "prodcut": "product",
        "compnay": "company",
        "contct": "contact",
        "qoute": "quotes",
        "activty": "activities",
    }
    for typo, expected in cases.items():
        assert fuzzy_module_from_text(f"create a {typo}") == expected, typo

    # Common filler words must never accidentally resolve to a module.
    for word in ("please", "create", "record", "would", "help", "the"):
        assert fuzzy_module_from_text(word) is None, word


def test_dashboard_vague_create_does_not_default_to_sales():
    from app.agents.crm_agent import resolve_create_navigate

    assert resolve_create_navigate("create something", "dashboard", "/dashboard") is None
    deal = resolve_create_navigate("create a deal", "dashboard", "/dashboard")
    assert _nav_href(deal) == "/sales/new"


def test_show_another_module_does_not_keyword_overlay():
    from app.agents.crm_agent import bind_native_module_route

    away = bind_native_module_route(
        {"ok": True, "assistantText": "Opening companies."},
        user_text="show companies",
        module="contact",
        pathname="/contact",
        surface="list",
    )
    assert _nav_href(away) is None

    stay = bind_native_module_route(
        {"ok": True, "assistantText": "Here's the list."},
        user_text="Show all contacts",
        module="contact",
        pathname="/contact",
        surface="list",
    )
    assert _nav_href(stay) is None


def test_create_walk_does_not_pin_contact_when_navigating_to_company():
    from app.agents.crm_agent import _ensure_create_workspace, _wants_create_walk

    leaving = {
        "ok": True,
        "assistantText": "I'll set Lyca up as a company.",
        "patch": {"companyName": "lyca"},
        "toolProposals": [
            {
                "name": "navigate",
                "args": {"href": "/company/new", "seedPrompt": "Lyca", "auto": True},
            }
        ],
    }
    assert not _wants_create_walk(
        "contact",
        "create",
        leaving,
        messages=[],
        user_text="lyca",
        context={"pathname": "/contact/new"},
    )
    out = _ensure_create_workspace(leaving, "contact")
    assert not (out.get("patch") or {}).get("companyName")
    ws = [
        t
        for t in (out.get("toolProposals") or [])
        if t.get("name") == "set_workspace"
        and (t.get("args") or {}).get("mode") == "create"
    ]
    assert not ws or "contact" not in str(ws[0].get("label") or "").lower()


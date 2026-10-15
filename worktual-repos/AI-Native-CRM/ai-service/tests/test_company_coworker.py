"""Company co-worker intent routing — create vs edit vs search."""

from __future__ import annotations

from app.agents.company_coworker_agent import (
    _wants_create,
    _wants_edit,
    companies_heuristic,
    resolve_company_match,
)


def test_want_to_edit_is_not_create():
    assert _wants_edit("i want to edit company")
    assert not _wants_create("i want to edit company")
    assert not _wants_create("edit company")


def test_create_phrases_still_match():
    assert _wants_create("create a new company")
    assert _wants_create("help me create a company")
    assert _wants_create("add a company")
    assert not _wants_create("i want to edit company")


def test_add_field_is_update_not_create():
    assert _wants_edit("add a domain")
    assert not _wants_create("add a domain")
    assert _wants_edit("add an industry")
    assert not _wants_create("add an industry")
    assert _wants_create("create a company")
    r = companies_heuristic(
        "add a domain",
        {"module": "company", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )


def test_insert_company_opens_create():
    r = companies_heuristic(
        "insert company",
        {"module": "company", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "create"
    assert "name" in r["assistantText"].lower()


def test_edit_asks_which_company():
    r = companies_heuristic("i want to edit company", {"module": "company", "surface": "list"})
    assert r and r["ok"]
    assert "which company" in r["assistantText"].lower()
    assert not r.get("toolProposals")


def test_edit_with_name_opens_unique_match():
    catalog = {
        "companies": [
            {"id": "c1", "name": "Acme Corp", "domain": "acme.com"},
        ]
    }
    r = companies_heuristic(
        "edit company acme",
        {"module": "company", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "detail"
    assert props[0]["args"]["entityId"] == "c1"


def test_delete_asks_which_company():
    r = companies_heuristic("delete company", {"module": "company", "surface": "list"})
    assert r and r["ok"]
    assert "which company" in r["assistantText"].lower()
    assert "delete" in r["assistantText"].lower()


def test_delete_followup_opens_for_confirm():
    catalog = {
        "companies": [{"id": "c1", "name": "Acme Corp", "domain": "acme.com"}]
    }
    messages = [
        {"role": "user", "text": "delete company"},
        {
            "role": "assistant",
            "text": "Which company would you like to delete? Share a name or domain.",
        },
        {"role": "user", "text": "acme"},
    ]
    r = companies_heuristic(
        "acme",
        {"module": "company", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "remove" in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props[0]["args"]["entityId"] == "c1"


def test_delete_this_company_on_detail_executes():
    catalog = {
        "companies": [{"id": "c1", "name": "Acme Corp", "domain": "acme.com"}]
    }
    messages = [
        {
            "role": "assistant",
            "text": "I found **Acme Corp**. Want me to remove it permanently?",
        },
        {"role": "user", "text": "delete this company"},
    ]
    r = companies_heuristic(
        "delete this company",
        {"module": "company", "surface": "detail", "entityId": "c1"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_delete_company"
    assert props[0]["args"]["companyId"] == "c1"
    assert props[0]["args"]["auto"] is True


def test_domain_update_on_detail_proposes_tool():
    r = companies_heuristic(
        "domain to acme.com",
        {"module": "company", "surface": "detail", "entityId": "c1"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_update_company"
    assert props[0]["args"]["domain"] == "acme.com"


def test_resolve_domain_match():
    hit = resolve_company_match(
        {"companies": [{"id": "c1", "name": "Acme Corp", "domain": "acme.com"}]},
        "acme.com",
    )
    assert hit and hit["id"] == "c1"


def test_memory_first_delete_company_without_this_keyword():
    r = companies_heuristic(
        "remove it",
        {"module": "company", "surface": "detail", "entityId": "c1"},
        catalog={"companies": [{"id": "c1", "name": "Acme"}]},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_delete_company"
    assert props[0]["args"]["companyId"] == "c1"

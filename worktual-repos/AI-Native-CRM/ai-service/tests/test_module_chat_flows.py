"""Cross-module chat flow audit — memory-first targeting + no silly misroutes.

These cases encode the production bar for coworker chat on list vs detail
workspaces. Prefer catalog/memory over brittle keyword-only targeting.
"""

from __future__ import annotations

from app.agents.company_coworker_agent import companies_heuristic
from app.agents.contact_coworker_agent import contacts_heuristic
from app.agents.deal_coworker_agent import deals_heuristic
from app.agents.draft_conversation import (
    company_field_change_without_value,
    contact_field_change_without_value,
)
from app.agents.link_module_coworker_agent import heuristic as link_heuristic
from app.agents.product_coworker_agent import products_heuristic


DETAIL_CONTACT = {"module": "contact", "surface": "detail", "entityId": "c1"}
DETAIL_DEAL = {"module": "sales", "surface": "detail", "entityId": "d1"}
DETAIL_COMPANY = {"module": "company", "surface": "detail", "entityId": "co1"}
DETAIL_PRODUCT = {"module": "product", "surface": "detail", "entityId": "p1"}
LIST_CONTACT = {"module": "contact", "surface": "list"}


# ── Contact ──────────────────────────────────────────────────────────────────


def test_contact_delete_bare_verbs_use_open_record() -> None:
    catalog = {
        "openContact": {
            "id": "c1",
            "displayName": "Priya Nair",
            "email": "priya@acme.com",
        },
        "contacts": [
            {
                "id": "c1",
                "displayName": "Priya Nair",
                "email": "priya@acme.com",
            }
        ],
    }
    for phrase in (
        "delete",
        "remove them",
        "get rid of him",
        "trash it",
        "delete this contact",
        "delete contact",
        "remove this",
    ):
        r = contacts_heuristic(phrase, DETAIL_CONTACT, catalog=catalog)
        assert r and r["ok"], phrase
        props = r.get("toolProposals") or []
        assert props and props[0]["name"] == "propose_delete_contact", phrase
        assert props[0]["args"]["contactId"] == "c1", phrase
        assert "match" not in r["assistantText"].lower(), phrase
        assert "filtered" not in r["assistantText"].lower(), phrase


def test_contact_delete_named_other_does_not_silently_delete_open() -> None:
    catalog = {
        "openContact": {"id": "c1", "displayName": "Priya Nair"},
        "contacts": [
            {"id": "c1", "displayName": "Priya Nair", "email": "p@x.com"},
            {"id": "c2", "displayName": "Alex Kim", "email": "alex@x.com"},
        ],
    }
    r = contacts_heuristic("delete Alex Kim", DETAIL_CONTACT, catalog=catalog)
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    # Either confirm/open Alex, or delete Alex — never silent delete of Priya
    if props and props[0]["name"] == "propose_delete_contact":
        assert props[0]["args"]["contactId"] == "c2"
    else:
        assert "alex" in r["assistantText"].lower() or any(
            (p.get("args") or {}).get("entityId") == "c2"
            or "alex" in str((p.get("args") or {}).get("search") or "").lower()
            for p in props
        )


def test_contact_delete_this_contact_on_list_asks_who() -> None:
    r = contacts_heuristic("delete this contact", LIST_CONTACT)
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(p.get("name") == "propose_delete_contact" for p in props)
    assert "which contact" in r["assistantText"].lower()
    # Must not treat "this contact" as a list search string
    assert not any(
        p.get("name") == "set_workspace"
        and "this contact" in str((p.get("args") or {}).get("search") or "").lower()
        for p in props
    )


def test_contact_add_phone_on_detail_asks_for_number() -> None:
    catalog = {
        "openContact": {"id": "c1", "displayName": "Priya Nair"},
    }
    r = contacts_heuristic("add a phone number", DETAIL_CONTACT, catalog=catalog)
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )
    text = r["assistantText"].lower()
    assert "phone" in text
    assert "priya" in text
    assert "what should we change" not in text


def test_contact_add_phone_with_value_proposes_update() -> None:
    catalog = {
        "openContact": {"id": "c1", "displayName": "Priya Nair"},
    }
    r = contacts_heuristic("phone +1 555 0100", DETAIL_CONTACT, catalog=catalog)
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_contact"
    assert props[0]["args"]["contactId"] == "c1"
    assert "+1 555 0100" in str(props[0]["args"].get("phone") or "")


def test_contact_about_open_uses_memory() -> None:
    catalog = {
        "openContact": {
            "id": "c1",
            "displayName": "Priya Nair",
            "email": "priya@acme.com",
            "title": "VP Sales",
        }
    }
    r = contacts_heuristic(
        "tell me about this contact", DETAIL_CONTACT, catalog=catalog
    )
    assert r and r["ok"]
    text = r["assistantText"].lower()
    assert "priya" in text
    assert "vp sales" in text


def test_contact_field_without_value_helper() -> None:
    assert contact_field_change_without_value("add a phone number") == "phone"
    assert contact_field_change_without_value("change the email") == "email"
    assert contact_field_change_without_value("phone +1 555") is None


# ── Deal ─────────────────────────────────────────────────────────────────────


def test_deal_delete_bare_verbs_use_open_record() -> None:
    catalog = {"deals": [{"id": "d1", "title": "Acme Expansion"}]}
    for phrase in ("delete", "remove this deal", "trash it", "get rid of this"):
        r = deals_heuristic(phrase, DETAIL_DEAL, catalog=catalog)
        assert r and r["ok"], phrase
        props = r.get("toolProposals") or []
        assert props and props[0]["name"] == "propose_delete_deal", phrase
        assert props[0]["args"]["dealId"] == "d1", phrase


def test_deal_stage_move_on_open() -> None:
    r = deals_heuristic("move to propose", DETAIL_DEAL)
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_stage_change"
    assert props[0]["args"]["stage"] == "propose"


def test_deal_title_update_on_open() -> None:
    r = deals_heuristic(
        "set title as Mega deal",
        DETAIL_DEAL,
        catalog={"deals": [{"id": "d1", "title": "Old"}]},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    update = next(p for p in props if p["name"] == "propose_update_deal")
    assert update["args"]["dealId"] == "d1"
    assert update["args"]["title"] == "Mega deal"


# ── Company ──────────────────────────────────────────────────────────────────


def test_company_delete_bare_verbs_use_open_record() -> None:
    catalog = {"companies": [{"id": "co1", "name": "Acme Corp"}]}
    for phrase in ("delete", "remove this company", "trash it"):
        r = companies_heuristic(phrase, DETAIL_COMPANY, catalog=catalog)
        assert r and r["ok"], phrase
        props = r.get("toolProposals") or []
        assert props and props[0]["name"] == "propose_delete_company", phrase
        assert props[0]["args"]["companyId"] == "co1", phrase


def test_company_industry_without_value_asks() -> None:
    catalog = {
        "openCompany": {"id": "co1", "name": "Acme Corp"},
        "companies": [{"id": "co1", "name": "Acme Corp"}],
    }
    assert company_field_change_without_value("change the industry") == "industry"
    r = companies_heuristic(
        "change the industry", DETAIL_COMPANY, catalog=catalog
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not props or props[0]["name"] != "propose_update_company"
    text = r["assistantText"].lower()
    assert "industry" in text
    assert "what should we change" not in text


def test_company_industry_with_value_proposes() -> None:
    r = companies_heuristic("industry SaaS", DETAIL_COMPANY)
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_company"
    assert props[0]["args"]["companyId"] == "co1"
    assert props[0]["args"]["industry"] == "SaaS"


# ── Product ───────────────────────────────────────────────────────────────────


def test_product_delete_bare_verbs_use_open_record() -> None:
    catalog = {"products": [{"id": "p1", "name": "Pro Plan"}]}
    for phrase in ("delete", "remove this product", "trash it"):
        r = products_heuristic(phrase, DETAIL_PRODUCT, catalog=catalog)
        assert r and r["ok"], phrase
        props = r.get("toolProposals") or []
        assert props and props[0]["name"] == "propose_delete_product", phrase
        assert props[0]["args"]["productId"] == "p1", phrase


def test_product_price_update_on_open() -> None:
    r = products_heuristic("price to 99", DETAIL_PRODUCT)
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_product"
    assert props[0]["args"]["productId"] == "p1"
    assert props[0]["args"]["price"] == "99"


# ── Link modules (quote / invoice / activity) ────────────────────────────────


def test_quote_help_does_not_open_create() -> None:
    r = link_heuristic(
        kind="quotes",
        text="what can you help with?",
        context={"module": "quotes", "surface": "list"},
        catalog={},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )
    assert "quote" in r["assistantText"].lower()


def test_invoice_help_does_not_open_create() -> None:
    r = link_heuristic(
        kind="finance",
        text="help",
        context={"module": "finance", "surface": "list"},
        catalog={},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )


def test_activity_help_does_not_open_create() -> None:
    r = link_heuristic(
        kind="activities",
        text="what can you do?",
        context={"module": "activities", "surface": "list"},
        catalog={},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )


def test_quote_field_add_does_not_create() -> None:
    r = link_heuristic(
        kind="quotes",
        text="add a discount",
        context={"module": "quotes", "surface": "list"},
        catalog={},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )


def test_activity_log_a_call_opens_create_not_crash() -> None:
    r = link_heuristic(
        kind="activities",
        text="log a call",
        context={"module": "activities", "surface": "list"},
        catalog={},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )


def test_contact_email_and_company_domain_shorthand() -> None:
    r = contacts_heuristic(
        "email priya@new.com",
        DETAIL_CONTACT,
        catalog={"openContact": {"id": "c1", "displayName": "Priya"}},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_contact"
    assert props[0]["args"]["email"] == "priya@new.com"

    r2 = companies_heuristic("domain acme.io", DETAIL_COMPANY)
    assert r2 and r2["ok"]
    props2 = r2.get("toolProposals") or []
    assert props2 and props2[0]["name"] == "propose_update_company"
    assert props2[0]["args"]["domain"] == "acme.io"


def test_show_all_contacts_on_list_clears_search_filter() -> None:
    """After a find/delete filter, 'Show all contacts' must clear q — not say already here."""
    r = contacts_heuristic("Show all contacts", LIST_CONTACT)
    assert r and r["ok"]
    assert "already" not in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "list"
    assert props[0]["args"].get("search") == ""


def test_orchestrator_create_contact_has_no_canned_speech() -> None:
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.agents import crm_agent

    ai_text = "Sure — what's the first name for this new contact?"
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.coworker_runtime.run_skill_turn",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "assistantText": ai_text,
                "source": "ai",
                "toolProposals": [
                    {"name": "set_workspace", "args": {"mode": "create"}},
                ],
            },
        ),
        patch(
            "app.agents.crm_agent.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        r = asyncio.run(
            crm_agent.run(
                messages=[{"role": "user", "text": "Help me create a new contact"}],
                context={
                    "module": "contact",
                    "surface": "list",
                    "pathname": "/contact",
                },
                catalog={},
                organization_id="org1",
            )
        )
    assert r and r.get("ok")
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert (props[0].get("args") or {}).get("mode") == "create"
    speech = (r.get("assistantText") or "").strip().lower()
    assert speech
    assert "something went wrong" not in speech
    assert "how many" not in speech
    assert "name" in speech or "who" in speech


def test_orchestrator_help_me_log_activity_asks_who() -> None:
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.agents import crm_agent

    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.llm.generate_ai_text",
            new_callable=AsyncMock,
            return_value="",
        ),
        patch(
            "app.agents.coworker_runtime.run_skill_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "app.agents.crm_agent.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        r = asyncio.run(
            crm_agent.run(
                messages=[{"role": "user", "text": "Help me log a new activity"}],
                context={
                    "module": "activities",
                    "surface": "list",
                    "pathname": "/activities",
                },
                catalog={},
                organization_id="org1",
            )
        )
    assert r and r.get("ok")
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert (props[0].get("args") or {}).get("mode") == "create"
    speech = (r.get("assistantText") or "").strip().lower()
    assert speech
    assert "something went wrong" not in speech
    assert "who" in speech or "contact" in speech


def test_orchestrator_create_contact_uses_llm_speech() -> None:
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.agents import crm_agent

    ai_text = "Sure — what's the first name for this contact?"
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.coworker_runtime.run_skill_turn",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "assistantText": ai_text,
                "source": "ai",
                "toolProposals": [
                    {
                        "id": "ws-create",
                        "name": "set_workspace",
                        "label": "Create contact",
                        "args": {"mode": "create", "auto": True},
                        "risk": "low",
                    },
                ],
            },
        ),
        patch(
            "app.agents.crm_agent.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        r = asyncio.run(
            crm_agent.run(
                messages=[{"role": "user", "text": "Help me create a new contact"}],
                context={
                    "module": "contact",
                    "surface": "list",
                    "pathname": "/contact",
                },
                catalog={},
                organization_id="org1",
            )
        )
    assert r and r.get("ok")
    # Deterministic routing may intercept before the skill turn; either source is valid.
    assert r.get("source") in ("ai", "heuristic")
    speech = (r.get("assistantText") or "").strip()
    assert speech and "something went wrong" not in speech
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert (props[0].get("args") or {}).get("mode") == "create"


def test_orchestrator_create_contact_does_not_say_something_went_wrong() -> None:
    """Internal workspace speech must not surface as the generic error line."""
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.agents import crm_agent

    filled = "What's their full name?"

    async def _fake_route_speech(result, route, **kwargs):
        return {**result, "assistantText": filled, "source": "ai"}

    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.coworker_shared.should_commit_native_turn",
            return_value=True,
        ),
        patch(
            "app.agents.contact_coworker_agent.run",
            new_callable=AsyncMock,
            return_value={"_unhandled": True},
        ),
        patch(
            "app.agents.coworker_runtime.run_skill_turn",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "source": "ai",
                "assistantText": "I'll open create and pull in what you shared.",
                "toolProposals": [
                    {
                        "id": "ws-create",
                        "name": "set_workspace",
                        "label": "Create contact",
                        "args": {"mode": "create", "auto": True},
                        "risk": "low",
                    }
                ],
            },
        ),
        patch(
            "app.agents.crm_agent._ensure_llm_route_speech",
            new_callable=AsyncMock,
            side_effect=_fake_route_speech,
        ),
        patch(
            "app.agents.crm_agent.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        r = asyncio.run(
            crm_agent.run(
                messages=[{"role": "user", "text": "create contact"}],
                context={
                    "module": "contact",
                    "surface": "list",
                    "pathname": "/contact",
                },
                catalog={},
                organization_id="org1",
            )
        )
    assert r and r.get("ok")
    speech = (r.get("assistantText") or "").strip().lower()
    assert speech
    assert "something went wrong" not in speech


def test_orchestrator_draft_patch_without_speech_asks_llm() -> None:
    """Native patch_* with empty content must not stamp 'something went wrong'."""
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.agents import crm_agent

    filled = "Thanks Sivaji. What's the best email for them?"
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.coworker_runtime.run_skill_turn",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "source": "ai",
                "assistantText": "",
                "patch": {"firstName": "Sivaji", "lastName": "R"},
            },
        ),
        patch(
            "app.llm.generate_ai_text",
            new_callable=AsyncMock,
            return_value=filled,
        ),
        patch(
            "app.agents.crm_agent.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        r = asyncio.run(
            crm_agent.run(
                messages=[{"role": "user", "text": "sivaji R"}],
                context={
                    "module": "contact",
                    "surface": "create",
                    "pathname": "/contact",
                },
                catalog={"currentDraft": {"firstName": "", "lastName": ""}},
                organization_id="org1",
            )
        )
    assert r and r.get("ok")
    speech = (r.get("assistantText") or "").strip()
    assert "email" in speech.lower()
    assert "something went wrong" not in speech.lower()
    first = str((r.get("patch") or {}).get("firstName") or "")
    last = str((r.get("patch") or {}).get("lastName") or "")
    assert first.lower() == "sivaji"
    assert last.lower() == "r"


def test_go_to_contacts_while_already_there_still_acknowledges() -> None:
    """Bare navigation ack is fine — only show/list-all must clear filters."""
    from app.agents.crm_agent import resolve_go_to_module

    r = resolve_go_to_module("go to contacts", "contact")
    assert r and "already on" in r["assistantText"].lower()
    assert not (r.get("toolProposals") or [])

    assert resolve_go_to_module("Show all contacts", "contact") is None


# ── Conversational robustness: slang, repeats, declines, compound intents ────
# These lock in the "should not fail in any scenario, feel human" audit pass.

SLANG_DELETE_VERBS = ("nuke it", "yeet this", "wipe it out", "ditch this", "toss it", "scrap it")


def test_slang_delete_verbs_recognized_across_modules() -> None:
    cases = [
        (contacts_heuristic, DETAIL_CONTACT, "propose_delete_contact",
         {"contacts": [{"id": "c1", "displayName": "Priya"}]}),
        (deals_heuristic, DETAIL_DEAL, "propose_delete_deal",
         {"deals": [{"id": "d1", "title": "Acme Renewal"}]}),
        (companies_heuristic, DETAIL_COMPANY, "propose_delete_company",
         {"companies": [{"id": "co1", "name": "Acme"}]}),
        (products_heuristic, DETAIL_PRODUCT, "propose_delete_product",
         {"products": [{"id": "p1", "name": "Pro Plan"}]}),
    ]
    for heuristic, ctx, tool_name, catalog in cases:
        for phrase in SLANG_DELETE_VERBS:
            r = heuristic(phrase, ctx, catalog=catalog)
            assert r and r["ok"], (heuristic.__name__, phrase)
            props = r.get("toolProposals") or []
            assert props and props[0]["name"] == tool_name, (heuristic.__name__, phrase)


def test_delete_confirm_accepts_softened_and_repeated_affirmatives() -> None:
    pending = [{"role": "assistant", "text": "I found **Priya Nair**. Want me to remove it permanently?"}]
    catalog = {"contacts": [{"id": "c1", "displayName": "Priya Nair"}]}
    for phrase in ("yes yes yes", "yes please do it", "yeah go for it", "confirm it", "sure thing", "go ahead", "do it"):
        r = contacts_heuristic(phrase, DETAIL_CONTACT, messages=pending, catalog=catalog)
        assert r and r["ok"], phrase
        props = r.get("toolProposals") or []
        assert props and props[0]["name"] == "propose_delete_contact", phrase


def test_delete_confirm_accepts_llm_style_prompt_phrasing() -> None:
    """LLM confirm copy varies — heuristic must still execute on yes."""
    catalog = {"openContact": {"id": "c1", "displayName": "Fathima tEST"}}
    llm_prompts = (
        "Just to be safe before I remove them — you do want to permanently delete this contact? That can't be undone.",
        "Just to be sure — you'd like me to permanently delete this contact? That can't be undone, so I want your go-ahead first.",
        "Want your go-ahead before I permanently delete this contact.",
    )
    for prompt in llm_prompts:
        pending = [{"role": "assistant", "text": prompt}]
        for phrase in ("yes", "YES", "go ahead"):
            r = contacts_heuristic(phrase, DETAIL_CONTACT, messages=pending, catalog=catalog)
            assert r and r["ok"], (prompt, phrase)
            props = r.get("toolProposals") or []
            assert props and props[0]["name"] == "propose_delete_contact", (prompt, phrase)
            assert props[0]["args"]["contactId"] == "c1", (prompt, phrase)
            assert props[0]["args"]["auto"] is True, (prompt, phrase)


def test_delete_confirm_declines_gracefully_without_deleting() -> None:
    pending = [{"role": "assistant", "text": "I found **Priya Nair**. Want me to remove it permanently?"}]
    catalog = {"contacts": [{"id": "c1", "displayName": "Priya Nair"}]}
    for phrase in ("no", "no don't", "wait no", "actually no, cancel that", "nah", "cancel that"):
        r = contacts_heuristic(phrase, DETAIL_CONTACT, messages=pending, catalog=catalog)
        assert r and r["ok"], phrase
        props = r.get("toolProposals") or []
        assert not props, phrase
        assert "won't delete" in r["assistantText"].lower(), phrase
        assert "priya" in r["assistantText"].lower(), phrase


def test_field_offer_decline_leaves_record_unchanged() -> None:
    pending = [{"role": "assistant", "text": "Want me to set the country to **India**?"}]
    r = contacts_heuristic(
        "no, leave it",
        DETAIL_CONTACT,
        messages=pending,
        catalog={"openContact": {"id": "c1", "displayName": "Priya"}},
    )
    assert r and r["ok"]
    assert not (r.get("toolProposals") or [])
    assert "leave that as is" in r["assistantText"].lower()


def test_compound_delete_and_create_asks_instead_of_guessing() -> None:
    cases = [
        (contacts_heuristic, DETAIL_CONTACT, "delete this and also create a new contact",
         {"openContact": {"id": "c1", "displayName": "Priya"}}),
        (deals_heuristic, DETAIL_DEAL, "update the amount and then delete it",
         {"deals": [{"id": "d1", "title": "Acme Renewal"}]}),
        (companies_heuristic, DETAIL_COMPANY, "delete this and also create a new company",
         {"openCompany": {"id": "co1", "name": "Acme"}}),
        (products_heuristic, DETAIL_PRODUCT, "nuke this and create a new product",
         {"products": [{"id": "p1", "name": "Pro Plan"}]}),
    ]
    for heuristic, ctx, phrase, catalog in cases:
        r = heuristic(phrase, ctx, catalog=catalog)
        assert r and r["ok"], phrase
        assert not (r.get("toolProposals") or []), phrase
        assert "more than one" in r["assistantText"].lower(), phrase


def test_plain_delete_still_works_after_compound_guard() -> None:
    r = contacts_heuristic(
        "delete this contact",
        DETAIL_CONTACT,
        catalog={"openContact": {"id": "c1", "displayName": "Priya"}},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_delete_contact"


def test_multi_field_update_in_one_message_does_not_bleed_between_fields() -> None:
    r = contacts_heuristic(
        "change title to CEO and email to a@b.com",
        DETAIL_CONTACT,
        catalog={"openContact": {"id": "c1", "displayName": "Priya"}},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_contact"
    args = props[0]["args"]
    assert args["title"] == "CEO", args
    assert args["email"] == "a@b.com", args


def test_deal_multi_field_update_does_not_bleed_between_fields() -> None:
    r = deals_heuristic(
        "change title to Big Deal and amount to 5000",
        DETAIL_DEAL,
        catalog={"deals": [{"id": "d1", "title": "Renewal"}]},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_deal"
    args = props[0]["args"]
    assert args["title"] == "Big Deal", args
    assert args["amount"] == "5000", args


def test_company_multi_field_update_does_not_bleed_between_fields() -> None:
    r = companies_heuristic(
        "change industry to SaaS and domain to acme.io",
        DETAIL_COMPANY,
        catalog={"openCompany": {"id": "co1", "name": "Acme"}},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_company"
    args = props[0]["args"]
    assert args["industry"] == "SaaS", args
    assert args["domain"] == "acme.io", args


def test_product_multi_field_update_does_not_bleed_between_fields() -> None:
    r = products_heuristic(
        "change name to Pro Max and price to 199",
        DETAIL_PRODUCT,
        catalog={"products": [{"id": "p1", "name": "Pro Plan"}]},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_product"
    args = props[0]["args"]
    assert args["name"] == "Pro Max", args
    assert args["price"] == "199", args


def test_no_crashes_on_hostile_or_edge_case_input_across_modules() -> None:
    hostile = [
        "", "   ", ".", "?", "...", "'; DROP TABLE contacts; --",
        "<script>alert(1)</script>", "{{7*7}}", "../../etc/passwd",
        "删除这个联系人", "🤔 not sure what to do", "d e l e t e",
        "A" * 5000,
    ]
    cases = [
        (contacts_heuristic, DETAIL_CONTACT, {"openContact": {"id": "c1", "displayName": "Priya"}}),
        (deals_heuristic, DETAIL_DEAL, {"deals": [{"id": "d1", "title": "Renewal"}]}),
        (companies_heuristic, DETAIL_COMPANY, {"openCompany": {"id": "co1", "name": "Acme"}}),
        (products_heuristic, DETAIL_PRODUCT, {"products": [{"id": "p1", "name": "Pro Plan"}]}),
    ]
    for heuristic, ctx, catalog in cases:
        for phrase in hostile:
            r = heuristic(phrase, ctx, catalog=catalog)
            # Either a friendly None (hand off to LLM layer) or a well-formed dict — never a crash.
            if r is not None:
                assert isinstance(r, dict)
                assert r.get("ok") is not False or "error" in r

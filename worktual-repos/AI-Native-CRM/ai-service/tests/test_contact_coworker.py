"""Contact co-worker intent routing — create vs edit vs search."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.contact_coworker_agent import (
    _wants_create,
    _wants_edit,
    _wants_import,
    contacts_heuristic,
    resolve_contact_match,
)


def test_want_to_edit_is_not_create():
    assert _wants_edit("i want to edit contact")
    assert not _wants_create("i want to edit contact")
    assert not _wants_create("i want to edit")
    assert not _wants_create("edit contact")


def test_create_phrases_still_match():
    assert _wants_create("create a new contact")
    assert _wants_create("help me create a contact")
    assert _wants_create("add a contact")
    assert _wants_create("insert contact")
    assert not _wants_create("i want to edit contact")
    assert not _wants_create("import contacts from csv")


def test_import_csv_shows_instructions_link():
    assert _wants_import("import contacts from csv")
    assert _wants_import("give me a sample csv template")
    assert _wants_import("import this sample")
    assert not _wants_import("import 1 lead from zoominfo")
    assert not _wants_import("pull 5 leads from apollo")
    assert not _wants_create("import contacts from csv")
    assert not _wants_create("import this sample")
    r = contacts_heuristic(
        "Import contacts from CSV",
        {"module": "contact", "surface": "list"},
    )
    assert r and r["ok"]
    assert not (r.get("toolProposals") or [])
    speech = r.get("assistantText") or ""
    lower = speech.lower()
    assert "csv instructions" in lower
    assert "[CSV Instructions](/api/contacts/import/sample)" in speech
    assert "upload it now" in lower
    assert "first_name,last_name" not in lower
    assert "do you have" not in lower
    assert "would you like" not in lower


def test_sample_csv_loads_template():
    r = contacts_heuristic(
        "give me the sample csv format",
        {"module": "contact", "surface": "list"},
    )
    assert r and r["ok"]
    assert not (r.get("toolProposals") or [])
    assert "[CSV Instructions](/api/contacts/import/sample)" in (r.get("assistantText") or "")


def test_yes_after_instructions_asks_for_file():
    r = contacts_heuristic(
        "yes",
        {"module": "contact", "surface": "list"},
        messages=[
            {"role": "user", "text": "Import contacts from CSV"},
            {
                "role": "assistant",
                "text": (
                    "Great! To onboard multiple users efficiently, please upload a CSV file "
                    "following the required format. You can download the template and instructions "
                    "here: [CSV Instructions](/api/contacts/import/sample).\n\n"
                    "Once you've prepared the file, you can upload it now."
                ),
            },
            {"role": "user", "text": "yes"},
        ],
    )
    assert r and r["ok"]
    assert not (r.get("toolProposals") or [])
    assert "attach" in (r.get("assistantText") or "").lower()


def test_import_this_sample_proposes_import():
    r = contacts_heuristic(
        "import this sample",
        {"module": "contact", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_import_contacts"
    assert props[0]["args"].get("auto") is True
    assert props[0]["args"].get("sample") is True


def test_pasted_csv_passes_csv_text():
    pasted = (
        "first_name,last_name,email\n"
        "Priya,Nair,priya.nair@acme.com\n"
    )
    r = contacts_heuristic(pasted, {"module": "contact", "surface": "list"})
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_import_contacts"
    assert "priya.nair@acme.com" in (props[0]["args"].get("csvText") or "")


def test_attached_csv_with_intro_extracts_body():
    pasted = (
        "Import attached CSV (leads.csv)\n\n"
        "first_name,last_name,email\n"
        "Priya,Nair,priya.nair@acme.com\n"
    )
    r = contacts_heuristic(pasted, {"module": "contact", "surface": "list"})
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_import_contacts"
    assert "priya.nair@acme.com" in (props[0]["args"].get("csvText") or "")
    assert "Import attached" not in (props[0]["args"].get("csvText") or "")


def test_spaced_csv_headers_extract():
    pasted = (
        "First Name,Last Name,Email\n"
        "Hansa,Solanki,connect.hansasolanki@gmail.com\n"
    )
    r = contacts_heuristic(pasted, {"module": "contact", "surface": "list"})
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_import_contacts"
    assert "connect.hansasolanki@gmail.com" in (props[0]["args"].get("csvText") or "")


def test_bulk_import_phrase_shows_instructions_not_create():
    r = contacts_heuristic(
        "bulk import contacts",
        {"module": "contact", "surface": "list"},
    )
    assert r and r["ok"]
    assert not (r.get("toolProposals") or [])
    assert "csv instructions" in (r.get("assistantText") or "").lower()


def test_add_field_is_update_not_create():
    assert _wants_edit("add a phone number")
    assert not _wants_create("add a phone number")
    assert _wants_edit("add an email")
    assert not _wants_create("add an email")
    assert _wants_edit("add a title")
    assert not _wants_create("add a title")
    assert _wants_create("create a contact")
    r = contacts_heuristic(
        "add a phone number",
        {"module": "contact", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )
    assert "contact" in r["assistantText"].lower()


def test_insert_contact_opens_create():
    r = contacts_heuristic(
        "insert contact",
        {"module": "contact", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "create"
    assert "working on that" not in r["assistantText"].lower()
    assert "open create" not in r["assistantText"].lower()
    assert "how many" not in r["assistantText"].lower()
    assert "name" in r["assistantText"].lower()


def test_edit_asks_which_contact():
    r = contacts_heuristic("i want to edit contact", {"module": "contact", "surface": "list"})
    assert r and r["ok"]
    assert "which contact" in r["assistantText"].lower()
    assert not r.get("toolProposals")


def test_edit_with_name_opens_unique_match():
    catalog = {
        "contacts": [
            {
                "id": "c1",
                "displayName": "Fazil Mohammad",
                "email": "m.shajahan@worktual.com",
            }
        ]
    }
    r = contacts_heuristic(
        "edit contact fazil",
        {"module": "contact", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "detail"
    assert props[0]["args"]["entityId"] == "c1"
    assert "click" not in r["assistantText"].lower()
    assert "list" not in r["assistantText"].lower() or "opening" in r["assistantText"].lower()


def test_ambiguous_name_filters_list():
    catalog = {
        "contacts": [
            {"id": "c1", "displayName": "Alex Kim", "email": "a@x.com"},
            {"id": "c2", "displayName": "Alex Lee", "email": "b@x.com"},
        ]
    }
    r = contacts_heuristic(
        "edit alex",
        {"module": "contact", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["args"]["mode"] == "list"
    assert props[0]["args"]["search"] == "alex"


def test_followup_name_opens_match():
    catalog = {
        "contacts": [
            {
                "id": "c1",
                "displayName": "Fazil Mohammad",
                "email": "m.shajahan@worktual.com",
            }
        ]
    }
    messages = [
        {"role": "user", "text": "edit contact"},
        {
            "role": "assistant",
            "text": "Which contact should we open? Share a name or email and I'll find them.",
        },
        {"role": "user", "text": "fazil"},
    ]
    r = contacts_heuristic(
        "fazil",
        {"module": "contact", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["args"]["mode"] == "detail"
    assert props[0]["args"]["entityId"] == "c1"
    assert "fazil" in r["assistantText"].lower()


def test_resolve_first_name_match():
    hit = resolve_contact_match(
        {
            "contacts": [
                {"id": "c1", "displayName": "Fazil Mohammad", "email": "a@b.com"}
            ]
        },
        "fazil",
    )
    assert hit and hit["id"] == "c1"


def test_find_by_email_opens_catalog_display_name_not_guessed_name():
    catalog = {
        "contacts": [
            {
                "id": "c1",
                "displayName": "Rusell",
                "email": "divyaprasathrs@gmail.com",
            }
        ]
    }
    r = contacts_heuristic(
        "find divyaprasathrs@gmail.com",
        {"module": "contact", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "Rusell" in r["assistantText"]
    assert "divya" not in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props[0]["args"]["mode"] == "detail"
    assert props[0]["args"]["entityId"] == "c1"


def test_find_by_email_filters_without_guessing_name_when_no_match():
    r = contacts_heuristic(
        "find divyaprasathrs@gmail.com",
        {"module": "contact", "surface": "list"},
        catalog={"contacts": []},
    )
    assert r and r["ok"]
    assert "divyaprasathrs@gmail.com" in r["assistantText"]
    assert "divya" not in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props[0]["args"]["search"] == "divyaprasathrs@gmail.com"


def test_detail_title_update_is_conversational():
    r = contacts_heuristic(
        "title as Team Leader",
        {
            "module": "contact",
            "surface": "detail",
            "entityId": "c1",
        },
    )
    assert r and r["ok"]
    assert "on it" not in r["assistantText"].lower()
    assert "team leader" in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_update_contact"
    assert props[0]["args"]["title"] == "Team Leader"
    assert props[0]["args"]["auto"] is True
    assert props[0]["args"]["contactId"] == "c1"


def test_delete_asks_which_contact():
    r = contacts_heuristic("delete contact", {"module": "contact", "surface": "list"})
    assert r and r["ok"]
    assert "which contact" in r["assistantText"].lower()
    assert "delete" in r["assistantText"].lower()
    assert not r.get("toolProposals")


def test_delete_followup_opens_for_confirm():
    catalog = {
        "contacts": [
            {
                "id": "c1",
                "displayName": "Ashika A",
                "email": "ashika@example.com",
            }
        ]
    }
    messages = [
        {"role": "user", "text": "delete contact"},
        {
            "role": "assistant",
            "text": "Which contact would you like to delete? Share a name or email.",
        },
        {"role": "user", "text": "ashika"},
    ]
    r = contacts_heuristic(
        "ashika",
        {"module": "contact", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "remove" in r["assistantText"].lower()
    assert "opening" not in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "detail"
    assert props[0]["args"]["entityId"] == "c1"


def test_delete_this_contact_on_detail_executes():
    catalog = {
        "contacts": [{"id": "c1", "displayName": "Ashika A", "email": "a@b.com"}]
    }
    messages = [
        {
            "role": "assistant",
            "text": "I found **Ashika A**. Want me to remove them permanently?",
        },
        {"role": "user", "text": "delete this contact"},
    ]
    r = contacts_heuristic(
        "delete this contact",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_delete_contact"
    assert props[0]["args"]["contactId"] == "c1"
    assert props[0]["args"]["auto"] is True


def test_delete_this_contact_after_update_uses_open_entity():
    """Regression: after an update, 'delete this contact' must not search the list."""
    from app.agents.contact_coworker_agent import extract_delete_query

    assert extract_delete_query("delete this contact") is None
    catalog = {
        "openContact": {
            "id": "c1",
            "displayName": "rajadhurai anamalai",
            "email": "rajadhurai@gmail.com",
        },
        "contacts": [
            {
                "id": "c1",
                "displayName": "rajadhurai anamalai",
                "email": "rajadhurai@gmail.com",
            }
        ],
    }
    messages = [
        {
            "role": "assistant",
            "text": "Sure — I'll update the company industry to **IT** now.",
        },
        {"role": "assistant", "text": "Updated — that's saved."},
        {"role": "user", "text": "delete this contact"},
    ]
    r = contacts_heuristic(
        "delete this contact",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "match" not in r["assistantText"].lower()
    assert "filtered" not in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props
    assert props[0]["name"] == "propose_delete_contact"
    assert props[0]["args"]["contactId"] == "c1"
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("search")
        for p in props
    )


def test_memory_first_delete_without_this_keyword():
    """Open entity memory owns who — no need to say 'this contact'."""
    catalog = {
        "openContact": {"id": "c1", "displayName": "Raj A"},
    }
    ctx = {"module": "contact", "surface": "detail", "entityId": "c1"}
    for phrase in (
        "delete",
        "remove them",
        "get rid of him",
        "trash it",
        "erase the person",
    ):
        r = contacts_heuristic(phrase, ctx, catalog=catalog)
        assert r and r["ok"], phrase
        props = r.get("toolProposals") or []
        assert props and props[0]["name"] == "propose_delete_contact", phrase
        assert props[0]["args"]["contactId"] == "c1", phrase
        assert "match" not in r["assistantText"].lower(), phrase


def test_memory_first_named_other_still_searches():
    catalog = {
        "openContact": {"id": "c1", "displayName": "Raj A"},
        "contacts": [
            {"id": "c1", "displayName": "Raj A", "email": "r@x.com"},
            {"id": "c2", "displayName": "Ashika A", "email": "a@b.com"},
        ],
    }
    r = contacts_heuristic(
        "delete Ashika",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        catalog=catalog,
    )
    assert r and r["ok"]
    # Should target Ashika (confirm/open), not silently delete open Raj
    props = r.get("toolProposals") or []
    assert props
    if props[0]["name"] == "propose_delete_contact":
        assert props[0]["args"]["contactId"] == "c2"
    else:
        assert props[0]["name"] == "set_workspace"
        assert props[0]["args"].get("entityId") == "c2" or props[0]["args"].get(
            "search"
        )


def test_memory_first_about_without_this_keyword():
    catalog = {
        "openContact": {
            "id": "c1",
            "displayName": "Raj A",
            "email": "r@x.com",
            "title": "Dev",
        }
    }
    r = contacts_heuristic(
        "tell about the person",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "raj" in r["assistantText"].lower()
    assert "match" not in r["assistantText"].lower()


def test_delete_named_contact_asks_confirm():
    catalog = {
        "contacts": [{"id": "c1", "displayName": "Ashika A", "email": "a@b.com"}]
    }
    r = contacts_heuristic(
        "delete ashika",
        {"module": "contact", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "set_workspace"
    assert props[0]["args"]["entityId"] == "c1"
    assert "want me to remove" in r["assistantText"].lower()
    assert "ashika" in r["assistantText"].lower()


def test_parse_title_and_email():
    from app.agents.draft_conversation import parse_contact_field_update

    assert parse_contact_field_update("title as Team Leader") == {
        "title": "Team Leader"
    }
    assert parse_contact_field_update("email to a@b.com") == {"email": "a@b.com"}
    assert parse_contact_field_update("change job title as product lead") == {
        "title": "product lead"
    }


def test_parse_pending_job_title_save_confirm():
    from app.agents.draft_conversation import (
        parse_pending_contact_field_offer,
        pending_contact_field_from_messages,
    )

    asst = (
        "I've got Ravi's record open and set his job title to Product Lead "
        "— shall I save that change?"
    )
    assert parse_pending_contact_field_offer(asst) == {"title": "Product Lead"}
    msgs = [
        {"role": "user", "text": "change job title as product lead"},
        {"role": "assistant", "text": asst},
        {"role": "user", "text": "yes"},
    ]
    assert pending_contact_field_from_messages(msgs) == {"title": "Product Lead"}


def test_ready_create_is_human_and_confirms_naturally():
    from app.agents.draft_conversation import (
        contact_draft_ready,
        contact_draft_save_ready,
        looks_like_create_confirm,
        next_contact_prompt,
        ready_create_chat,
    )

    assert not contact_draft_ready(
        {"firstName": "Ashika", "email": "a@b.com"}
    )
    assert contact_draft_ready(
        {"firstName": "Ashika", "lastName": "A"}
    )
    assert contact_draft_ready(
        {"firstName": "Ashika", "lastName": "A", "email": "a@b.com"}
    )
    assert not contact_draft_save_ready(
        {"firstName": "Mahalingam", "lastName": "M"},
        "b2b",
    )
    assert contact_draft_save_ready(
        {
            "firstName": "Mahalingam",
            "lastName": "M",
            "email": "maha@gmail.com",
        },
        "b2b",
    )
    assert contact_draft_save_ready(
        {"firstName": "Mahalingam", "lastName": "M", "phone": "+919876543210"},
        "b2b",
    )
    ask_last = next_contact_prompt({"firstName": "Ashika"})
    assert "last name" in ask_last.lower()

    prompt = ready_create_chat(
        {"firstName": "Priya", "lastName": "Shah", "email": "priya@acme.com"}
    )
    assert "shall i save" in prompt.lower()
    assert "say **create**" not in prompt.lower()
    assert "type" not in prompt.lower()
    assert "skip" not in prompt.lower()
    from app.agents.draft_conversation import TONE_RULES

    assert "form labels" in TONE_RULES.lower() or "Email:" in TONE_RULES
    assert "say skip" in TONE_RULES.lower() or "type yes" in TONE_RULES.lower()
    assert looks_like_create_confirm("yes")
    assert looks_like_create_confirm("save them now")
    assert looks_like_create_confirm("save contact")
    assert looks_like_create_confirm("go ahead")
    assert looks_like_create_confirm("save anyway")
    assert looks_like_create_confirm("continue anyway")
    assert not looks_like_create_confirm("create contact")
    assert not looks_like_create_confirm("new contact")
    assert not looks_like_create_confirm("priya@acme.com")


def test_skip_last_name_is_optional():
    from app.agents.contact_draft_agent import heuristic

    r = heuristic("skip", [], {"firstName": "Ashika"})
    assert "lastName" in str(r.get("patch", {}).get("skippedOptional") or "")
    assert not r.get("toolProposals")


def test_use_first_name_as_last():
    from app.agents.contact_draft_agent import heuristic

    r = heuristic("use Ashika", [], {"firstName": "Ashika"})
    assert r.get("patch", {}).get("lastName") == "Ashika"


def test_confirm_without_last_name_does_not_speak_statically():
    from app.agents.contact_draft_agent import heuristic

    r = heuristic(
        "ok",
        [],
        {"firstName": "Ashika", "email": "ashika@gmail.com"},
    )
    assert not r.get("assistantText")
    assert not r.get("toolProposals")


def test_email_while_missing_last_still_patches():
    from app.agents.contact_draft_agent import heuristic

    r = heuristic(
        "ashika@gmail.com",
        [],
        {"firstName": "Ashika"},
    )
    assert r.get("patch", {}).get("email") == "ashika@gmail.com"
    assert not r.get("assistantText")


def test_bare_phone_digits_patch_contact_draft():
    from app.agents.contact_draft_agent import heuristic

    r = heuristic(
        "9876543210",
        [],
        {
            "firstName": "Yaswanth",
            "lastName": "M G",
            "email": "manojnlp04@gmail.com",
        },
    )
    assert r.get("patch", {}).get("phone") == "9876543210"


def test_full_name_together_sets_first_and_last():
    from app.agents.contact_draft_agent import heuristic, parse_name_from_text

    assert parse_name_from_text("Manoj M") == {
        "firstName": "Manoj",
        "lastName": "M",
    }
    assert parse_name_from_text("Manoj Sharma") == {
        "firstName": "Manoj",
        "lastName": "Sharma",
    }
    r = heuristic("Manoj Sharma", [], {})
    assert r["patch"]["firstName"] == "Manoj"
    assert r["patch"]["lastName"] == "Sharma"
    r2 = heuristic("Manoj M", [], {"firstName": "Manoj"})
    assert r2["patch"]["lastName"] == "M"
    assert r2["patch"]["firstName"] == "Manoj"


def test_deferral_is_not_a_first_name():
    from app.agents.contact_draft_agent import (
        heuristic,
        looks_like_deferral,
        parse_name_from_text,
    )

    phrase = "i will add the contact later"
    assert looks_like_deferral(phrase)
    assert parse_name_from_text(phrase) == {}
    r = heuristic(phrase, [], {})
    assert not (r.get("patch") or {}).get("firstName")
    assert not (r.get("patch") or {}).get("lastName")

    from app.agents.contact_draft_agent import enrich_contact_draft_result

    stripped = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "I'll hold off on the contact for now.",
        },
        user_text=phrase,
        companies=[],
        draft={},
    )
    assert not (stripped.get("patch") or {}).get("firstName")
    # Still extract a real name from a create dump.
    assert parse_name_from_text("Priya Sharma") == {
        "firstName": "Priya",
        "lastName": "Sharma",
    }


def test_enrich_drops_contact_patch_when_navigating_to_company():
    from app.agents.contact_draft_agent import enrich_contact_draft_result

    out = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "I'll hold the contact and set up Lyca as a company.",
            "patch": {"companyName": "lyca"},
            "toolProposals": [
                {
                    "name": "navigate",
                    "label": "Create company",
                    "args": {"href": "/company/new", "seedPrompt": "Lyca", "auto": True},
                }
            ],
        },
        user_text="lyca",
        companies=[],
        draft={},
    )
    assert not (out.get("patch") or {}).get("companyName")
    assert not out.get("contactDraftPatch")
    nav = [
        t
        for t in (out.get("toolProposals") or [])
        if t.get("name") == "navigate"
    ]
    assert nav
    assert (nav[0].get("args") or {}).get("href") == "/company/new"


def test_draft_json_navigate_parses_company_create():
    from app.agents.coworker_shared import draft_navigate_tools_from_llm

    tools = draft_navigate_tools_from_llm(
        {"navigate": {"href": "/company/new", "seedPrompt": "Lyca"}},
        user_text="lyca",
    )
    assert tools
    assert tools[0]["name"] == "navigate"
    assert tools[0]["args"]["href"] == "/company/new"
    assert tools[0]["args"]["seedPrompt"] == "Lyca"


def test_greetings_are_not_contact_names():
    from app.agents.contact_draft_agent import (
        heuristic,
        parse_name_from_text,
        sanitize,
    )

    for phrase in ("hi", "hello", "hey", "Hi!", "good morning", "thanks"):
        assert parse_name_from_text(phrase) == {}
        r = heuristic(phrase, [], {})
        assert not (r.get("patch") or {}).get("firstName")
        assert not (r.get("patch") or {}).get("lastName")

    # Greeting while awaiting last name must not fill lastName
    r2 = heuristic("hello", [], {"firstName": "Priya"})
    assert not (r2.get("patch") or {}).get("lastName")

    # LLM-shaped greeting patches are stripped in sanitize
    cleaned = sanitize(
        {"firstName": "Hi", "lastName": "Hello", "email": "a@b.com"},
        [],
    )
    assert cleaned is not None
    assert "firstName" not in cleaned
    assert "lastName" not in cleaned
    assert cleaned.get("email") == "a@b.com"


def test_typed_company_accepted_without_catalog_or_meta():
    from app.agents.contact_draft_agent import heuristic

    draft = {
        "firstName": "Manoj",
        "lastName": "M",
        "email": "manojnlp04@gmail.com",
    }
    catalog = [
        {"id": "co1", "name": "worktual"},
        {"id": "co2", "name": "Zoho"},
    ]
    r = heuristic("TCS", catalog, draft)
    assert r["patch"]["companyName"] == "TCS"
    assert "companyId" not in r["patch"]

    r2 = heuristic("new company", catalog, {**draft, "companyName": "TCS"})
    assert not (r2.get("patch") or {}).get("companyName") == "new company"
    assert "companyId" not in (r2.get("patch") or {})


def test_bare_city_after_location_prompt_patches_city():
    from app.agents.contact_draft_agent import heuristic

    r = heuristic(
        "chennai",
        [],
        {
            "firstName": "Yaswanth",
            "lastName": "M G",
            "email": "manojnlp04@gmail.com",
            "companyName": "TCS",
        },
        prior_assistant="Added TCS as the company name. Would you like to specify a location?",
    )
    assert r.get("patch", {}).get("city", "").lower() == "chennai"
    assert "title" not in (r.get("patch") or {})


def test_enrich_does_not_merge_heuristic_when_llm_succeeded():
    from app.agents.contact_draft_agent import enrich_contact_draft_result

    out = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "Got it — phone added.",
        },
        user_text="9876543210",
        companies=[],
        draft={
            "firstName": "Yaswanth",
            "lastName": "M G",
            "email": "a@b.com",
        },
    )
    # LLM owns field collection — do not regex-fill a missing patch.
    assert not (out.get("patch") or {}).get("phone")

    greeting = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "What's their full name?",
            "patch": {"firstName": "Hi", "lastName": "Hello"},
        },
        user_text="hello",
        companies=[],
        draft={},
    )
    assert not (greeting.get("patch") or {}).get("firstName")
    assert not (greeting.get("patch") or {}).get("lastName")

    greeting = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "What's their full name?",
            "patch": {"firstName": "Hi", "lastName": "Hello"},
        },
        user_text="hello",
        companies=[],
        draft={},
    )
    assert not (greeting.get("patch") or {}).get("firstName")
    assert not (greeting.get("patch") or {}).get("lastName")


def test_enrich_does_not_gap_fill_email_when_llm_speech_only():
    """LLM speech without a patch must not regex-collect the email."""
    from app.agents.contact_draft_agent import enrich_contact_draft_result

    out = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "Got it, thanks! And what's the best phone number for Yaswanth?",
        },
        user_text="yaswanthmg1@gmail.com",
        companies=[],
        draft={"firstName": "Yaswanth", "lastName": "M G"},
    )
    assert not (out.get("patch") or {}).get("email")


def test_enrich_does_not_gap_fill_oneshot_create_dump_when_llm_speech_only():
    """LLM acknowledgment without a patch must not invent draft fields."""
    from app.agents.contact_draft_agent import enrich_contact_draft_result

    user = (
        "yaswanth M G, yaswanthmg1@gmail.com, company = Netflix, title = Developer"
    )
    out = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": (
                "Got it — creating a new contact for Yaswanth M G from Netflix "
                "with the Developer title. Ready to save when you are!"
            ),
        },
        user_text=user,
        companies=[],
        draft={},
    )
    patch = out.get("patch") or {}
    assert not patch.get("firstName")
    assert not patch.get("email")
    assert not patch.get("companyName")


def test_enrich_records_phone_skip_from_llm_patch_only():
    from app.agents.contact_draft_agent import enrich_contact_draft_result

    skipped = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "No worries. Does Hansa work at a company?",
            "patch": {"skippedOptional": "phone"},
        },
        user_text="skip",
        companies=[],
        draft={
            "firstName": "Hansa",
            "lastName": "Solanki",
            "email": "hansa14solanki@gmail.com",
        },
        messages=[
            {
                "role": "assistant",
                "text": "Got it, thanks! What's the best phone number to reach Hansa?",
            },
            {"role": "user", "text": "skip"},
        ],
    )
    assert "phone" in str((skipped.get("patch") or {}).get("skippedOptional") or "")
    stm = skipped.get("sessionMemoryPatch") or {}
    assert stm.get("pendingAsk") == "contact_company"
    assert "phone" in str((stm.get("slots") or {}).get("skippedOptional") or "")

    reask = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "Got it, thanks! And what's the best phone number to reach Hansa?",
            "patch": {"companyName": "infosys", "title": "product manager"},
        },
        user_text="infosys, product manager",
        companies=[],
        draft={
            "firstName": "Hansa",
            "lastName": "Solanki",
            "email": "hansa14solanki@gmail.com",
            "skippedOptional": "phone",
        },
        messages=[
            {
                "role": "assistant",
                "text": "Does Hansa work at a company, and if so, what's the company name?",
            },
            {"role": "user", "text": "infosys, product manager"},
        ],
        session_memory={
            "pendingIntent": "create_contact",
            "pendingAsk": "contact_company",
            "slots": {"skippedOptional": "phone", "createModule": "contact"},
        },
    )
    speech = (reask.get("assistantText") or "").lower()
    assert "phone" not in speech
    assert "mailing" not in speech
    assert (reask.get("sessionMemoryPatch") or {}).get("pendingAsk") == "contact_city"


def test_skip_uses_stm_pending_ask_without_assistant_text():
    from app.agents.contact_draft_agent import enrich_contact_draft_result

    out = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "Got it.",
            "patch": {"skippedOptional": "phone"},
        },
        user_text="skip",
        companies=[],
        draft={
            "firstName": "Hansa",
            "lastName": "Solanki",
            "email": "hansa@x.com",
        },
        messages=[{"role": "user", "text": "skip"}],
        session_memory={
            "pendingIntent": "create_contact",
            "pendingAsk": "contact_phone",
            "slots": {"createModule": "contact"},
        },
    )
    assert "phone" in str((out.get("patch") or {}).get("skippedOptional") or "")
    assert (out.get("sessionMemoryPatch") or {}).get("pendingAsk") == "contact_company"


def test_hydrate_skipped_from_stm_when_draft_missing():
    from app.agents.contact_draft_agent import enrich_contact_draft_result

    out = enrich_contact_draft_result(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "What's Hansa's phone number?",
            "patch": {"companyName": "Infosys"},
        },
        user_text="Infosys",
        companies=[],
        draft={
            "firstName": "Hansa",
            "lastName": "Solanki",
            "email": "hansa@x.com",
        },
        session_memory={
            "pendingAsk": "contact_company",
            "slots": {"skippedOptional": "phone"},
        },
    )
    speech = (out.get("assistantText") or "").lower()
    assert "phone" not in speech
    assert "phone" in str(
        (out.get("sessionMemoryPatch") or {}).get("slots", {}).get("skippedOptional")
        or ""
    )
    # Skip flag must also be re-emitted on the draft patch for the UI.
    assert "phone" in str((out.get("patch") or {}).get("skippedOptional") or "")


def test_contact_ready_with_phone_only():
    from app.agents.draft_conversation import (
        contact_draft_ready,
        contact_next_ask_key,
    )

    phone_only = {
        "firstName": "Hansa",
        "lastName": "Solanki",
        "phone": "919876543210",
    }
    assert contact_draft_ready(phone_only)
    assert contact_next_ask_key(phone_only) in {
        "email",
        "company",
        "title",
        "city",
        "country",
        "save",
    }

    name_only = {
        "firstName": "Hansa",
        "lastName": "Solanki",
        "skippedOptional": "email",
    }
    assert contact_draft_ready(name_only)
    assert contact_next_ask_key(name_only) == "phone"

    email_only = {
        "firstName": "Hansa",
        "lastName": "Solanki",
        "email": "hansa@x.com",
        "skippedOptional": "phone,company,title,city,country",
    }
    assert contact_draft_ready(email_only)
    assert contact_next_ask_key(email_only) == "save"


def test_skip_optional_does_not_speak_statically():
    from app.agents.contact_draft_agent import heuristic

    r = heuristic(
        "skip",
        [],
        {
            "firstName": "Ashika",
            "lastName": "K",
            "email": "a@b.com",
        },
    )
    assert not r.get("assistantText")


def test_native_detail_field_heuristic_fallback():
    from app.agents.coworker_native import _detail_field_heuristic_fallback

    out = _detail_field_heuristic_fallback(
        agent_name="contact-agent",
        entity_id="CDP-test",
        field_hint={"lastName": "S"},
        detail_update_tool="propose_update_contact",
        catalog={"openContact": {"displayName": "Ravanan R"}},
    )
    assert out is not None
    prop, speech = out
    assert prop["name"] == "propose_update_contact"
    assert prop["args"]["lastName"] == "S"
    assert prop["args"]["contactId"] == "CDP-test"
    assert "last name" in speech.lower()


def test_skip_phone_when_email_skipped_is_mandatory():
    from app.agents.contact_draft_agent import heuristic

    r = heuristic(
        "skip",
        ["What's their phone number?"],
        {
            "firstName": "Ashika",
            "lastName": "K",
            "skippedOptional": "email",
        },
    )
    assert "mandatory" in str(r.get("assistantText") or "").lower()
    assert not r.get("patch")


def test_parse_country_and_typo():
    from app.agents.draft_conversation import parse_contact_field_update

    assert parse_contact_field_update("country India") == {"country": "India"}
    assert parse_contact_field_update("coutry india") == {"country": "india"}
    assert parse_contact_field_update("update cuntry as india") == {
        "country": "india"
    }
    assert parse_contact_field_update("city as Chennai") == {"city": "Chennai"}


def test_update_country_on_list_asks_which_contact():
    r = contacts_heuristic(
        "update cuntry as india",
        {"module": "contact", "surface": "list"},
    )
    assert r and r["ok"]
    assert "which contact" in r["assistantText"].lower()
    assert "india" in r["assistantText"].lower()
    assert not r.get("toolProposals")


def test_field_update_followup_opens_and_patches():
    catalog = {
        "contacts": [
            {"id": "c1", "displayName": "Fazil Mohammad", "email": "a@b.com"}
        ]
    }
    messages = [
        {
            "role": "assistant",
            "text": (
                "Which contact should we update — I'll set the country to **india**. "
                "Share a name or email."
            ),
        },
        {"role": "user", "text": "fazil"},
    ]
    r = contacts_heuristic(
        "fazil",
        {"module": "contact", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert any(p["name"] == "set_workspace" for p in props)
    update = next(p for p in props if p["name"] == "propose_update_contact")
    assert update["args"]["country"] == "india"
    assert update["args"]["contactId"] == "c1"


def test_city_update_resolves_named_contact_from_prior_turn():
    catalog = {
        "contacts": [
            {
                "id": "c-yas",
                "displayName": "Yaswanth M",
                "email": "yas@example.com",
            }
        ]
    }
    messages = [
        {"role": "user", "text": "update contact yaswanth"},
        {
            "role": "assistant",
            "text": "Got it — which field would you like to update for Yaswanth?",
        },
        {"role": "user", "text": "city as Namakkal"},
    ]
    r = contacts_heuristic(
        "city as Namakkal",
        {"module": "contact", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    update = next(p for p in props if p["name"] == "propose_update_contact")
    assert update["args"]["city"] == "Namakkal"
    assert update["args"]["contactId"] == "c-yas"
    assert update["args"].get("auto") is True


def test_city_update_after_updating_name_speech():
    """Assistant said 'updating Yaswanth' — field reply must update, not create."""
    from app.agents.contact_coworker_agent import _contact_hint_from_messages

    messages = [
        {"role": "user", "text": "update yaswanth"},
        {
            "role": "assistant",
            "text": "Got it, updating Yaswanth — what field would you like to change?",
        },
        {"role": "user", "text": "city as namakkal"},
    ]
    assert _contact_hint_from_messages(messages) == "Yaswanth"
    catalog = {
        "contacts": [
            {
                "id": "c-yas",
                "displayName": "Yaswanth M",
                "email": "yas@example.com",
            }
        ]
    }
    r = contacts_heuristic(
        "city as namakkal",
        {"module": "contact", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    update = next(p for p in props if p["name"] == "propose_update_contact")
    assert update["args"]["city"].lower() == "namakkal"
    assert update["args"]["contactId"] == "c-yas"
    assert "first name" not in (r.get("assistantText") or "").lower()


def test_update_this_alone_applies_prior_city_to_hinted_contact():
    from app.agents.contact_coworker_agent import extract_edit_query

    assert extract_edit_query("update this alone") is None
    catalog = {
        "contacts": [
            {
                "id": "c-yas",
                "displayName": "Yaswanth M",
                "email": "yas@example.com",
            }
        ]
    }
    messages = [
        {"role": "user", "text": "update contact yaswanth"},
        {
            "role": "assistant",
            "text": "Got it — which field would you like to update for Yaswanth?",
        },
        {"role": "user", "text": "city as Namakkal"},
        {
            "role": "assistant",
            "text": "Got it — Namakkal. And what's the first name?",
        },
        {"role": "user", "text": "update this alone"},
    ]
    r = contacts_heuristic(
        "update this alone",
        {"module": "contact", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    update = next(p for p in props if p["name"] == "propose_update_contact")
    assert update["args"]["city"] == "Namakkal"
    assert update["args"]["contactId"] == "c-yas"


def test_country_update_on_detail_proposes_tool():
    r = contacts_heuristic(
        "coutry india",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_update_contact"
    assert props[0]["args"]["country"] == "india"
    assert props[0]["args"]["contactId"] == "c1"


def test_yes_confirms_pending_country_offer():
    messages = [
        {
            "role": "assistant",
            "text": "Do you want to set the Country field to India for Fazil?",
        },
        {"role": "user", "text": "yes"},
    ]
    r = contacts_heuristic(
        "yes",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        messages=messages,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_update_contact"
    assert props[0]["args"]["country"] == "India"


def test_change_industry_of_open_contact_asks_value():
    from app.agents.contact_coworker_agent import extract_edit_query

    assert extract_edit_query("i want to change the industry type of this contact") is None
    catalog = {
        "openContact": {
            "id": "c1",
            "displayName": "Santhosh S",
            "email": "sansanthosh965@gmail.com",
            "title": "Developer",
            "companyId": "co1",
            "companyName": "hexaware",
        },
        "openCompany": {
            "id": "co1",
            "name": "hexaware",
            "industry": "IT",
        },
    }
    r = contacts_heuristic(
        "i want to change the industry type of this contact",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        catalog=catalog,
    )
    assert r and r["ok"]
    assert not r.get("toolProposals")
    assert "industry" in r["assistantText"].lower()
    assert "it" in r["assistantText"].lower()
    assert "match" not in r["assistantText"].lower()


def test_set_industry_on_open_contact_proposes_company_update():
    catalog = {
        "openContact": {
            "id": "c1",
            "displayName": "Santhosh S",
            "companyId": "co1",
        },
        "openCompany": {"id": "co1", "name": "hexaware", "industry": "IT"},
    }
    r = contacts_heuristic(
        "change industry to SaaS",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "propose_update_company"
    assert props[0]["args"]["companyId"] == "co1"
    assert props[0]["args"]["industry"] == "SaaS"


def test_about_open_contact_uses_catalog():
    catalog = {
        "openContact": {
            "id": "c1",
            "displayName": "Santhosh S",
            "email": "sansanthosh965@gmail.com",
            "title": "Developer",
            "phone": "9342962423",
            "companyId": "co1",
            "companyName": "hexaware",
            "contactType": "prospect",
        },
        "openCompany": {
            "id": "co1",
            "name": "hexaware",
            "industry": "IT",
        },
    }
    r = contacts_heuristic(
        "tell me about this contact",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        catalog=catalog,
    )
    assert r and r["ok"]
    text = r["assistantText"].lower()
    assert "santhosh" in text
    assert "developer" in text
    assert "hexaware" in text or "industry" in text
    assert "match" not in text


def test_industry_value_followup_after_ask():
    catalog = {
        "openContact": {"id": "c1", "displayName": "Santhosh S", "companyId": "co1"},
        "openCompany": {"id": "co1", "name": "hexaware", "industry": "IT"},
    }
    messages = [
        {
            "role": "assistant",
            "text": "**hexaware** currently has industry **IT**. What should we change it to?",
        },
        {"role": "user", "text": "Finance"},
    ]
    r = contacts_heuristic(
        "Finance",
        {"module": "contact", "surface": "detail", "entityId": "c1"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_update_company"
    assert props[0]["args"]["industry"] == "Finance"


@pytest.mark.asyncio
async def test_contact_draft_keeps_llm_speech_not_static_prompt():
    from app.agents.contact_draft_agent import handle

    ai_text = "Nice — I've got Ashika. What's her last name?"
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.crm_tools.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "app.agents.contact_draft_agent.run_chat_json",
            new_callable=AsyncMock,
            return_value={
                "assistantText": ai_text,
                "patch": {"firstName": "Ashika"},
            },
        ),
    ):
        state = await handle(
            {
                "messages": [{"role": "user", "text": "Ashika"}],
                "context": {},
                "catalog": {"currentDraft": {}, "companies": []},
            }
        )
    result = state["result"]
    assert result["assistantText"] == ai_text
    assert result["source"] == "ai"
    assert result["patch"]["firstName"] == "Ashika"


@pytest.mark.asyncio
async def test_contact_draft_llm_fail_does_not_use_static_speech():
    from app.agents.contact_draft_agent import handle

    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.crm_tools.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "app.agents.contact_draft_agent.run_chat_json",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        state = await handle(
            {
                "messages": [{"role": "user", "text": "yes"}],
                "context": {},
                "catalog": {
                    "currentDraft": {
                        "firstName": "Ashika",
                        "email": "a@b.com",
                    },
                    "companies": [],
                },
            }
        )
    result = state["result"]
    assert not result.get("assistantText")
    assert "almost" not in str(result).lower()
    assert result.get("reason") == "llm_unusable"


@pytest.mark.asyncio
async def test_contact_draft_confirm_goes_through_llm():
    from app.agents.contact_draft_agent import handle

    ai_text = "Almost — I still need Ashika's last name before I can save her."
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.crm_tools.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "app.agents.contact_draft_agent.run_chat_json",
            new_callable=AsyncMock,
            return_value={"assistantText": ai_text},
        ),
    ):
        state = await handle(
            {
                "messages": [{"role": "user", "text": "yes"}],
                "context": {},
                "catalog": {
                    "currentDraft": {
                        "firstName": "Ashika",
                        "email": "a@b.com",
                    },
                    "companies": [],
                },
            }
        )
    result = state["result"]
    assert result["assistantText"] == ai_text
    assert result["source"] == "ai"
    assert not result.get("toolProposals")


def test_open_pending_duplicate_by_id():
    from app.agents.contact_coworker_agent import contacts_heuristic

    dup_id = "cdp-yaswanth-1"
    result = contacts_heuristic(
        "open the existing one",
        {
            "surface": "create",
            "sessionMemory": {
                "slots": {
                    "pendingDuplicateContacts": [
                        {
                            "id": dup_id,
                            "displayName": "Yaswanth M G",
                            "email": "yaswanthmg1@gmail.com",
                        }
                    ]
                }
            },
        },
        messages=[
            {
                "role": "assistant",
                "text": (
                    "I found 1 possible duplicate before saving:\n"
                    "• **Yaswanth M G** — yaswanthmg1@gmail.com"
                ),
            },
            {"role": "user", "text": "open the existing one"},
        ],
        catalog={
            "pendingDuplicateContacts": [
                {
                    "id": dup_id,
                    "displayName": "Yaswanth M G",
                    "email": "yaswanthmg1@gmail.com",
                }
            ]
        },
    )
    assert result is not None
    tools = result.get("toolProposals") or []
    assert tools
    assert tools[0]["name"] == "set_workspace"
    assert tools[0]["args"]["mode"] == "detail"
    assert tools[0]["args"]["entityId"] == dup_id
    assert "opened" in (result.get("assistantText") or "").lower()


def test_native_create_walk_patches_names_into_workspace():
    """Chat can say Raghu M while the setup panel stays empty unless we patch."""
    from app.agents.crm_agent import bind_native_contact_create

    messages = [
        {"role": "assistant", "text": "Happy to help — what's the contact's full name?"},
        {"role": "user", "text": "raghu"},
    ]
    first = bind_native_contact_create(
        {
            "ok": True,
            "assistantText": "Nice to meet you, Raghu — is there a last name I should add?",
            "toolProposals": [
                {
                    "id": "ws",
                    "name": "set_workspace",
                    "args": {"mode": "list", "search": "raghu", "auto": True},
                }
            ],
        },
        messages=messages,
        context={"module": "contact", "surface": "list", "draft": {}},
        catalog={"companies": []},
        session_memory={},
    )
    patch = (first or {}).get("patch") or {}
    assert patch.get("firstName") == "Raghu"
    assert "lastName" not in patch
    tools = (first or {}).get("toolProposals") or []
    assert any(
        t.get("name") == "set_workspace" and t.get("args", {}).get("mode") == "create"
        for t in tools
    )
    assert not any(
        t.get("name") == "set_workspace" and t.get("args", {}).get("search") == "raghu"
        for t in tools
    )

    messages = [
        *messages,
        {
            "role": "assistant",
            "text": "Nice to meet you, Raghu — is there a last name I should add?",
        },
        {"role": "user", "text": "m"},
    ]
    second = bind_native_contact_create(
        {
            "ok": True,
            "assistantText": "Got it — Raghu M. What's the best email or phone number to reach them at?",
        },
        messages=messages,
        context={"module": "contact", "surface": "create", "draft": {}},
        catalog={"companies": []},
        session_memory=(first or {}).get("sessionMemoryPatch") or {},
    )
    filled = (second or {}).get("patch") or {}
    assert filled.get("firstName") == "Raghu"
    assert filled.get("lastName") == "M"


def test_create_contact_opens_setup_without_inventing_a_name():
    from app.agents.crm_agent import bind_native_contact_create

    out = bind_native_contact_create(
        {
            "ok": True,
            "assistantText": "Happy to help — what's the contact's full name?",
        },
        messages=[{"role": "user", "text": "create contact"}],
        context={"module": "contact", "surface": "list", "draft": {}},
        catalog={},
        session_memory={},
    )
    assert not (out or {}).get("patch")
    tools = (out or {}).get("toolProposals") or []
    assert any(
        t.get("name") == "set_workspace" and t.get("args", {}).get("mode") == "create"
        for t in tools
    )


def test_secondary_contact_stays_an_update_of_the_saved_person():
    from app.agents.crm_agent import bind_native_contact_create

    out = bind_native_contact_create(
        {
            "ok": True,
            "assistantText": "What's the secondary email or phone for Meyanathan?",
            "toolProposals": [
                {
                    "name": "propose_update_contact",
                    "args": {"contactId": "c-mey", "auto": True},
                }
            ],
        },
        messages=[
            {"role": "assistant", "text": "All set — contact created."},
            {"role": "user", "text": "add the secondary contact"},
        ],
        context={"module": "contact", "surface": "create", "draft": {}},
        catalog={},
        session_memory={
            "pendingIntent": "create_contact",
            "slots": {"createModule": "contact"},
        },
    )
    tools = (out or {}).get("toolProposals") or []
    assert any(t.get("name") == "propose_update_contact" for t in tools)
    assert not any(
        t.get("name") == "set_workspace"
        and (t.get("args") or {}).get("mode") == "create"
        for t in tools
    )
    assert not (out or {}).get("patch")

"""Unit tests for shared conversational helpers used by every coworker agent.

These are the primitives behind delete confirmation, graceful decline, slang
delete verbs, and multi-field parsing — kept centralized so contact/deal/
company/product never drift out of sync again.
"""

from __future__ import annotations

import pytest

from app.agents.coworker_shared import (
    LLM_ERROR_SPEECH,
    actions_without_speech,
    apply_leave_create,
    draft_navigate_tools_from_llm,
    drop_non_llm_speech,
    extract_suggestions,
    has_compound_delete_intent,
    is_generic_coworker_speech,
    looks_like_affirmative,
    looks_like_decline,
    result_leaves_current_page,
    sanitize_assistant_text_for_user,
    strip_internal_workspace_sentences,
    trim_at_next_field,
    wants_delete_intent,
)


@pytest.mark.parametrize(
    "phrase",
    [
        "yes", "yep", "yeah", "yup", "sure", "ok", "okay", "confirm", "confirmed",
        "yes yes yes", "yes please do it", "yeah go for it", "confirm it",
        "sure thing", "alright then", "go ahead", "do it", "do it now",
        "please do", "sounds good",
    ],
)
def test_looks_like_affirmative_true(phrase: str) -> None:
    assert looks_like_affirmative(phrase) is True, phrase


@pytest.mark.parametrize(
    "phrase",
    [
        "", "   ", "no", "nope", "nah", "not now", "wait no",
        "actually no, cancel that", "cancel that", "cancel",
        "ok cool", "yes but also change the email", "yesterday",
        "going ahead with something else entirely",
    ],
)
def test_looks_like_affirmative_false(phrase: str) -> None:
    assert looks_like_affirmative(phrase) is False, phrase


@pytest.mark.parametrize(
    "phrase",
    ["no", "nope", "nah", "don't", "do not", "cancel", "cancel that", "wait, no", "actually, no", "stop"],
)
def test_looks_like_decline_true(phrase: str) -> None:
    assert looks_like_decline(phrase) is True, phrase


@pytest.mark.parametrize("phrase", ["", "   ", "yes", "sure", "delete it", "update the email"])
def test_looks_like_decline_false(phrase: str) -> None:
    assert looks_like_decline(phrase) is False, phrase


@pytest.mark.parametrize(
    "phrase",
    [
        "delete", "delete it", "remove this", "erase that", "trash it",
        "get rid of it", "throw away this", "nuke it", "yeet this",
        "wipe it out", "ditch this", "toss it", "scrap it",
    ],
)
def test_wants_delete_intent_true(phrase: str) -> None:
    assert wants_delete_intent(phrase) is True, phrase


@pytest.mark.parametrize(
    "phrase",
    ["update this", "cut the price", "axe the discount", "create a new one", ""],
)
def test_wants_delete_intent_false(phrase: str) -> None:
    assert wants_delete_intent(phrase) is False, phrase


@pytest.mark.parametrize(
    "phrase",
    [
        "delete this and also create a new contact",
        "update the phone and then delete it",
        "remove it and also add a new one",
        "nuke this and create a new product",
    ],
)
def test_has_compound_delete_intent_true(phrase: str) -> None:
    assert has_compound_delete_intent(phrase) is True, phrase


@pytest.mark.parametrize(
    "phrase",
    [
        "delete this contact",
        "just delete it please",
        "update the phone number",
        "create a new contact",
        "",
    ],
)
def test_has_compound_delete_intent_false(phrase: str) -> None:
    assert has_compound_delete_intent(phrase) is False, phrase


def test_trim_at_next_field_cuts_trailing_field_assignment() -> None:
    assert trim_at_next_field("CEO and email to a@b.com") == "CEO"
    assert trim_at_next_field("SaaS and domain to acme.io") == "SaaS"
    assert trim_at_next_field("Big Deal and amount to 5000") == "Big Deal"


def test_trim_at_next_field_leaves_plain_values_untouched() -> None:
    assert trim_at_next_field("CEO") == "CEO"
    assert trim_at_next_field("") == ""
    assert trim_at_next_field("Ben and Jerry's") == "Ben and Jerry's"


def test_sanitize_strips_leaked_html_markup() -> None:
    out = sanitize_assistant_text_for_user(
        "<section><h2>Quotation Proposal</h2>"
        "<p><strong>Prepared for:</strong> MED Bites</p></section>"
    )
    assert "<h2>" not in out
    assert "<section>" not in out
    assert "Quotation Proposal" in out
    assert "MED Bites" in out
    assert (
        sanitize_assistant_text_for_user("- Got it — phone added.")
        == "Got it — phone added."
    )
    assert (
        sanitize_assistant_text_for_user("* Added TCS as the company name.")
        == "Added TCS as the company name."
    )


def test_sanitize_recap_drops_markdown_stars() -> None:
    raw = (
        "Perfect — that's everything I need for Pooja. Here's what I have:\n"
        "**Name:** Pooja\n"
        "**Email:** pooja09090@gmail.com\n"
        "**Title:** Sales Manager\n"
        "**Company:** Accenture\n"
        "**Location:** Chennai, India"
    )
    out = sanitize_assistant_text_for_user(raw)
    assert "**" not in out
    assert "Name: Pooja" in out
    assert "Email: pooja09090@gmail.com" in out
    assert "Location: Chennai, India" in out
    broken = sanitize_assistant_text_for_user(
        "Name:** Pooja Email:** pooja09090@gmail.com Title:** Sales Manager"
    )
    assert "**" not in broken
    assert "Name: Pooja" in broken
    assert "Email: pooja09090@gmail.com" in broken


def test_sanitize_keeps_coworker_chat_html() -> None:
    out = sanitize_assistant_text_for_user(
        '<p class="x"><strong>Status</strong>: Open</p>'
        "<ul><li><strong>Owner</strong>: Support</li></ul>"
        '<suggestions>["Open the queue"]</suggestions>'
    )
    assert "<p>" in out and 'class=' not in out
    assert "<strong>Status</strong>" in out
    assert "<ul>" in out
    assert "<suggestions>" in out
    assert is_generic_coworker_speech("<p>On it.</p>") is True
    assert is_generic_coworker_speech("<p>Shall I save them?</p>") is False


def test_drop_non_llm_speech_keeps_any_usable() -> None:
    ai = drop_non_llm_speech(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "What's their email?",
            "patch": {"firstName": "Ada"},
        }
    )
    assert ai["assistantText"] == "What's their email?"
    assert ai["patch"]["firstName"] == "Ada"

    # Any non-empty, non-generic speech passes through regardless of source
    heur = drop_non_llm_speech(
        {
            "ok": True,
            "source": "heuristic",
            "assistantText": "Sure — taking you to **Contacts**.",
            "toolProposals": [{"name": "navigate", "args": {"href": "/contact"}}],
        }
    )
    assert heur["assistantText"] == "Sure — taking you to **Contacts**."
    assert heur["toolProposals"]

    unlabeled = drop_non_llm_speech(
        {"ok": True, "assistantText": "You're already on **Contacts**."}
    )
    assert unlabeled["assistantText"] == "You're already on **Contacts**."

    generic_ai = drop_non_llm_speech(
        {"ok": True, "source": "ai", "assistantText": "Okay."}
    )
    assert generic_ai["assistantText"] == LLM_ERROR_SPEECH

    mixed = drop_non_llm_speech(
        {
            "ok": True,
            "source": "ai",
            "assistantText": "I'll open create. What's their first name?",
        }
    )
    assert mixed["assistantText"] == "What's their first name?"


def test_strip_internal_workspace_keeps_the_real_question() -> None:
    assert strip_internal_workspace_sentences(
        "I'll open create. What's their first name?"
    ) == "What's their first name?"
    assert not strip_internal_workspace_sentences(
        "Nice — I'll open create and pull in what you shared."
    )

    # Non-generic heuristic speech is now kept (source doesn't matter)
    stripped = drop_non_llm_speech(
        {
            "ok": True,
            "source": "heuristic",
            "assistantText": "Sure — taking you to **Contacts**.",
        },
        fallback=None,
    )
    assert stripped.get("assistantText") == "Sure — taking you to **Contacts**."


def test_actions_without_speech_copies_tools_not_chat() -> None:
    out = actions_without_speech(
        {
            "ok": True,
            "assistantText": "What's their full name?",
            "toolProposals": [{"name": "set_workspace", "args": {"mode": "create"}}],
            "sessionMemoryPatch": {"pendingAsk": ""},
        },
        reason="llm_unhandled",
    )
    assert out["source"] == "heuristic"
    assert out["reason"] == "llm_unhandled"
    assert not out.get("assistantText")
    assert out["toolProposals"][0]["args"]["mode"] == "create"
    assert out["sessionMemoryPatch"]["pendingAsk"] == ""


def test_extract_suggestions_strips_tagged_block() -> None:
    text, labels = extract_suggestions(
        'Stage moved to Discover.\n<suggestions>["View MED Bite deal","Create a proposal"]</suggestions>'
    )
    assert text == "Stage moved to Discover."
    assert labels == ["View MED Bite deal", "Create a proposal"]


def test_extract_suggestions_strips_trailing_leaked_json() -> None:
    text, labels = extract_suggestions(
        'Shall I go ahead?\n["Confirm stage change","View MED Bite deal","Create a proposal"]'
    )
    assert "Confirm stage change" not in text
    assert "[" not in text
    assert text == "Shall I go ahead?"
    assert labels == ["View MED Bite deal", "Create a proposal"]


def test_extract_suggestions_drops_confirm_only_chips() -> None:
    text, labels = extract_suggestions(
        'Ready.\n["Confirm stage change","Click confirm"]'
    )
    assert text == "Ready."
    assert labels == []


def test_navigate_to_other_create_page_is_a_leave() -> None:
    leaving = {
        "ok": True,
        "patch": {"companyName": "lyca"},
        "toolProposals": [
            {
                "name": "navigate",
                "args": {"href": "/company/new", "seedPrompt": "Lyca", "auto": True},
            }
        ],
    }
    assert result_leaves_current_page(
        leaving, pathname="/contact/new", module="contact"
    )
    stripped = apply_leave_create(
        leaving, pathname="/contact/new", module="contact"
    )
    assert "patch" not in stripped
    tools = draft_navigate_tools_from_llm(
        {"navigate": {"href": "/company/new", "seedPrompt": "Lyca"}},
        user_text="lyca",
    )
    assert tools[0]["args"]["href"] == "/company/new"
    assert tools[0]["args"]["seedPrompt"] == "Lyca"


def test_same_module_create_workspace_is_not_a_leave() -> None:
    stay = {
        "ok": True,
        "patch": {"firstName": "Priya"},
        "toolProposals": [
            {
                "name": "set_workspace",
                "label": "Create contact",
                "args": {"mode": "create", "auto": True},
            }
        ],
    }
    assert not result_leaves_current_page(
        stay, pathname="/contact/new", module="contact"
    )
    assert not result_leaves_current_page(stay, pathname="", module="contact")


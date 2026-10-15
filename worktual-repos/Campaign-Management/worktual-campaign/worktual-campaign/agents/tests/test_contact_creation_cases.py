"""Easy-pass and hard contact-creation cases (validation + draft flow + create gates)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.contacts.draft_ingest import (
    extract_contact_fields,
    identity_view_args_from_turn,
    is_garbage_person_name,
    missing_fields,
    next_creation_prompt_field,
    sync_draft_from_user_turn,
)
from app.agents.contacts.tools.handlers import (
    handle_create,
    handle_create_single_contact,
)
from app.agents.contacts.validation import (
    is_valid_person_name_token,
    parse_and_validate_phone,
    validate_email_phone,
)


# ---------------------------------------------------------------------------
# Easy-pass cases (should succeed / allow create path)
# ---------------------------------------------------------------------------


class TestContactCreationEasyPass:
    def test_valid_email_and_indian_phone(self) -> None:
        out = validate_email_phone("priya.sharma@acme.com", "+91 98765 43210")
        assert out["ok"] is True
        assert out["email"] == "priya.sharma@acme.com"
        assert out["phone"] == "+919876543210"

    def test_email_only_is_enough_channel(self) -> None:
        out = validate_email_phone("ada@lovelace.org", None)
        assert out["ok"] is True
        assert out["email"] == "ada@lovelace.org"
        assert out["phone"] is None
        assert missing_fields({"first_name": "Ada", "email": "ada@lovelace.org"}) == []

    def test_phone_only_is_enough_channel(self) -> None:
        out = validate_email_phone(None, "+14155552671")
        assert out["ok"] is True
        assert out["phone"] == "+14155552671"
        assert missing_fields({"first_name": "Sam", "phone": "+14155552671"}) == []

    def test_normal_names_accepted(self) -> None:
        assert is_valid_person_name_token("Aravindh", field="first_name")
        assert is_valid_person_name_token("Selvaraj", field="last_name")
        assert is_valid_person_name_token("O'Brien", field="last_name")
        assert is_valid_person_name_token("P", field="last_name")
        assert not is_garbage_person_name("Priya", "Sharma")

    def test_email_format_gate_rejects_missing_at(self) -> None:
        from app.agents.contacts.validation import looks_like_email_attempt, review_email_address

        assert looks_like_email_attempt("pujitha123gmail.co") is True
        bad = review_email_address("pujitha123gmail.co")
        assert bad["ok"] is False
        assert bad.get("error") == "invalid_format"
        assert "@" in (bad.get("message") or "")
        good = review_email_address("pujitha123@gmail.com")
        assert good["ok"] is True

    def test_create_intent_phrase_is_not_a_person_name(self) -> None:
        for phrase in (
            "new one",
            "New One",
            "add a contact",
            "create one",
            "add a new contact",
            "another one",
        ):
            out = extract_contact_fields(phrase)
            assert "first_name" not in out, phrase
            assert "last_name" not in out, phrase
            assert is_garbage_person_name(*phrase.split()) is True, phrase

        session = {
            "draft_mode": "create",
            "focus_contact_id": None,
            "draft_contact": {"first_name": "", "last_name": ""},
        }
        pre = sync_draft_from_user_turn(
            session,
            "new one",
            last_assistant=(
                "Hi there! I can help you look up contacts, add new ones, "
                "or update existing details. What would you like to do?"
            ),
        )
        assert pre.get("changed") is False or not str(
            (pre.get("draft_contact") or {}).get("first_name") or ""
        ).strip()
        assert not str((session.get("draft_contact") or {}).get("first_name") or "").strip()
        assert not str((session.get("draft_contact") or {}).get("last_name") or "").strip()

        # Scrub values already stuck on the panel from a prior bad ingest.
        session2 = {
            "draft_mode": "create",
            "focus_contact_id": None,
            "draft_contact": {"first_name": "New", "last_name": "One"},
        }
        pre2 = sync_draft_from_user_turn(
            session2,
            "new one",
            last_assistant="What would you like to do?",
        )
        assert pre2.get("changed") is True
        assert not str(pre2["draft_contact"].get("first_name") or "").strip()
        assert not str(pre2["draft_contact"].get("last_name") or "").strip()

    def test_name_is_phrase_sets_first_name_only(self) -> None:
        for phrase in ("name is aravindh", "Name is Aravindh", "name: Maya", "called them Sam"):
            out = extract_contact_fields(phrase)
            assert "first_name" in out, phrase
            assert "last_name" not in out, phrase
        two = extract_contact_fields("name is Priya Sharma")
        assert two.get("first_name") == "Priya"
        assert two.get("last_name") == "Sharma"

    @pytest.mark.asyncio
    async def test_sync_draft_name_is_aravindh_first_only(self) -> None:
        session = {
            "draft_mode": "create",
            "draft_contact": {},
            "focus_contact_id": None,
        }
        pre = sync_draft_from_user_turn(
            session,
            "name is aravindh",
            last_assistant="What's their first name?",
        )
        assert pre.get("changed") is True
        dc = pre["draft_contact"]
        assert dc.get("first_name") == "Aravindh" or dc.get("first_name") == "aravindh"
        assert not str(dc.get("last_name") or "").strip()

    def test_creation_prompt_order_first_then_last_then_email(self) -> None:
        assert next_creation_prompt_field({}) == "first_name"
        assert next_creation_prompt_field({"first_name": "Priya"}) == "last_name"
        assert (
            next_creation_prompt_field(
                {"first_name": "Priya", "last_name": "S"}
            )
            == "email"
        )

    def test_skip_last_name_moves_to_email(self) -> None:
        draft = {
            "first_name": "Priya",
            "pack_fields_skipped": "last_name",
        }
        assert next_creation_prompt_field(draft) == "email"
        # List form (common in JSON drafts) must also work
        draft_list = {
            "first_name": "Priya",
            "pack_fields_skipped": ["last_name"],
        }
        assert next_creation_prompt_field(draft_list) == "email"

    def test_email_then_phone_then_b2b_company(self) -> None:
        draft = {
            "first_name": "Priya",
            "last_name": "S",
            "email": "priya@acme.com",
            "pack_fields_skipped": "",
        }
        assert (
            next_creation_prompt_field(draft, campaign_profile={"mode": "b2b"})
            == "phone"
        )
        draft["phone"] = "+919876543210"
        assert (
            next_creation_prompt_field(draft, campaign_profile={"mode": "b2b"})
            == "company_name"
        )

    def test_b2c_skips_company_ask(self) -> None:
        draft = {
            "first_name": "Priya",
            "last_name": "S",
            "email": "priya@acme.com",
            "phone": "+919876543210",
        }
        nxt = next_creation_prompt_field(draft, campaign_profile={"mode": "b2c"})
        assert nxt in (None, "city")
        assert nxt != "company_name"

    @pytest.mark.asyncio
    async def test_create_requires_explicit_confirm(self) -> None:
        out = await handle_create_single_contact(
            "sess-easy",
            "tok",
            {
                "firstName": "Priya",
                "email": "priya@acme.com",
                "user_confirmed": False,
            },
        )
        assert out["ok"] is False
        assert "user_confirmed" in (out.get("error") or "").lower() or "agreed" in (
            out.get("error") or ""
        ).lower()


# ---------------------------------------------------------------------------
# Hard cases (should reject / block / force re-ask)
# ---------------------------------------------------------------------------


class TestContactCreationHardReject:
    def test_reject_neither_email_nor_phone(self) -> None:
        out = validate_email_phone(None, None)
        assert out["ok"] is False
        assert "email" in (out.get("message") or "").lower() or "phone" in (
            out.get("message") or ""
        ).lower()
        assert missing_fields({"first_name": "Priya"}) == ["email"]

    def test_reject_invalid_email_formats(self) -> None:
        for bad in (
            "not-an-email",
            "a@b",
            "@missinglocal.com",
            "spaces emma@acme.com",
            "priya@",
        ):
            out = validate_email_phone(bad, None)
            assert out["ok"] is False, bad

    def test_reject_phone_without_country_code(self) -> None:
        out = parse_and_validate_phone("9876543210")  # India local without +91
        assert out["ok"] is False
        assert "country code" in (out.get("message") or "").lower()
        assert parse_and_validate_phone("12345")["ok"] is False
        assert parse_and_validate_phone("call me")["ok"] is False
        assert parse_and_validate_phone("+91 123")["ok"] is False

    def test_explicit_country_code_phone_accepted(self) -> None:
        assert parse_and_validate_phone("+91 98765 43210")["e164"] == "+919876543210"
        assert parse_and_validate_phone("919876543210")["e164"] == "+919876543210"

    def test_india_eleven_digit_without_code_rejected(self) -> None:
        # Must not invent +91 for ambiguous local-looking numbers.
        out = parse_and_validate_phone("93930459103")
        assert out["ok"] is False
        assert "country code" in (out.get("message") or "").lower()

    def test_preflight_ingests_phone_and_no_email_skip(self) -> None:
        session = {
            "draft_mode": "create",
            "draft_contact": {"first_name": "Araivindh", "last_name": "s"},
            "focus_contact_id": None,
        }
        pre = sync_draft_from_user_turn(
            session,
            "no email",
            last_assistant="What is Araivindh's email address?",
        )
        assert pre["changed"] is True
        skipped = str(pre["draft_contact"].get("pack_fields_skipped") or "")
        assert "email" in skipped
        pre2 = sync_draft_from_user_turn(
            session,
            "+91 9393045910",
            last_assistant="What is their phone number (include country code)?",
        )
        assert pre2["changed"] is True
        assert pre2["draft_contact"].get("phone") == "+919393045910"
        assert missing_fields(pre2["draft_contact"]) == []

        # Local number without country code must not be ingested as phone.
        pre3 = sync_draft_from_user_turn(
            session,
            "9876543210",
            last_assistant="What is their phone number (include country code)?",
        )
        assert pre3.get("changed") is False or pre3["draft_contact"].get("phone") == (
            "+919393045910"
        )

    def test_preflight_does_not_classify_create_while_updating(self) -> None:
        """Chat keywords are not create intent — leave update draft alone until tools."""
        session = {
            "draft_mode": "update",
            "focus_contact_id": "1830917733048487",
            "draft_contact": {"first_name": "Aravindh", "email": "a@b.com"},
        }
        pre = sync_draft_from_user_turn(session, "i needed to create a contact")
        assert pre["changed"] is False
        assert session.get("focus_contact_id") == "1830917733048487"
        assert session.get("draft_mode") == "update"

    def test_preflight_ingests_name_only_in_create_mode(self) -> None:
        session = {
            "draft_mode": "create",
            "focus_contact_id": None,
            "draft_contact": {"first_name": "", "email": ""},
        }
        pre = sync_draft_from_user_turn(
            session,
            "kavin",
            last_assistant="Could I get a first name for them?",
        )
        assert pre["changed"] is True
        assert pre["draft_contact"].get("first_name") == "Kavin"

    def test_reject_gibberish_and_digit_names(self) -> None:
        assert is_valid_person_name_token("x7k2", field="first_name") is False
        assert is_valid_person_name_token("qwrtyplkj", field="first_name") is False
        assert is_valid_person_name_token("abc123", field="last_name") is False
        assert is_garbage_person_name("asdfghjk") is True or not is_valid_person_name_token(
            "asdfghjk", field="first_name"
        )

    def test_both_channels_skipped_still_missing(self) -> None:
        draft = {
            "first_name": "Priya",
            "pack_fields_skipped": "last_name,email,phone",
        }
        assert missing_fields(draft) == ["email"]
        # Flow has nowhere to go for channel — next may be None after skips
        nxt = next_creation_prompt_field(draft, campaign_profile={"mode": "b2b"})
        assert nxt in (None, "company_name", "city")

    def test_invalid_email_on_draft_counts_as_missing_channel(self) -> None:
        draft = {"first_name": "Priya", "email": "bad-email"}
        assert "email" in missing_fields(draft)

    def test_invalid_phone_on_draft_does_not_satisfy_channel(self) -> None:
        draft = {"first_name": "Priya", "phone": "123"}
        assert missing_fields(draft) == ["email"]

    @pytest.mark.asyncio
    async def test_create_blocked_when_draft_incomplete(self) -> None:
        session = {
            "session_id": "sess-hard",
            "module": "contacts",
            "draft_mode": "create",
            "draft_contact": {"first_name": "Priya"},  # no email/phone
            "campaign_profile": {"mode": "b2b"},
        }

        async def _fake_get(sid, token=None, **kwargs):
            return session

        with patch(
            "app.agents.contacts.tools.handlers.get_or_create_session",
            new=AsyncMock(side_effect=_fake_get),
        ):
            out = await handle_create(
                "sess-hard",
                "tok",
                {
                    "first_name": "Priya",
                    "user_confirmed": True,
                },
            )
        assert out["ok"] is False
        err = (out.get("error") or "").lower()
        assert "missing" in err or "email" in err or "phone" in err

    @pytest.mark.asyncio
    async def test_create_blocked_for_garbage_first_name(self) -> None:
        session = {
            "session_id": "sess-hard2",
            "module": "contacts",
            "draft_mode": "create",
            "draft_contact": {
                "first_name": "x7k2",
                "email": "ok@example.com",
            },
            "campaign_profile": {"mode": "b2c"},
        }

        async def _fake_get(sid, token=None, **kwargs):
            return session

        with (
            patch(
                "app.agents.contacts.tools.handlers.get_or_create_session",
                new=AsyncMock(side_effect=_fake_get),
            ),
            patch(
                "app.agents.contacts.tools.handlers._create_lock",
            ) as lock_mock,
        ):
            # If draft missing_fields passes (email valid), create still rejects garbage name
            # inside _handle_create_locked — exercise that path by making lock a no-op CM.
            class _CM:
                async def __aenter__(self):
                    return None

                async def __aexit__(self, *args):
                    return False

            lock_mock.return_value = _CM()
            out = await handle_create(
                "sess-hard2",
                "tok",
                {
                    "first_name": "x7k2",
                    "email": "ok@example.com",
                    "user_confirmed": True,
                },
            )
        assert out["ok"] is False


# ---------------------------------------------------------------------------
# Mixed / edge hard cases that must still pass when inputs are careful
# ---------------------------------------------------------------------------


class TestContactCreationHardButValid:
    def test_plus_and_spaces_phone_normalizes(self) -> None:
        out = parse_and_validate_phone("+91 (987) 654-3210")
        assert out["ok"] is True
        assert out["e164"] == "+919876543210"

    def test_email_typo_suggestion_path(self) -> None:
        # Common typo TLD — review may flag or accept; must not crash.
        out = validate_email_phone("user@gmail.con", None)
        assert "ok" in out

    def test_ready_to_create_without_last_name(self) -> None:
        draft = {
            "first_name": "Priya",
            "email": "priya@acme.com",
            "pack_fields_skipped": "last_name,phone,company_name,city",
        }
        assert missing_fields(draft) == []
        nxt = next_creation_prompt_field(draft, campaign_profile={"mode": "b2b"})
        assert nxt is None

    def test_ready_to_create_with_list_skipped(self) -> None:
        draft = {
            "first_name": "Priya",
            "email": "priya@acme.com",
            "pack_fields_skipped": ["last_name", "phone", "company_name", "city"],
        }
        assert missing_fields(draft) == []
        assert next_creation_prompt_field(draft, campaign_profile={"mode": "b2b"}) is None


class TestIdentityViewPreflight:
    def test_show_email_is_view_not_name(self) -> None:
        raw = "show aravindhselvaraj6235@gmail.com details"
        fields = extract_contact_fields(raw)
        assert fields.get("email") == "aravindhselvaraj6235@gmail.com"
        assert "first_name" not in fields

    def test_identity_view_args_when_not_email_step(self) -> None:
        args = identity_view_args_from_turn(
            "show aravindhselvaraj6235@gmail.com details",
            last_assistant="Hi — find someone, add a contact, or tweak a record?",
        )
        assert args == {"email": "aravindhselvaraj6235@gmail.com"}

    def test_sync_skipped_for_identity_view_turn(self) -> None:
        session = {"draft_mode": "create", "draft_contact": {}}
        pre = sync_draft_from_user_turn(
            session,
            "show ada@example.com",
            last_assistant="Welcome!",
        )
        assert pre.get("changed") is False

    def test_email_answer_during_interview_still_syncs(self) -> None:
        session = {"draft_mode": "create", "draft_contact": {"first_name": "Ada"}}
        pre = sync_draft_from_user_turn(
            session,
            "ada@example.com",
            last_assistant="What is their email address?",
        )
        assert pre.get("changed") is True
        assert pre.get("ui_payload", {}).get("draft_contact", {}).get("email") == (
            "ada@example.com"
        )

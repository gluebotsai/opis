"""Contacts hard/soft required fields — first + (email or phone); last name ask-only."""

from __future__ import annotations

import unittest

from app.agents.contacts.draft_ingest import (
    channel_status,
    draft_status_line,
    draft_summary_lines,
    missing_fields,
    soft_missing_fields,
)
from app.agents.contacts.prompts import build_system_prompt, welcome_text
from app.agents.contacts.tools.schemas import ALL_TOOLS


class ContactsRequiredFieldsTests(unittest.TestCase):
    def test_hard_missing_first_and_channel(self) -> None:
        miss = missing_fields({})
        self.assertIn("first_name", miss)
        self.assertNotIn("last_name", miss)
        self.assertIn("email", miss)
        self.assertNotIn("phone", miss)

    def test_email_alone_satisfies_channel(self) -> None:
        miss = missing_fields(
            {"first_name": "Priya", "last_name": "Sharma", "email": "priya@acme.com"}
        )
        self.assertEqual(miss, [])
        ch = channel_status({"email": "priya@acme.com"})
        self.assertTrue(ch["satisfied"])

    def test_phone_alone_satisfies_channel(self) -> None:
        miss = missing_fields(
            {"first_name": "Priya", "last_name": "S", "phone": "+919876543210"}
        )
        self.assertEqual(miss, [])
        soft = soft_missing_fields(
            {"first_name": "Priya", "last_name": "S", "phone": "+919876543210"},
            campaign_profile={"mode": "b2b"},
        )
        self.assertNotIn("last_name", soft)
        self.assertIn("city", soft)
        self.assertIn("company_name", soft)

    def test_both_email_and_phone_complete(self) -> None:
        miss = missing_fields(
            {
                "first_name": "Priya",
                "last_name": "S",
                "email": "priya@acme.com",
                "phone": "+919876543210",
            }
        )
        self.assertEqual(miss, [])

    def test_b2c_soft_includes_company_and_city(self) -> None:
        soft = soft_missing_fields(
            {"first_name": "Priya", "last_name": "S", "email": "priya@acme.com"},
            campaign_profile={"mode": "b2c"},
        )
        self.assertIn("city", soft)
        self.assertIn("company_name", soft)

    def test_last_name_not_required_for_create(self) -> None:
        miss = missing_fields(
            {
                "first_name": "Priya",
                "email": "priya@acme.com",
                "phone": "+919876543210",
            }
        )
        self.assertEqual(miss, [])

    def test_summary_omits_empty_optionals(self) -> None:
        text = draft_summary_lines(
            {"first_name": "Priya", "last_name": "S", "email": "priya@acme.com"}
        )
        self.assertIn("Priya", text)
        self.assertIn("priya@acme.com", text)
        self.assertNotIn("City:", text)

    def test_status_line_ready_without_last_name(self) -> None:
        draft = {
            "first_name": "Priya",
            "email": "priya@acme.com",
            "phone": "+919876543210",
        }
        self.assertEqual(draft_status_line([], draft), "Ready to create — confirm in chat.")

    def test_status_line_ready_when_hard_complete(self) -> None:
        draft = {
            "first_name": "Priya",
            "last_name": "S",
            "email": "priya@acme.com",
            "phone": "+919876543210",
        }
        self.assertEqual(draft_status_line([], draft), "Ready to create — confirm in chat.")

    def test_crm_flow_prompt_includes_draft_context(self) -> None:
        text = build_system_prompt(
            {
                "session_id": "t",
                "module": "contacts",
                "draft_mode": "create",
                "draft_contact": {"first_name": "Ada"},
                "campaign_profile": {"mode": "b2b"},
            }
        )
        self.assertIn("Ada", text)
        self.assertIn("next_field", text)
        self.assertIn("last_name", text.lower())
        self.assertIn("email", text.lower())
        names = {t["function"]["name"] for t in ALL_TOOLS}
        self.assertEqual(
            names
            & {
                "SET_DRAFT_FIELDS",
                "GET_CONTACT_DETAIL",
                "CONTACT_VIEW_AND_DOWNLOAD",
                "CREATE_SINGLE_CONTACT",
                "CREATE_BULK_CONTACT",
                "UPDATE_SINGLE_CONTACT",
                "UPDATE_BULK_CONTACT",
            },
            {
                "SET_DRAFT_FIELDS",
                "GET_CONTACT_DETAIL",
                "CONTACT_VIEW_AND_DOWNLOAD",
                "CREATE_SINGLE_CONTACT",
                "CREATE_BULK_CONTACT",
                "UPDATE_SINGLE_CONTACT",
                "UPDATE_BULK_CONTACT",
            },
        )

    def test_welcome_reflects_mode(self) -> None:
        b2b = welcome_text(campaign_profile={"mode": "b2b"})
        self.assertIn("contact", b2b.lower())
        b2c = welcome_text(campaign_profile={"mode": "b2c"})
        self.assertIn("customer", b2c.lower())


if __name__ == "__main__":
    unittest.main()

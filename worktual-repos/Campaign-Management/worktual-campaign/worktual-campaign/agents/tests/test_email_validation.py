"""Email format + common-domain typo checks for agent tools."""

from __future__ import annotations

import unittest

from app.agents.contacts.validation import (
    review_email_address,
    suggest_email_domain_fix,
    validate_email_phone,
)


class EmailValidationTests(unittest.TestCase):
    def test_gmai_typo_suggestion(self) -> None:
        self.assertEqual(
            suggest_email_domain_fix("aravin@gmai.com"),
            "aravin@gmail.com",
        )
        reviewed = review_email_address("aravin@gmai.com")
        self.assertFalse(reviewed["ok"])
        self.assertEqual(reviewed["error"], "likely_typo")
        self.assertEqual(reviewed["suggested_email"], "aravin@gmail.com")

    def test_valid_gmail_ok(self) -> None:
        reviewed = review_email_address("aravin@gmail.com")
        self.assertTrue(reviewed["ok"])
        self.assertEqual(reviewed["email"], "aravin@gmail.com")

    def test_validate_email_phone_blocks_typo(self) -> None:
        out = validate_email_phone("aravin@gmai.com", None, require_channel=True)
        self.assertFalse(out["ok"])
        self.assertEqual(out.get("suggested_email"), "aravin@gmail.com")

    def test_email_alone_enough(self) -> None:
        out = validate_email_phone("aravin@gmail.com", None, require_channel=True)
        self.assertTrue(out["ok"])
        self.assertEqual(out["email"], "aravin@gmail.com")
        self.assertIsNone(out["phone"])


if __name__ == "__main__":
    unittest.main()

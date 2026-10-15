import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from structure import (
    format_structured_article,
    ground_phrases,
    is_grounded,
    structure_article,
)


NUMBERED = (
    "Symptoms: charged twice, refund not showing\n\n"
    "1. Check the order status in the account\n"
    "2. Confirm the refund date on the receipt\n"
)


class StructureTests(unittest.TestCase):
    def test_prose_howto_uses_grounded_llm_steps(self):
        body = (
            "If the refund is missing, first check the order status in the account. "
            "Then confirm the refund date on the receipt."
        )
        with patch(
            "structure.call_structure_llm",
            return_value={
                "symptoms": ["refund is missing"],
                "steps": [
                    "check the order status in the account",
                    "confirm the refund date on the receipt",
                ],
            },
        ):
            symptoms, steps, path = structure_article("Refund delay", body)
        self.assertEqual(path, "llm")
        self.assertEqual(symptoms, ["refund is missing"])
        self.assertEqual(
            steps,
            [
                "check the order status in the account",
                "confirm the refund date on the receipt",
            ],
        )

    def test_faq_without_procedure_uses_full_body_text(self):
        body = "Refunds post in 5 to 7 business days after approval."
        with patch(
            "structure.call_structure_llm",
            return_value={"symptoms": [], "steps": []},
        ):
            doc = format_structured_article(
                organization_id="1000",
                article_id="KB-9",
                title="How long do refunds take",
                content=body,
            )
        self.assertEqual(doc["structure_path"], "body")
        self.assertEqual(doc["steps"], [])
        self.assertIn(body, doc["text"])

    def test_drops_invented_error_code_not_in_source(self):
        source = "Printer shows offline after the Windows update."
        kept = ground_phrases(
            ["printer shows offline", "error 0x123"],
            source,
        )
        self.assertEqual(kept, ["printer shows offline"])
        self.assertFalse(is_grounded("error 0x123", source))

    def test_llm_down_on_numbered_howto_uses_regex(self):
        with patch("structure.call_structure_llm", return_value=None):
            symptoms, steps, path = structure_article("Refund", NUMBERED)
        self.assertEqual(path, "regex")
        self.assertEqual(symptoms, ["charged twice", "refund not showing"])
        self.assertEqual(len(steps), 2)

    def test_llm_empty_and_no_numbered_list_uses_body(self):
        body = "Contact billing if you have questions about the charge."
        with patch(
            "structure.call_structure_llm",
            return_value={"symptoms": ["error 0x123"], "steps": ["reboot the flux capacitor"]},
        ):
            symptoms, steps, path = structure_article("Billing", body)
        self.assertEqual(path, "body")
        self.assertEqual(symptoms, [])
        self.assertEqual(steps, [])


if __name__ == "__main__":
    unittest.main()

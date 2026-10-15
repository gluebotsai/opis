import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from unittest.mock import patch

from app import compact_search_hit, pick_reranked_hit
from embeddings import pick_top_index
from formatter import extract_steps, extract_symptoms, flatten_text, format_article


class FormatterTests(unittest.TestCase):
    def test_numbered_howto_becomes_steps_array(self):
        body = (
            "Symptoms: charged twice, refund not showing\n\n"
            "1. Check the order status in the account\n"
            "2. Confirm the refund date on the receipt\n"
            "3. Wait 5–7 business days for the bank to post it\n"
        )
        doc = format_article(
            organization_id="1000",
            article_id="KB-2201",
            title="Refund taking longer than expected",
            content=body,
        )
        self.assertEqual(doc["id"], "1000_KB-2201")
        self.assertEqual(doc["module"], "ticketing")
        self.assertEqual(
            doc["symptoms"],
            ["charged twice", "refund not showing"],
        )
        self.assertEqual(
            doc["steps"],
            [
                "Check the order status in the account",
                "Confirm the refund date on the receipt",
                "Wait 5–7 business days for the bank to post it",
            ],
        )
        self.assertIn("Check the order status in the account", doc["text"])
        self.assertNotIn("product", doc)
        self.assertNotIn("root_cause", doc)

    def test_faq_without_numbers_keeps_empty_steps_and_full_body_text(self):
        body = "Refunds post in 5 to 7 business days after approval."
        doc = format_article(
            organization_id="1000",
            article_id="KB-9",
            title="How long do refunds take",
            content=body,
        )
        self.assertEqual(doc["steps"], [])
        self.assertEqual(doc["symptoms"], [])
        self.assertEqual(
            doc["text"],
            "How long do refunds take. Refunds post in 5 to 7 business days after approval.",
        )

    def test_does_not_invent_symptoms_from_title_or_prose(self):
        body = "The printer may appear offline after an update. Restart the device."
        self.assertEqual(extract_symptoms(body), [])
        self.assertEqual(extract_steps(body), [])

    def test_single_numbered_line_is_not_a_procedure(self):
        self.assertEqual(extract_steps("1. Only one line here"), [])

    def test_flatten_uses_steps_not_raw_body_when_steps_exist(self):
        text = flatten_text(
            "Refund",
            "1. A\n2. B\nextra commentary that should not be required",
            [],
            ["A", "B"],
        )
        self.assertEqual(text, "Refund. A. B")
        self.assertNotIn("commentary", text)


class SearchRerankTests(unittest.TestCase):
    def test_empty_candidates_return_none(self):
        self.assertIsNone(pick_reranked_hit("vpn down", []))
        self.assertIsNone(pick_top_index([]))

    def test_rerank_picks_grounded_title(self):
        rows = [
            {
                "article_id": "KB-plants",
                "title": "Office plants",
                "symptoms": [],
                "steps": [],
                "text": "Water weekly.",
            },
            {
                "article_id": "KB-vpn",
                "title": "What to Do When Your VPN Won't Connect",
                "symptoms": ["vpn not connecting"],
                "steps": ["switch servers", "flush DNS"],
                "text": "What to Do When Your VPN Won't Connect. vpn not connecting. switch servers",
            },
        ]

        def fake_rerank(_query, texts):
            scored = []
            for i, text in enumerate(texts):
                score = 0.9 if "VPN" in text else 0.1
                scored.append((i, score))
            return sorted(scored, key=lambda item: item[1], reverse=True)

        with patch("app.rerank_texts", side_effect=fake_rerank):
            hit = pick_reranked_hit("VPN not connecting after password reset", rows)
        self.assertIsNotNone(hit)
        self.assertEqual(hit["article_id"], "KB-vpn")
        self.assertEqual(hit["title"], "What to Do When Your VPN Won't Connect")
        self.assertEqual(hit["steps"], ["switch servers", "flush DNS"])

    def test_compact_hit_keeps_one_article_fields(self):
        hit = compact_search_hit(
            {
                "article_id": "KB-1",
                "title": "Reset Wi-Fi",
                "symptoms": ["no signal"],
                "steps": ["Unplug router"],
                "text": "Reset Wi-Fi. no signal. Unplug router",
            },
            0.81,
        )
        self.assertEqual(hit["article_id"], "KB-1")
        self.assertEqual(hit["score"], 0.81)
        self.assertNotIn("content", hit)
        self.assertNotIn("structure_path", hit)


if __name__ == "__main__":
    unittest.main()

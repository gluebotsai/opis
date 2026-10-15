"""Tests for FE carry → server message placement merge."""

from __future__ import annotations

import unittest

from app.carry_messages import (
    merge_carry_into_messages,
    normalize_carry_message_rows,
)


class CarryMessagePlacementTests(unittest.TestCase):
    def test_empty_server_adopts_carry_order(self):
        carry = normalize_carry_message_rows(
            [
                {"role": "assistant", "text": "Hi welcome", "id": "w"},
                {"role": "user", "text": "Build brand loyalty", "id": "u"},
            ]
        )
        merged = merge_carry_into_messages([], carry)
        self.assertIsNotNone(merged)
        assert merged is not None
        self.assertEqual([m["text"] for m in merged], ["Hi welcome", "Build brand loyalty"])

    def test_empty_create_draft_ignores_bulk_carry(self):
        carry = normalize_carry_message_rows(
            [
                {"role": "user", "text": "diwali 42% off", "id": "d1"},
                {"role": "user", "text": "select 3", "id": "d2"},
                {"role": "user", "text": "all channels", "id": "d3"},
            ]
        )
        self.assertIsNone(
            merge_carry_into_messages(
                [],
                carry,
                restrict_to_handoff=True,
                empty_adopt_max_user_turns=0,
            )
        )

    def test_empty_handoff_adopts_last_user_only(self):
        carry = normalize_carry_message_rows(
            [
                {"role": "user", "text": "diwali 42% off", "id": "d1"},
                {"role": "assistant", "text": "Name options", "id": "a1"},
                {"role": "user", "text": "pongal 5% off", "id": "u-new"},
            ]
        )
        merged = merge_carry_into_messages(
            [],
            carry,
            restrict_to_handoff=True,
            empty_adopt_max_user_turns=1,
        )
        self.assertIsNotNone(merged)
        assert merged is not None
        self.assertEqual([m["text"] for m in merged], ["Name options", "pongal 5% off"])

    def test_race_user_first_uses_carry_order_not_append_welcome_after(self):
        """Regression: do not produce [user, welcome]."""
        existing = [
            {
                "id": "server-user",
                "role": "user",
                "text": "Build brand loyalty",
                "created_at": "t1",
            }
        ]
        carry = normalize_carry_message_rows(
            [
                {"role": "assistant", "text": "Hi welcome", "id": "w"},
                {"role": "user", "text": "Build brand loyalty", "id": "u"},
            ]
        )
        merged = merge_carry_into_messages(existing, carry)
        self.assertIsNotNone(merged)
        assert merged is not None
        self.assertEqual([m["text"] for m in merged], ["Hi welcome", "Build brand loyalty"])
        self.assertEqual(merged[1]["id"], "server-user")

    def test_established_transcript_untouched(self):
        existing = [
            {"id": "1", "role": "assistant", "text": "Hi"},
            {"id": "2", "role": "user", "text": "Hello"},
        ]
        carry = normalize_carry_message_rows(
            [
                {"role": "assistant", "text": "Hi"},
                {"role": "user", "text": "Hello"},
                {"role": "assistant", "text": "Next"},
            ]
        )
        self.assertIsNone(merge_carry_into_messages(existing, carry))

    def test_hub_backfill_imports_missing_early_user(self):
        """Hub reconnect may still insert an optimistic user by created_at."""
        existing = [
            {
                "id": "w1",
                "role": "assistant",
                "text": "Hi — I'll help you create a campaign.",
                "created_at": "2026-09-17T10:00:00.000Z",
            },
            {
                "id": "w2",
                "role": "assistant",
                "text": "Hi there! I'm here to help.",
                "created_at": "2026-09-17T10:00:01.000Z",
            },
            {
                "id": "u2",
                "role": "user",
                "text": "3. Templates",
                "created_at": "2026-09-17T10:00:05.000Z",
            },
        ]
        carry = normalize_carry_message_rows(
            [
                {
                    "role": "assistant",
                    "text": "Hi — I'll help you create a campaign.",
                    "createdAt": "2026-09-17T10:00:00.000Z",
                },
                {
                    "role": "user",
                    "text": "hi",
                    "id": "u-hi",
                    "createdAt": "2026-09-17T10:00:02.000Z",
                },
                {
                    "role": "user",
                    "text": "3. Templates",
                    "createdAt": "2026-09-17T10:00:05.000Z",
                },
            ]
        )
        merged = merge_carry_into_messages(
            existing,
            carry,
            allow_missing_user_backfill=True,
        )
        self.assertIsNotNone(merged)
        assert merged is not None
        texts = [m["text"] for m in merged]
        self.assertIn("hi", texts)
        self.assertEqual(texts.index("hi"), 2)
        self.assertEqual(texts.index("3. Templates"), 3)

    def test_create_draft_does_not_copy_foreign_user_history(self):
        """New session must not import another campaign's earlier user turns."""
        existing = [
            {
                "id": "w1",
                "role": "assistant",
                "text": "Hi — I'll help you create a campaign.",
                "created_at": "2026-09-25T10:00:00.000Z",
            },
            {
                "id": "w2",
                "role": "assistant",
                "text": "Hey — ready when you are.",
                "created_at": "2026-09-25T10:00:01.000Z",
            },
        ]
        carry = normalize_carry_message_rows(
            [
                {"role": "user", "text": "diwali 42% off", "id": "d1"},
                {"role": "user", "text": "select 3", "id": "d2"},
                {"role": "user", "text": "all channels", "id": "d3"},
                {"role": "user", "text": "pongal 5% off", "id": "u-new"},
            ]
        )
        merged = merge_carry_into_messages(
            existing,
            carry,
            restrict_to_handoff=True,
            empty_adopt_max_user_turns=1,
        )
        self.assertIsNotNone(merged)
        assert merged is not None
        texts = [m["text"] for m in merged]
        self.assertNotIn("diwali 42% off", texts)
        self.assertNotIn("select 3", texts)
        self.assertEqual(texts[-1], "pongal 5% off")
        self.assertEqual(len(texts), 3)


    def test_normalize_carry_preserves_multi_image_urls(self):
        rows = normalize_carry_message_rows(
            [
                {
                    "role": "user",
                    "text": "Use these",
                    "image_urls": [
                        {"url": "https://example.com/api/media/a"},
                        {"url": "https://example.com/api/media/b"},
                    ],
                }
            ]
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0].get("image_urls") or []), 2)
        self.assertTrue(str(rows[0].get("image_url") or "").endswith("/a"))


if __name__ == "__main__":
    unittest.main()

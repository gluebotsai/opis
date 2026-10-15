"""Empty-content nudge hygiene for the tool loop."""

from __future__ import annotations

import unittest

from app.runtime.agent import (
    EMPTY_CONTENT_NUDGE,
    POST_TOOL_NUDGE,
    is_internal_nudge_message,
    strip_internal_nudges,
)


class ToolLoopNudgeTests(unittest.TestCase):
    def test_strip_nudges_and_null_content(self) -> None:
        cleaned = strip_internal_nudges(
            [
                {"role": "user", "content": "all channels"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{"id": "1"}],
                },
                {"role": "tool", "name": "update_campaign_setup", "content": "{}"},
                {"role": "assistant", "content": ""},
                {"role": "user", "content": POST_TOOL_NUDGE},
                {"role": "user", "content": "what happened"},
            ]
        )
        self.assertEqual(cleaned[0]["content"], "all channels")
        self.assertEqual(cleaned[1]["content"], "")
        self.assertEqual(cleaned[-1]["content"], "what happened")
        self.assertFalse(any(is_internal_nudge_message(m) for m in cleaned))

    def test_strip_premature_text_reply_before_nudge(self) -> None:
        cleaned = strip_internal_nudges(
            [
                {"role": "user", "content": "i want to create contacts"},
                {
                    "role": "assistant",
                    "content": "Sure! What's the first name?",
                },
                {
                    "role": "user",
                    "content": "[internal_nudge] call SET_DRAFT_FIELDS",
                    "_internal_nudge": True,
                },
                {
                    "role": "assistant",
                    "content": "What's the first name?",
                    "tool_calls": [{"id": "1"}],
                },
            ]
        )
        self.assertEqual(len(cleaned), 2)
        self.assertEqual(cleaned[0]["content"], "i want to create contacts")
        self.assertTrue(cleaned[1].get("tool_calls"))
        self.assertFalse(any(is_internal_nudge_message(m) for m in cleaned))

        self.assertTrue(
            is_internal_nudge_message(
                {"role": "user", "content": EMPTY_CONTENT_NUDGE}
            )
        )
        self.assertTrue(
            is_internal_nudge_message(
                {
                    "role": "user",
                    "content": (
                        "The tools already ran successfully. Write a short HTML "
                        "reply to the user explaining what changed and the next step. Do n"
                    ),
                }
            )
        )


if __name__ == "__main__":
    unittest.main()

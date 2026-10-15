"""Contacts session llm_memory + route create flag (no query-wording regex)."""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.agents.contacts.tools.handlers import handle_route_to_module
from app.session_store import (
    empty_session,
    get_llm_memory,
    replace_llm_memory,
)


class ContactsLlmMemoryTests(unittest.TestCase):
    def test_empty_contacts_session_has_llm_memory(self) -> None:
        session = empty_session("c-test-1", user_id="u1", module="contacts")
        self.assertEqual(session.get("module"), "contacts")
        self.assertEqual(session.get("llm_memory"), [])

    def test_replace_and_get_llm_memory_roundtrip(self) -> None:
        session = empty_session("c-test-2", user_id="u1", module="contacts")
        transcript = [
            {"role": "user", "content": "Create a contact for Priya"},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "tc1",
                        "type": "function",
                        "function": {
                            "name": "SET_DRAFT_FIELDS",
                            "arguments": '{"mode":"create"}',
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "tc1",
                "name": "SET_DRAFT_FIELDS",
                "content": '{"ok":true,"missing_fields":["first_name"]}',
            },
            {"role": "assistant", "content": "What is their first name?"},
        ]
        replace_llm_memory(session, transcript)
        mem = get_llm_memory(session)
        self.assertEqual(len(mem), 4)
        self.assertEqual(mem[0]["role"], "user")
        self.assertEqual(mem[-1]["content"], "What is their first name?")
        self.assertEqual(mem[2]["role"], "tool")


class ContactsRouteCreateTests(unittest.TestCase):
    def test_route_create_requires_explicit_flag(self) -> None:
        with patch(
            "app.agents.routing.route_to_module_result",
            side_effect=lambda **kwargs: {"ok": True, **kwargs},
        ):
            result = asyncio.run(
                handle_route_to_module(
                    "sid",
                    "tok",
                    {
                        "module": "contacts",
                        "query": "create a new contact for Priya",
                        "change_summary": "Opening audience create",
                    },
                )
            )
        self.assertFalse(result.get("create"))

    def test_route_create_true_when_llm_passes_flag(self) -> None:
        with patch(
            "app.agents.routing.route_to_module_result",
            side_effect=lambda **kwargs: {"ok": True, **kwargs},
        ):
            result = asyncio.run(
                handle_route_to_module(
                    "sid",
                    "tok",
                    {
                        "module": "contacts",
                        "query": "new contact",
                        "create": True,
                        "change_summary": "Opening audience create",
                    },
                )
            )
        self.assertTrue(result.get("create"))


if __name__ == "__main__":
    unittest.main()

"""Tests for shared routing helpers and create-campaign preflight gate."""

import unittest

from app.agents.routing import (
    break_after_route_tool,
    filter_route_tool_calls,
    route_handoff_reply,
)


class RoutingHelperTests(unittest.TestCase):
    def test_filter_route_tool_calls_isolates_route(self):
        tool_calls = [
            {"function": {"name": "ROUTE_TO_MODULE", "arguments": "{}"}},
            {"function": {"name": "OTHER_TOOL", "arguments": "{}"}},
        ]
        filtered = filter_route_tool_calls(tool_calls)
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["function"]["name"], "ROUTE_TO_MODULE")

    def test_filter_route_tool_calls_passes_through_non_route(self):
        tool_calls = [{"function": {"name": "LIST_THREADS", "arguments": "{}"}}]
        self.assertEqual(filter_route_tool_calls(tool_calls), tool_calls)

    def test_break_after_route_tool_on_success(self):
        reply = break_after_route_tool(
            [("ROUTE_TO_MODULE", {"ok": True, "message": "Opening Audience."})],
            "",
        )
        self.assertEqual(reply, "Opening Audience.")

    def test_break_after_route_tool_ignores_failed_route(self):
        self.assertIsNone(
            break_after_route_tool(
                [("ROUTE_TO_MODULE", {"ok": False, "error": "bad module"})],
                "hi",
            )
        )

    def test_route_handoff_reply_fallback(self):
        self.assertEqual(
            route_handoff_reply({"ok": True}, ""),
            "Opening that workspace now.",
        )


class ContactsToolFilterTests(unittest.TestCase):
    def test_filter_contacts_tool_calls_dedupes_create(self):
        from app.agents.contacts.graph import _filter_contacts_tool_calls

        tool_calls = [
            {"function": {"name": "CREATE_CONTACT"}},
            {"function": {"name": "CREATE_CONTACT"}},
            {"function": {"name": "SET_DRAFT_FIELDS"}},
        ]
        filtered = _filter_contacts_tool_calls(tool_calls)
        names = [c["function"]["name"] for c in filtered]
        self.assertEqual(names.count("CREATE_CONTACT"), 1)
        self.assertIn("SET_DRAFT_FIELDS", names)


if __name__ == "__main__":
    unittest.main()

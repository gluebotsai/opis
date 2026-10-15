"""leave_session must not wipe a draft already bound on the same Engine.IO sid."""

from __future__ import annotations

import unittest

from app.socket_server import socket_leave_clears_binding


class SocketLeaveBindingTests(unittest.TestCase):
    def test_leave_same_session_clears(self):
        self.assertTrue(socket_leave_clears_binding("hub-1", "hub-1"))
        self.assertTrue(socket_leave_clears_binding("draft-uuid", "draft-uuid"))

    def test_leave_unbound_socket_clears(self):
        self.assertTrue(socket_leave_clears_binding(None, "hub-1"))
        self.assertTrue(socket_leave_clears_binding("", "hub-1"))

    def test_leave_hub_after_draft_join_keeps_binding(self):
        self.assertFalse(
            socket_leave_clears_binding("7e1ddc3e-4e83-4a9c-8a16-5ac512d93556", "hub-abc")
        )

    def test_empty_leaving_id_does_not_clear(self):
        self.assertFalse(socket_leave_clears_binding("draft-uuid", ""))
        self.assertFalse(socket_leave_clears_binding("draft-uuid", None))


if __name__ == "__main__":
    unittest.main()

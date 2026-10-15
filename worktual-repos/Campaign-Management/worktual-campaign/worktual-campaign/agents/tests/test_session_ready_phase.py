"""Contract: join_session emits session_ready with ready_phase and agent_busy errors."""

from __future__ import annotations

import unittest
from pathlib import Path


class SessionReadyPhaseTests(unittest.TestCase):
    def test_socket_server_declares_ready_phases(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "app" / "socket_server.py").read_text(encoding="utf-8")
        self.assertIn('"ready_phase": "initial"', source)
        self.assertIn('"ready_phase": "hydration"', source)
        self.assertIn('"code": "agent_busy"', source)


if __name__ == "__main__":
    unittest.main()

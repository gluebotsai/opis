"""On-demand must abort when no contact identity is present (before templates)."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

_PATH = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "agents"
    / "on_demand"
    / "audience_identity.py"
)
_SPEC = importlib.util.spec_from_file_location("on_demand_audience_identity", _PATH)
assert _SPEC and _SPEC.loader
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)

collect_audience_identity = _MOD.collect_audience_identity
heuristic_identity_from_text = _MOD.heuristic_identity_from_text
missing_contact_identity_error = _MOD.missing_contact_identity_error


class OnDemandContactAbortTests(unittest.TestCase):
    def test_missing_identity_from_empty_request(self) -> None:
        analysis = heuristic_identity_from_text(
            "Create a campaign and send a follow-up"
        )
        identity = collect_audience_identity(analysis, {})
        err = missing_contact_identity_error(identity)
        self.assertIsNotNone(err)
        self.assertIn("Dropping the on-demand plan", err or "")

    def test_email_in_text_is_enough(self) -> None:
        analysis = heuristic_identity_from_text(
            "Send email to priya@acme.com because they viewed CRM twice"
        )
        identity = collect_audience_identity(analysis, {})
        self.assertIn("priya@acme.com", identity["emails"])
        self.assertIsNone(missing_contact_identity_error(identity))

    def test_payload_email_fills_gap(self) -> None:
        analysis = heuristic_identity_from_text("Re-engage this customer about CRM")
        identity = collect_audience_identity(
            analysis, {"emails": ["ops@worktual.com"]}
        )
        self.assertEqual(identity["emails"], ["ops@worktual.com"])
        self.assertIsNone(missing_contact_identity_error(identity))

    def test_customer_id_is_enough(self) -> None:
        analysis = heuristic_identity_from_text("Send for customer id 182938475610")
        identity = collect_audience_identity(analysis, {})
        self.assertTrue(identity["customer_ids"])
        self.assertIsNone(missing_contact_identity_error(identity))


if __name__ == "__main__":
    unittest.main()

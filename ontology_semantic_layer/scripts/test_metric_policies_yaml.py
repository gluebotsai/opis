#!/usr/bin/env python3
"""CI: metric_policies.yml must expose 'on' keys (YAML 1.1 on/off boolean trap)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.lookup import get_metric_policy


def test_policies_have_on_key() -> None:
    samples = [
        "missed_contact_rate",
        "won_deal_rate",
        "open_tickets_metric",
        "delivery_rate",
        "sla_breach_rate",
    ]
    for mid in samples:
        pol = get_metric_policy(mid)
        assert "on" in pol and pol["on"], f"{mid} missing 'on' (YAML boolean trap?)"
        assert not isinstance(pol["on"], bool), f"{mid} 'on' parsed as bool"


def main() -> int:
    test_policies_have_on_key()
    print("PASS  metric_policies_on_key")
    return 0


if __name__ == "__main__":
    sys.exit(main())

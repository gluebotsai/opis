#!/usr/bin/env python3
"""Bounce rate aligns to v_session_bounce for qualifying tenants."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_mart_started_at_prefers_bounce() -> None:
    sql = (
        ROOT
        / "semantic/dbt/webtracking/default/dbt/models/marts/mart_web_sessions.sql"
    ).read_text(encoding="utf-8")
    assert "coalesce(b.session_started_at, s.started_at)" in sql


if __name__ == "__main__":
    test_mart_started_at_prefers_bounce()
    print("OK: bounce alignment source check passed")

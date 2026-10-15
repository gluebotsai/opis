#!/usr/bin/env python3
"""CI: registry ↔ platform thresholds, prompt hygiene, interpretation merge."""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ontology.slice import fetch_ontology_slice
from semantic.thresholds import build_interpretation, list_missing_platform_rows, merge_threshold


def test_registry_has_platform_row() -> None:
    reg = yaml.safe_load((ROOT / "semantic/metric_registry.yml").read_text())["metrics"]
    missing = list_missing_platform_rows(sorted(reg.keys()))
    assert not missing, f"Missing platform thresholds: {missing[:10]}"


def test_prompt_excludes_thresholds() -> None:
    pack = fetch_ontology_slice(agent="tk.reporting", tenant="org1000", product="ticketing")
    prompt = pack.as_prompt()
    assert "threshold:" not in prompt, prompt


def test_org_overlay_wins() -> None:
    merged = merge_threshold("open_tickets_metric", 1000)
    assert merged["threshold"] == {"warn": 25, "critical": 60}


def test_interpretation_status() -> None:
    interp = build_interpretation(
        ["open_tickets_metric"],
        [{"open_tickets_metric": 42}],
        1000,
    )
    row = interp["open_tickets_metric"]
    assert row["value"] == 42
    assert row["status"] == "warn"  # 42 >= warn 25, below critical 60


def test_count_without_org_threshold() -> None:
    merged = merge_threshold("deal_volume", 1008)
    interp = build_interpretation(["deal_volume"], [{"deal_volume": 10}], 1008)
    assert interp["deal_volume"]["status"] in ("not_applicable", "ok", "unknown")


def test_rate_series_not_summed() -> None:
    """Multi-row daily rates must not be summed into a bogus headline value."""
    rows = [
        {"missed_contact_rate": 0.5},
        {"missed_contact_rate": 0.25},
        {"missed_contact_rate": None},
    ]
    interp = build_interpretation(["missed_contact_rate"], rows, 1000)
    assert interp["missed_contact_rate"]["value"] is None
    assert interp["missed_contact_rate"]["status"] == "unknown"


def main() -> int:
    tests = [
        test_registry_has_platform_row,
        test_prompt_excludes_thresholds,
        test_org_overlay_wins,
        test_interpretation_status,
        test_count_without_org_threshold,
        test_rate_series_not_summed,
    ]
    for fn in tests:
        fn()
        print(f"PASS  {fn.__name__}")
    print(f"\n{len(tests)}/{len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

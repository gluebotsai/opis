"""Tests for extract_custom blocklist / stop_dynamic_keys."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.coercion import extract_custom


def test_blocklist_drops_dynamic_key():
    out = extract_custom(
        {"custom_fields": {"blood_pressure": "120/80", "note": "ok"}},
        "custom_fields",
        [],
        custom_dynamic=True,
        blocklist=["blood_pressure"],
    )
    assert "custom_blood_pressure" not in out
    assert "custom_note" in out


def test_stop_dynamic_keys_classified_vin():
    out = extract_custom(
        {"custom_fields": {"vin": "1HGCM82633A004352", "loyalty_tier": "gold"}},
        "custom_fields",
        [],
        custom_dynamic=True,
        stop_dynamic_keys=["vin"],
    )
    assert "custom_vin" not in out
    assert "custom_loyalty_tier" in out


def test_whitelist_only_emits_allowed():
    out = extract_custom(
        {"custom_fields": {"mrn": "1", "scratch": "x"}},
        "custom_fields",
        [],
        custom_dynamic=True,
        whitelist=["mrn"],
    )
    assert "custom_mrn" in out
    assert "custom_scratch" not in out


if __name__ == "__main__":
    test_blocklist_drops_dynamic_key()
    test_stop_dynamic_keys_classified_vin()
    test_whitelist_only_emits_allowed()
    print("ok")

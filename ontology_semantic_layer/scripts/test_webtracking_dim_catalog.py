#!/usr/bin/env python3
"""Dim catalog from semantic_layer.yml is allowed on webtracking metrics."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.lookup import get_allowed_dims  # noqa: E402
from semantic.sql.webtracking_dim_catalog import (  # noqa: E402
    webtracking_catalog_dims,
)


def test_catalog_has_chat_dims() -> None:
    dims = set(webtracking_catalog_dims())
    for name in ("device", "city", "region", "page_path", "form_id", "utm_source", "country"):
        assert name in dims, name


def test_unique_visitors_allows_catalog_dims() -> None:
    allowed = set(get_allowed_dims("unique_visitors", product="webtracking"))
    for name in ("device", "city", "page_path", "utm_source", "form_id"):
        assert name in allowed, name


def test_form_metric_allows_device() -> None:
    allowed = set(get_allowed_dims("form_abandons", product="webtracking"))
    assert "form_id" in allowed
    assert "device" in allowed


def test_ticketing_not_given_webtracking_catalog() -> None:
    allowed = set(get_allowed_dims("open_tickets_metric", product="ticketing"))
    assert "form_id" not in allowed


if __name__ == "__main__":
    test_catalog_has_chat_dims()
    test_unique_visitors_allows_catalog_dims()
    test_form_metric_allows_device()
    test_ticketing_not_given_webtracking_catalog()
    print("OK: webtracking dim catalog checks passed")

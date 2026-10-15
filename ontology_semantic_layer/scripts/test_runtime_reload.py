#!/usr/bin/env python3
"""Tests: controlled cache reload (no uvicorn --reload)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ontology.slice as slice_mod
import semantic.lookup as lookup_mod
from ontology.slice import clear_ontology_cache, get_catalog
from semantic.lookup import clear_policies_cache, get_metric_policy
from semantic.metricflow.dimension_resolver import (
    _catalog_cache,
    _resolver_cache,
    clear_dimension_resolver_cache,
)
from semantic.metricflow.engine import _engine_cache, clear_engine_cache
from semantic.runtime_reload import reload_runtime
from semantic.thresholds import _cache, clear_thresholds_cache


def test_clear_ontology_cache() -> None:
    _ = get_catalog()
    assert slice_mod._CATALOG is not None
    clear_ontology_cache()
    assert slice_mod._CATALOG is None


def test_clear_policies_cache() -> None:
    _ = get_metric_policy("missed_contact_rate")
    assert lookup_mod._policies_cache is not None
    clear_policies_cache()
    assert lookup_mod._policies_cache is None
    pol = get_metric_policy("missed_contact_rate")
    assert pol.get("on") == "wt:Interaction"


def test_reload_runtime_clears_metricflow_caches() -> None:
    _resolver_cache["dummy"] = {}
    _catalog_cache["dummy"] = set()
    _engine_cache["dummy"] = object()
    result = reload_runtime(warm_metricflow=False)
    assert "ontology" in result["reloaded"]
    assert "metricflow" in result["reloaded"]
    assert "sql_cache" in result["reloaded"]
    assert "metrics_catalog" in result["reloaded"]
    assert "agent_grants" in result["reloaded"]
    assert "dummy" not in _resolver_cache
    assert "dummy" not in _catalog_cache
    assert not _engine_cache


def test_api_reload_gating() -> None:
    from fastapi.testclient import TestClient

    from api.main import app

    client = TestClient(app)
    old = os.environ.pop("CONTEXT_RELOAD_SECRET", None)
    try:
        r = client.post("/v1/admin/reload", headers={"X-Reload-Secret": "x"})
        assert r.status_code == 404, r.text

        os.environ["CONTEXT_RELOAD_SECRET"] = "test-secret"
        r = client.post("/v1/admin/reload")
        assert r.status_code == 403, r.text

        r = client.post("/v1/admin/reload", headers={"X-Reload-Secret": "wrong"})
        assert r.status_code == 403, r.text

        r = client.post("/v1/admin/reload", headers={"X-Reload-Secret": "test-secret"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "reloaded" in body
        assert "metricflow" in body
    finally:
        if old is None:
            os.environ.pop("CONTEXT_RELOAD_SECRET", None)
        else:
            os.environ["CONTEXT_RELOAD_SECRET"] = old


def main() -> int:
    tests = [
        test_clear_ontology_cache,
        test_clear_policies_cache,
        test_reload_runtime_clears_metricflow_caches,
        test_api_reload_gating,
    ]
    for fn in tests:
        fn()
        print(f"PASS  {fn.__name__}")
    print(f"\n{len(tests)}/{len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
